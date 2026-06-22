import type { NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { withPermission } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';

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
    return res.status(400).json({ message: 'Document ID is required' });
  }

  try {
    // 1. Fetch document metadata
    const docRes = await query('SELECT * FROM documents WHERE id = $1', [id]);
    if (docRes.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const doc = docRes.rows[0];

    // 2. Try deleting file from storage/disk
    try {
      if (doc.file_url.startsWith('/uploads/')) {
        const filePath = path.join(process.cwd(), 'public', doc.file_url);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } else if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        // Extract storage path from supabase public URL
        const marker = '/storage/v1/object/public/documents/';
        const markerIndex = doc.file_url.indexOf(marker);
        if (markerIndex !== -1) {
          const storagePath = doc.file_url.substring(markerIndex + marker.length);
          await supabase.storage.from('documents').remove([storagePath]);
        }
      }
    } catch (storageErr) {
      console.error('Failed to delete file from storage:', storageErr);
    }

    // 3. Delete document row (cascades to attachments)
    await query('DELETE FROM documents WHERE id = $1', [id]);

    return res.status(200).json({ message: 'Document deleted successfully', id });
  } catch (error: any) {
    console.error('Delete Document API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth((req, res) => {
  return withPermission('Documents', 'delete', handler)(req, res);
});
