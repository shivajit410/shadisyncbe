import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { verifyPermission } from '@/lib/permissions';
import { checkAndNotifyBudget } from '@/lib/notifications';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const userId = req.user?.userId;
  const { id: expenseId } = req.query;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!expenseId || typeof expenseId !== 'string') {
    return res.status(400).json({ message: 'Expense ID is required' });
  }

  try {
    // 1. Fetch Expense to get workspace ID
    const expCheck = await query('SELECT workspace_id FROM expenses WHERE id = $1', [expenseId]);
    if (expCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Expense not found' });
    }
    const workspaceId = expCheck.rows[0].workspace_id;

    // Handle UPDATE (PUT)
    if (req.method === 'PUT') {
      const hasEditPerm = await verifyPermission(userId, workspaceId, 'Expenses', 'edit');
      if (!hasEditPerm) {
        return res.status(403).json({ message: 'Forbidden: You do not have permission to edit expenses' });
      }

      const { amount, description, categoryId, eventId, expenseDate } = req.body;

      if (amount === undefined || isNaN(Number(amount)) || Number(amount) <= 0) {
        return res.status(400).json({ message: 'A valid positive expense amount is required' });
      }

      // Validate category belongs to workspace
      if (categoryId) {
        const catCheck = await query(
          'SELECT 1 FROM categories WHERE id = $1 AND workspace_id = $2',
          [categoryId, workspaceId]
        );
        if (catCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Invalid Category ID' });
        }
      }

      // Validate event belongs to workspace
      if (eventId) {
        const eventCheck = await query(
          'SELECT 1 FROM events WHERE id = $1 AND workspace_id = $2',
          [eventId, workspaceId]
        );
        if (eventCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Invalid Event ID' });
        }
      }

      const formattedDate = expenseDate || new Date().toISOString().split('T')[0];

      const updateResult = await query(
        `UPDATE expenses 
         SET amount = $1, description = $2, category_id = $3, event_id = $4, expense_date = $5 
         WHERE id = $6 
         RETURNING *`,
        [Number(amount), description || null, categoryId || null, eventId || null, formattedDate, expenseId]
      );

      // Automatically update the budget spent amount
      await query(
        `UPDATE budgets 
         SET spent = COALESCE((SELECT SUM(amount) FROM expenses WHERE workspace_id = $1), 0.00), updated_at = NOW() 
         WHERE workspace_id = $1`,
        [workspaceId]
      );

      // Check budget spent warning thresholds (90% / 100%)
      await checkAndNotifyBudget(workspaceId);

      return res.status(200).json({ expense: updateResult.rows[0] });
    }

    // Handle DELETE
    if (req.method === 'DELETE') {
      const hasDeletePerm = await verifyPermission(userId, workspaceId, 'Expenses', 'delete');
      if (!hasDeletePerm) {
        return res.status(403).json({ message: 'Forbidden: You do not have permission to delete expenses' });
      }

      const deleteResult = await query('DELETE FROM expenses WHERE id = $1 RETURNING *', [expenseId]);

      // Automatically update the budget spent amount
      await query(
        `UPDATE budgets 
         SET spent = COALESCE((SELECT SUM(amount) FROM expenses WHERE workspace_id = $1), 0.00), updated_at = NOW() 
         WHERE workspace_id = $1`,
        [workspaceId]
      );

      // Check budget spent warning thresholds (90% / 100%)
      await checkAndNotifyBudget(workspaceId);

      return res.status(200).json({
        message: 'Expense deleted successfully',
        expense: deleteResult.rows[0],
      });
    }

    res.setHeader('Allow', ['PUT', 'DELETE']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  } catch (error: any) {
    console.error('Expense ID API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
