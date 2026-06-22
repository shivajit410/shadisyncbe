import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { withPermission } from '@/lib/permissions';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const userId = req.user?.userId;
  const { id } = req.query;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Folder ID is required' });
  }

  try {
    // 1. Fetch folder metadata
    const folderRes = await query('SELECT * FROM folders WHERE id = $1', [id]);
    if (folderRes.rows.length === 0) {
      return res.status(404).json({ message: 'Folder not found' });
    }

    // 2. Delete folder row (cascades to attachments, documents.folder_id is set to NULL on delete)
    await query('DELETE FROM folders WHERE id = $1', [id]);

    return res.status(200).json({ message: 'Folder deleted successfully', id });
  } catch (error: any) {
    console.error('Delete Folder API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth((req, res) => {
  return withPermission('Documents', 'delete', handler)(req, res);
});
