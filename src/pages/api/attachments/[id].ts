import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const userId = req.user?.userId;
  const { id: attachmentId } = req.query;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!attachmentId || typeof attachmentId !== 'string') {
    return res.status(400).json({ message: 'Attachment ID is required' });
  }

  try {
    // 1. Fetch Attachment and check workspace association via joined document or folder
    const checkResult = await query(
      `SELECT a.id, d.workspace_id AS doc_ws, f.workspace_id AS folder_ws 
       FROM attachments a
       LEFT JOIN documents d ON a.document_id = d.id
       LEFT JOIN folders f ON a.folder_id = f.id
       WHERE a.id = $1`,
      [attachmentId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    const workspaceId = checkResult.rows[0].doc_ws || checkResult.rows[0].folder_ws;
    if (!workspaceId) {
      return res.status(404).json({ message: 'Attachment workspace association not found' });
    }

    // 2. Verify user is a member of the workspace
    const memberCheck = await query(
      'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // 3. Delete attachment
    const deleteResult = await query('DELETE FROM attachments WHERE id = $1 RETURNING *', [attachmentId]);

    return res.status(200).json({
      message: 'Attachment removed successfully',
      attachment: deleteResult.rows[0],
    });
  } catch (error: any) {
    console.error('Delete Attachment API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
