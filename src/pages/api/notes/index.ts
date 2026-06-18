import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { withPermission } from '@/lib/permissions';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { workspaceId, search } = req.method === 'GET' ? req.query : req.body;

  if (req.method === 'GET') {
    try {
      let sql = `
        SELECT n.*, u.name AS creator_name
        FROM notes n
        LEFT JOIN users u ON n.created_by = u.id
        WHERE n.workspace_id = $1
      `;
      const params: any[] = [workspaceId];

      if (search && typeof search === 'string' && search.trim().length > 0) {
        sql += ` AND (n.title ILIKE $2 OR n.content ILIKE $2)`;
        params.push(`%${search.trim()}%`);
      }

      sql += ' ORDER BY n.is_pinned DESC, n.updated_at DESC';

      const result = await query(sql, params);
      return res.status(200).json({ notes: result.rows });
    } catch (error: any) {
      console.error('Fetch Notes API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    const { title, content, isPinned } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ message: 'Note title is required' });
    }

    try {
      const result = await query(
        `INSERT INTO notes (workspace_id, title, content, is_pinned, created_by)
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING *`,
        [
          workspaceId,
          title.trim(),
          content || '',
          isPinned || false,
          userId,
        ]
      );

      // Re-fetch note with creator name
      const fetchRes = await query(
        `SELECT n.*, u.name AS creator_name
         FROM notes n
         LEFT JOIN users u ON n.created_by = u.id
         WHERE n.id = $1`,
        [result.rows[0].id]
      );

      return res.status(201).json({ note: fetchRes.rows[0] });
    } catch (error: any) {
      console.error('Create Note API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

export default withAuth((req, res) => {
  if (req.method === 'GET') {
    return withPermission('Notes', 'view', handler)(req, res);
  }
  return withPermission('Notes', 'create', handler)(req, res);
});
