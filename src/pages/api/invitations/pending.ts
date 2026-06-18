import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const userId = req.user?.userId;
  const userPhone = req.user?.phone;

  if (!userId || !userPhone) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    // Fetch all pending invitations for the user's phone number
    const result = await query(
      `SELECT 
        i.id, 
        i.workspace_id, 
        i.role, 
        i.status, 
        i.created_at, 
        w.name AS workspace_name, 
        u.name AS inviter_name
       FROM invitations i
       JOIN workspaces w ON i.workspace_id = w.id
       JOIN users u ON i.invited_by = u.id
       WHERE i.phone_number = $1 AND i.status = 'PENDING'
       ORDER BY i.created_at DESC`,
      [userPhone]
    );

    return res.status(200).json({ invitations: result.rows });
  } catch (error: any) {
    console.error('Fetch Pending Invitations API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
