import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { withPermission } from '@/lib/permissions';
import { checkAndNotifyBudget } from '@/lib/notifications';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { workspaceId } = req.method === 'GET' ? req.query : req.body;
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      // Fetch the budget row and dynamically sum spent from expenses
      const result = await query(
        `SELECT 
          b.id, 
          b.workspace_id, 
          b.allocated, 
          COALESCE((SELECT SUM(amount) FROM expenses WHERE workspace_id = $1), 0.00) AS spent
         FROM budgets b
         WHERE b.workspace_id = $1`,
        [workspaceId]
      );

      if (result.rows.length === 0) {
        // If for some reason a budget doesn't exist, create/return a default one
        const insertRes = await query(
          'INSERT INTO budgets (workspace_id, allocated, spent) VALUES ($1, 0.00, 0.00) RETURNING *',
          [workspaceId]
        );
        return res.status(200).json({ budget: { ...insertRes.rows[0], spent: 0.00 } });
      }

      return res.status(200).json({ budget: result.rows[0] });
    } catch (error: any) {
      console.error('Fetch Budget API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const { allocated } = req.body;

    if (allocated === undefined || isNaN(Number(allocated)) || Number(allocated) < 0) {
      return res.status(400).json({ message: 'A valid non-negative allocated budget is required' });
    }

    try {
      // Owner restriction check
      const memberCheck = await query(
        'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );

      if (memberCheck.rows.length === 0 || memberCheck.rows[0].role !== 'OWNER') {
        return res.status(403).json({ message: 'Forbidden: Only the workspace OWNER can assign or update the budget' });
      }

      const result = await query(
        `INSERT INTO budgets (workspace_id, allocated, spent) 
         VALUES ($1, $2, 0.00) 
         ON CONFLICT (workspace_id) 
         DO UPDATE SET allocated = EXCLUDED.allocated, updated_at = NOW() 
         RETURNING *`,
        [workspaceId, Number(allocated)]
      );

      // Re-fetch with dynamic spent
      const fetchRes = await query(
        `SELECT 
          b.id, 
          b.workspace_id, 
          b.allocated, 
          COALESCE((SELECT SUM(amount) FROM expenses WHERE workspace_id = $1), 0.00) AS spent
         FROM budgets b
         WHERE b.workspace_id = $1`,
        [workspaceId]
      );

      // Check budget spent warning thresholds (90% / 100%)
      await checkAndNotifyBudget(workspaceId);

      return res.status(200).json({ budget: fetchRes.rows[0] });
    } catch (error: any) {
      console.error('Update Budget API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['GET', 'PUT', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

export default withAuth((req, res) => {
  if (req.method === 'GET') {
    return withPermission('Budget', 'view', handler)(req, res);
  }
  // Enforce 'edit' action for setting allocations
  return withPermission('Budget', 'edit', handler)(req, res);
});
