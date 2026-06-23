import type { NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { verifyPermission } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';

// Disable Next.js default body parser to allow formidable to parse multipart forms
export const config = {
  api: {
    bodyParser: false,
  },
};

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const form = formidable({
    keepExtensions: true,
    maxFileSize: 50 * 1024 * 1024, // 50MB limit
  });

  try {
    const { fields, files } = await new Promise<{ fields: formidable.Fields; files: formidable.Files }>(
      (resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) {
            reject(err);
          } else {
            resolve({ fields, files });
          }
        });
      }
    );

    const workspaceId = Array.isArray(fields.workspaceId) ? fields.workspaceId[0] : fields.workspaceId;
    const folderId = Array.isArray(fields.folderId) ? fields.folderId[0] : fields.folderId;
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!workspaceId) {
      return res.status(400).json({ message: 'workspaceId is required' });
    }
    if (!file) {
      return res.status(400).json({ message: 'No file was uploaded' });
    }

    // 1. Enforce Documents create permission
    const hasCreatePerm = await verifyPermission(userId, workspaceId, 'Documents', 'create');
    if (!hasCreatePerm) {
      return res.status(403).json({ message: 'Forbidden: You do not have permission to upload documents' });
    }

    // Validate folder exists in workspace (if provided)
    if (folderId && folderId !== 'root') {
      const folderCheck = await query(
        'SELECT 1 FROM folders WHERE id = $1 AND workspace_id = $2',
        [folderId, workspaceId]
      );
      if (folderCheck.rows.length === 0) {
        return res.status(400).json({ message: 'Invalid Folder ID' });
      }
    }

    const mimeType = file.mimetype || 'application/octet-stream';
    const fileSize = file.size;
    const originalName = file.originalFilename || 'unnamed_file';
    const storagePath = `${workspaceId}/${Date.now()}_${originalName}`;

    let fileUrl = '';

    // Try uploading to Supabase Storage if configured
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        // Ensure documents bucket exists and is public
        const { data: buckets } = await supabase.storage.listBuckets();
        const bucketExists = buckets?.some((b) => b.name === 'documents');
        if (!bucketExists) {
          await supabase.storage.createBucket('documents', {
            public: true,
          });
        } else {
          // Update bucket to make sure public is true
          await supabase.storage.updateBucket('documents', {
            public: true,
          });
        }

        const fileBuffer = fs.readFileSync(file.filepath);
        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, fileBuffer, {
            contentType: mimeType,
            upsert: true,
          });

        if (uploadError) {
          throw uploadError;
        }

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath);
        fileUrl = urlData.publicUrl;
      } catch (supabaseError: any) {
        console.error('Supabase upload failed:', supabaseError);
        return res.status(500).json({
          message: `Supabase storage upload failed: ${supabaseError.message || 'Unknown error'}`,
        });
      }
    }

    // Fallback: Save file locally in public/uploads
    if (!fileUrl) {
      const publicDir = path.join(process.cwd(), 'public');
      const uploadDir = path.join(publicDir, 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const fileName = `${Date.now()}_${originalName}`;
      const localPath = path.join(uploadDir, fileName);
      fs.copyFileSync(file.filepath, localPath);
      fileUrl = `/uploads/${fileName}`;
    }

    // Write metadata to PostgreSQL documents table
    const destFolderId = (folderId === 'root' || !folderId) ? null : folderId;

    const result = await query(
      `INSERT INTO documents (workspace_id, folder_id, name, file_url, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [workspaceId, destFolderId, originalName, fileUrl, fileSize, mimeType, userId]
    );

    // Re-fetch document with uploader's name
    const docRes = await query(
      `SELECT d.*, u.name AS uploader_name 
       FROM documents d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.id = $1`,
      [result.rows[0].id]
    );

    return res.status(201).json({ document: docRes.rows[0] });
  } catch (error: any) {
    console.error('File Upload Handling Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
