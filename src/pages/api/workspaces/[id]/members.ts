import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const userId = req.user?.userId;
  const { id: workspaceId } = req.query;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ message: 'Workspace ID is required' });
  }

  try {
    // Check if the current user is a member of the workspace
    const memberCheck = await query(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Forbidden: You are not a member of this workspace' });
    }

    // Fetch all members with user details
    const result = await query(
      `SELECT u.id, u.name, u.phone, m.role 
       FROM workspace_members m
       JOIN users u ON m.user_id = u.id
       WHERE m.workspace_id = $1
       ORDER BY u.name ASC`,
      [workspaceId]
    );

    return res.status(200).json({ members: result.rows });
  } catch (error: any) {
    console.error('Fetch Workspace Members API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
