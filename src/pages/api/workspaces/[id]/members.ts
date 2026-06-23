import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', ['GET', 'PUT']);
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

    const userRole = memberCheck.rows[0].role;

    if (req.method === 'PUT') {
      if (userRole !== 'OWNER') {
        return res.status(403).json({ message: 'Forbidden: Only the workspace owner can edit member settings' });
      }

      const { targetUserId, invitationId, role, permissions, allocatedBudget } = req.body;

      if (targetUserId) {
        if (role && !['OWNER', 'EDITOR', 'VIEWER'].includes(role)) {
          return res.status(400).json({ message: 'Invalid role' });
        }

        await query(
          `UPDATE workspace_members 
           SET role = COALESCE($1, role), 
               permissions = COALESCE($2, permissions), 
               allocated_budget = $3 
           WHERE workspace_id = $4 AND user_id = $5`,
          [
            role || null,
            permissions ? JSON.stringify(permissions) : null,
            allocatedBudget !== undefined && allocatedBudget !== '' ? Number(allocatedBudget) : null,
            workspaceId,
            targetUserId
          ]
        );

        return res.status(200).json({ message: 'Member updated successfully' });
      } else if (invitationId) {
        if (role && !['EDITOR', 'VIEWER'].includes(role)) {
          return res.status(400).json({ message: 'Invalid role' });
        }

        await query(
          `UPDATE invitations 
           SET role = COALESCE($1, role), 
               permissions = COALESCE($2, permissions), 
               allocated_budget = $3 
           WHERE id = $4 AND workspace_id = $5`,
          [
            role || null,
            permissions ? JSON.stringify(permissions) : null,
            allocatedBudget !== undefined && allocatedBudget !== '' ? Number(allocatedBudget) : null,
            invitationId,
            workspaceId
          ]
        );

        return res.status(200).json({ message: 'Invitation updated successfully' });
      }

      return res.status(400).json({ message: 'Either targetUserId or invitationId is required' });
    }

    // Fetch all members with user details
    const result = await query(
      `SELECT u.id, u.name, u.phone, m.role, m.permissions, m.allocated_budget 
       FROM workspace_members m
       JOIN users u ON m.user_id = u.id
       WHERE m.workspace_id = $1
       ORDER BY u.name ASC`,
      [workspaceId]
    );

    // Fetch pending invitations
    const invitesResult = await query(
      `SELECT id, phone_number, role, status, permissions, allocated_budget, created_at
       FROM invitations
       WHERE workspace_id = $1 AND status = 'PENDING'
       ORDER BY created_at DESC`,
      [workspaceId]
    );

    return res.status(200).json({ 
      members: result.rows,
      invitations: invitesResult.rows
    });
  } catch (error: any) {
    console.error('Workspace Members API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth((req, res) => {
  if (req.method === 'GET' || req.method === 'PUT') {
    return handler(req, res);
  }
  res.setHeader('Allow', ['GET', 'PUT']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
});
