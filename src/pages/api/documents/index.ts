import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { withPermission } from '@/lib/permissions';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { workspaceId, folderId } = req.method === 'GET' ? req.query : req.body;

  if (req.method === 'GET') {
    try {
      let sql = `
        SELECT d.*, u.name AS uploader_name 
        FROM documents d
        LEFT JOIN users u ON d.uploaded_by = u.id
        WHERE d.workspace_id = $1
      `;
      const params: any[] = [workspaceId];

      if (folderId === 'root') {
        sql += ' AND d.folder_id IS NULL';
      } else if (folderId && typeof folderId === 'string' && folderId.trim().length > 0) {
        sql += ' AND d.folder_id = $2';
        params.push(folderId);
      }

      sql += ' ORDER BY d.created_at DESC';

      const result = await query(sql, params);
      return res.status(200).json({ documents: result.rows });
    } catch (error: any) {
      console.error('Fetch Documents API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    const { name, fileUrl, fileSize, mimeType, folderId: destFolderId } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'Document name is required' });
    }
    if (!fileUrl || typeof fileUrl !== 'string') {
      return res.status(400).json({ message: 'File URL is required' });
    }

    try {
      // Validate folder exists in this workspace (if provided)
      if (destFolderId) {
        const folderCheck = await query(
          'SELECT 1 FROM folders WHERE id = $1 AND workspace_id = $2',
          [destFolderId, workspaceId]
        );
        if (folderCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Invalid Folder ID' });
        }
      }

      const result = await query(
        `INSERT INTO documents (workspace_id, folder_id, name, file_url, file_size, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [
          workspaceId,
          destFolderId || null,
          name.trim(),
          fileUrl,
          fileSize || 0,
          mimeType || 'application/octet-stream',
          userId,
        ]
      );

      return res.status(201).json({ document: result.rows[0] });
    } catch (error: any) {
      console.error('Create Document API Error:', error);
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
