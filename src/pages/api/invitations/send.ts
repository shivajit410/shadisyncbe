import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { createNotification } from '@/lib/notifications';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { workspaceId, phoneNumber, role } = req.body;

  // Input Validation
  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ message: 'Workspace ID is required' });
  }
  if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim().length < 8) {
    return res.status(400).json({ message: 'A valid phone number is required' });
  }
  if (!role || !['EDITOR', 'VIEWER'].includes(role)) {
    return res.status(400).json({ message: 'Role must be either EDITOR or VIEWER' });
  }

  const targetPhone = phoneNumber.trim();

  try {
    // 1. Verify workspace exists and sender is the OWNER
    const workspaceCheck = await query(
      `SELECT w.name, wm.role 
       FROM workspaces w 
       JOIN workspace_members wm ON w.id = wm.workspace_id 
       WHERE w.id = $1 AND wm.user_id = $2`,
      [workspaceId, userId]
    );

    if (workspaceCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Workspace not found or access denied' });
    }

    const { name: workspaceName, role: senderRole } = workspaceCheck.rows[0];
    if (senderRole !== 'OWNER') {
      return res.status(403).json({ message: 'Forbidden: Only the workspace owner can invite members' });
    }

    // 2. Check if there is already a pending invitation for this workspace and phone
    const pendingCheck = await query(
      "SELECT id FROM invitations WHERE workspace_id = $1 AND phone_number = $2 AND status = 'PENDING'",
      [workspaceId, targetPhone]
    );
    if (pendingCheck.rows.length > 0) {
      return res.status(400).json({ message: 'An invitation is already pending for this phone number' });
    }

    // 3. Find if target user already exists
    const userCheck = await query('SELECT id, name FROM users WHERE phone = $1', [targetPhone]);
    const targetUserExists = userCheck.rows.length > 0;

    if (targetUserExists) {
      const targetUser = userCheck.rows[0];

      // Check if target user is already a member
      const memberCheck = await query(
        'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, targetUser.id]
      );
      if (memberCheck.rows.length > 0) {
        return res.status(400).json({ message: 'User is already a member of this workspace' });
      }

      // Create Invite
      const inviteResult = await query(
        "INSERT INTO invitations (workspace_id, phone_number, role, status, invited_by) VALUES ($1, $2, $3, 'PENDING', $4) RETURNING *",
        [workspaceId, targetPhone, role, userId]
      );

      // Create Notification for target user
      await createNotification(
        targetUser.id,
        'New Workspace Invitation',
        `You have been invited to join the workspace "${workspaceName}" as an ${role}.`
      );

      return res.status(201).json({
        message: 'Invitation sent successfully',
        invite: inviteResult.rows[0],
        userExists: true,
      });
    } else {
      // Create Pending Invite for unregistered user
      const inviteResult = await query(
        "INSERT INTO invitations (workspace_id, phone_number, role, status, invited_by) VALUES ($1, $2, $3, 'PENDING', $4) RETURNING *",
        [workspaceId, targetPhone, role, userId]
      );

      return res.status(201).json({
        message: 'Pending invitation created for unregistered user',
        invite: inviteResult.rows[0],
        userExists: false,
      });
    }
  } catch (error: any) {
    console.error('Send Invitation API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
