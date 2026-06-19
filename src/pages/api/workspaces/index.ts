import type { NextApiResponse } from 'next';
import { db, query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      // Get all active (non-archived) workspaces for the authenticated user
      const result = await query(
        `SELECT w.id, w.name, w.wedding_date, w.owner_id, w.archived, wm.role, w.created_at, w.cover_image_url
         FROM workspaces w
         JOIN workspace_members wm ON w.id = wm.workspace_id
         WHERE wm.user_id = $1 AND w.archived = false
         ORDER BY w.created_at DESC`,
        [userId]
      );
      return res.status(200).json({ workspaces: result.rows });
    } catch (error: any) {
      console.error('Fetch Workspaces API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    const { name, weddingDate } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'Workspace name is required' });
    }
    if (!weddingDate || isNaN(Date.parse(weddingDate))) {
      return res.status(400).json({ message: 'A valid wedding date is required' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert Workspace
      const wsResult = await client.query(
        'INSERT INTO workspaces (name, wedding_date, owner_id) VALUES ($1, $2, $3) RETURNING *',
        [name.trim(), weddingDate, userId]
      );
      const newWs = wsResult.rows[0];

      // 2. Associate user as OWNER in members
      await client.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [newWs.id, userId, 'OWNER']
      );

      // 3. Pre-seed default budget
      await client.query(
        'INSERT INTO budgets (workspace_id, allocated, spent) VALUES ($1, $2, $3)',
        [newWs.id, 0.00, 0.00]
      );

      await client.query('COMMIT');

      return res.status(201).json({
        workspace: {
          ...newWs,
          role: 'OWNER',
        },
      });
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Create Workspace Transaction Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    } finally {
      client.release();
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

export default withAuth(handler);
