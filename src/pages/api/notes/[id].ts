import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { withPermission } from '@/lib/permissions';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const workspaceId = (req.query.workspaceId as string) || (req.body.workspaceId as string);

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Note ID is required' });
  }

  if (req.method === 'PUT') {
    const { title, content, isPinned } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ message: 'Note title is required' });
    }

    try {
      const result = await query(
        `UPDATE notes
         SET title = $1, content = $2, is_pinned = $3
         WHERE id = $4 AND workspace_id = $5
         RETURNING *`,
        [title.trim(), content || '', isPinned ?? false, id, workspaceId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Note not found' });
      }

      // Re-fetch note with creator name
      const fetchRes = await query(
        `SELECT n.*, u.name AS creator_name
         FROM notes n
         LEFT JOIN users u ON n.created_by = u.id
         WHERE n.id = $1`,
        [result.rows[0].id]
      );

      return res.status(200).json({ note: fetchRes.rows[0] });
    } catch (error: any) {
      console.error('Update Note API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const result = await query(
        'DELETE FROM notes WHERE id = $1 AND workspace_id = $2 RETURNING *',
        [id, workspaceId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Note not found' });
      }

      return res.status(200).json({ message: 'Note deleted successfully', note: result.rows[0] });
    } catch (error: any) {
      console.error('Delete Note API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

export default withAuth((req, res) => {
  if (req.method === 'PUT') {
    return withPermission('Notes', 'edit', handler)(req, res);
  }
  return withPermission('Notes', 'delete', handler)(req, res);
});
