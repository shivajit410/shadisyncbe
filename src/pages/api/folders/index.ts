import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { withPermission } from '@/lib/permissions';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { workspaceId } = req.method === 'GET' ? req.query : req.body;

  if (req.method === 'GET') {
    try {
      const result = await query(
        'SELECT * FROM folders WHERE workspace_id = $1 ORDER BY name ASC',
        [workspaceId]
      );
      return res.status(200).json({ folders: result.rows });
    } catch (error: any) {
      console.error('Fetch Folders API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'Folder name is required' });
    }

    try {
      const result = await query(
        'INSERT INTO folders (workspace_id, name) VALUES ($1, $2) RETURNING *',
        [workspaceId, name.trim()]
      );
      return res.status(201).json({ folder: result.rows[0] });
    } catch (error: any) {
      console.error('Create Folder API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

export default withAuth((req, res) => {
  if (req.method === 'GET') {
    return withPermission('Documents', 'view', handler)(req, res);
  }
  return withPermission('Documents', 'create', handler)(req, res);
});
