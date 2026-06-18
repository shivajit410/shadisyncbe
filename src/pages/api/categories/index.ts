import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { withPermission } from '@/lib/permissions';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { workspaceId } = req.method === 'GET' ? req.query : req.body;

  if (req.method === 'GET') {
    try {
      const result = await query(
        `SELECT c.id, c.name, c.event_id, c.created_at, e.title as event_title 
         FROM categories c 
         LEFT JOIN events e ON c.event_id = e.id 
         WHERE c.workspace_id = $1 
         ORDER BY c.name ASC`,
        [workspaceId]
      );
      return res.status(200).json({ categories: result.rows });
    } catch (error: any) {
      console.error('Fetch Categories API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    const { name, eventId } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    try {
      // If eventId is provided, verify it exists and belongs to the workspace
      if (eventId) {
        const eventCheck = await query(
          'SELECT 1 FROM events WHERE id = $1 AND workspace_id = $2',
          [eventId, workspaceId]
        );
        if (eventCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Invalid Event ID for this workspace' });
        }
      }

      const result = await query(
        'INSERT INTO categories (workspace_id, event_id, name) VALUES ($1, $2, $3) RETURNING *',
        [workspaceId, eventId || null, name.trim()]
      );
      return res.status(201).json({ category: result.rows[0] });
    } catch (error: any) {
      console.error('Create Category API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

export default withAuth((req, res) => {
  if (req.method === 'GET') {
    return withPermission('Events', 'view', handler)(req, res);
  }
  if (req.method === 'POST') {
    return withPermission('Events', 'create', handler)(req, res);
  }
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
});
