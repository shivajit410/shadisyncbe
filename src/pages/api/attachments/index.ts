import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';

// Helper to get workspace ID for an entity
async function getEntityWorkspace(entityType: string, entityId: string): Promise<string | null> {
  let table = '';
  if (entityType === 'EVENT') table = 'events';
  else if (entityType === 'TASK') table = 'tasks';
  else if (entityType === 'NOTE') table = 'notes';
  else if (entityType === 'EXPENSE') table = 'expenses';
  else return null;

  try {
    const res = await query(`SELECT workspace_id FROM ${table} WHERE id = $1`, [entityId]);
    return res.rows.length > 0 ? res.rows[0].workspace_id : null;
  } catch {
    return null;
  }
}

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    const { entityType, entityId } = req.query;

    if (!entityType || !entityId || typeof entityType !== 'string' || typeof entityId !== 'string') {
      return res.status(400).json({ message: 'entityType and entityId are required' });
    }

    try {
      const workspaceId = await getEntityWorkspace(entityType, entityId);
      if (!workspaceId) {
        return res.status(404).json({ message: 'Entity not found' });
      }

      // Check if user is a member of this workspace
      const memberCheck = await query(
        'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Forbidden: You are not a member of this workspace' });
      }

      const result = await query(
        `SELECT a.id, a.document_id, a.folder_id, a.entity_type, a.entity_id, a.created_at,
                d.name AS document_name, d.file_url, d.file_size, d.mime_type,
                f.name AS folder_name
         FROM attachments a
         LEFT JOIN documents d ON a.document_id = d.id
         LEFT JOIN folders f ON a.folder_id = f.id
         WHERE a.entity_type = $1 AND a.entity_id = $2
         ORDER BY a.created_at DESC`,
        [entityType, entityId]
      );

      return res.status(200).json({ attachments: result.rows });
    } catch (error: any) {
      console.error('Fetch Attachments API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    const { documentId, folderId, entityType, entityId } = req.body;

    if ((!documentId && !folderId) || !entityType || !entityId) {
      return res.status(400).json({ message: 'Either documentId or folderId, and entityType and entityId are required' });
    }
    if (!['EXPENSE', 'TASK', 'NOTE', 'EVENT'].includes(entityType)) {
      return res.status(400).json({ message: 'Invalid entityType' });
    }

    try {
      const workspaceId = await getEntityWorkspace(entityType, entityId);
      if (!workspaceId) {
        return res.status(404).json({ message: 'Entity not found' });
      }

      // Verify user is a member of the workspace
      const memberCheck = await query(
        'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Verify the document or folder belongs to the same workspace
      if (documentId) {
        const docCheck = await query(
          'SELECT 1 FROM documents WHERE id = $1 AND workspace_id = $2',
          [documentId, workspaceId]
        );
        if (docCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Document does not belong to this workspace' });
        }

        // Check for duplicate attachment
        const dupCheck = await query(
          'SELECT id FROM attachments WHERE document_id = $1 AND entity_type = $2 AND entity_id = $3',
          [documentId, entityType, entityId]
        );
        if (dupCheck.rows.length > 0) {
          return res.status(400).json({ message: 'Document is already attached to this entity' });
        }
      }

      if (folderId) {
        const folderCheck = await query(
          'SELECT 1 FROM folders WHERE id = $1 AND workspace_id = $2',
          [folderId, workspaceId]
        );
        if (folderCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Folder does not belong to this workspace' });
        }

        // Check for duplicate attachment
        const dupCheck = await query(
          'SELECT id FROM attachments WHERE folder_id = $1 AND entity_type = $2 AND entity_id = $3',
          [folderId, entityType, entityId]
        );
        if (dupCheck.rows.length > 0) {
          return res.status(400).json({ message: 'Folder is already attached to this entity' });
        }
      }

      const insertResult = await query(
        `INSERT INTO attachments (document_id, folder_id, entity_type, entity_id)
         VALUES ($1, $2, $3, $4) 
         RETURNING *`,
        [documentId || null, folderId || null, entityType, entityId]
      );

      // Re-fetch with document and folder info
      const fetchResult = await query(
        `SELECT a.id, a.document_id, a.folder_id, a.entity_type, a.entity_id, a.created_at,
                d.name AS document_name, d.file_url, d.file_size, d.mime_type,
                f.name AS folder_name
         FROM attachments a
         LEFT JOIN documents d ON a.document_id = d.id
         LEFT JOIN folders f ON a.folder_id = f.id
         WHERE a.id = $1`,
        [insertResult.rows[0].id]
      );

      return res.status(201).json({ attachment: fetchResult.rows[0] });
    } catch (error: any) {
      console.error('Create Attachment API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

export default withAuth(handler);
