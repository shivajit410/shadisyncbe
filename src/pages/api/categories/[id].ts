import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { verifyPermission } from '@/lib/permissions';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const userId = req.user?.userId;
  const { id: categoryId } = req.query;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!categoryId || typeof categoryId !== 'string') {
    return res.status(400).json({ message: 'Category ID is required' });
  }

  try {
    // 1. Fetch Category to get the workspace ID
    const catCheck = await query('SELECT workspace_id FROM categories WHERE id = $1', [categoryId]);
    if (catCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }
    const workspaceId = catCheck.rows[0].workspace_id;

    // 2. Check delete permission on the Events module
    const hasDeletePerm = await verifyPermission(userId, workspaceId, 'Events', 'delete');
    if (!hasDeletePerm) {
      return res.status(403).json({ message: 'Forbidden: You do not have permission to delete categories' });
    }

    const deleteResult = await query('DELETE FROM categories WHERE id = $1 RETURNING *', [categoryId]);
    return res.status(200).json({
      message: 'Category deleted successfully',
      category: deleteResult.rows[0],
    });
  } catch (error: any) {
    console.error('Category ID API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
