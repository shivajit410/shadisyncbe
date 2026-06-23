import type { NextApiResponse } from 'next';
import { db, query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { createNotification } from '@/lib/notifications';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const userId = req.user?.userId;
  const userPhone = req.user?.phone;
  const { id: invitationId } = req.query;

  if (!userId || !userPhone) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!invitationId || typeof invitationId !== 'string') {
    return res.status(400).json({ message: 'Invitation ID is required' });
  }

  const { action } = req.body;
  if (!action || !['ACCEPT', 'REJECT'].includes(action)) {
    return res.status(400).json({ message: 'Action must be either ACCEPT or REJECT' });
  }

  try {
    // 1. Fetch the invitation details
    const inviteResult = await query(
      'SELECT workspace_id, phone_number, role, status, invited_by, permissions, allocated_budget FROM invitations WHERE id = $1',
      [invitationId]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ message: 'Invitation not found' });
    }

    const invite = inviteResult.rows[0];

    // 2. Security Check: ensure the invitation belongs to the logged-in user
    if (invite.phone_number !== userPhone) {
      return res.status(403).json({ message: 'Forbidden: You cannot respond to this invitation' });
    }

    // 3. Ensure the invitation is still pending
    if (invite.status !== 'PENDING') {
      return res.status(400).json({ message: `This invitation has already been ${invite.status.toLowerCase()}` });
    }

    if (action === 'ACCEPT') {
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        // Update invitation status to ACCEPTED
        await client.query(
          "UPDATE invitations SET status = 'ACCEPTED' WHERE id = $1",
          [invitationId]
        );

        // Add user as member to the workspace
        await client.query(
          'INSERT INTO workspace_members (workspace_id, user_id, role, permissions, allocated_budget) VALUES ($1, $2, $3, $4, $5)',
          [invite.workspace_id, userId, invite.role, invite.permissions ? JSON.stringify(invite.permissions) : null, invite.allocated_budget || null]
        );

        await client.query('COMMIT');

        // Notify the inviter that the invitation was accepted (non-blocking push)
        createNotification(
          invite.invited_by,
          'Invitation Accepted',
          `User with phone ${userPhone} has accepted your invitation to join the workspace.`
        ).catch((err) => console.error('Failed to notify inviter of accept:', err));

        return res.status(200).json({ message: 'Invitation accepted and workspace joined' });
      } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Accept Invitation Transaction Error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
      } finally {
        client.release();
      }
    } else {
      // Action is REJECT
      await query(
        "UPDATE invitations SET status = 'DECLINED' WHERE id = $1",
        [invitationId]
      );

      // Notify the inviter that the invitation was declined
      createNotification(
        invite.invited_by,
        'Invitation Declined',
        `User with phone ${userPhone} has declined your invitation to join the workspace.`
      ).catch((err) => console.error('Failed to notify inviter of decline:', err));

      return res.status(200).json({ message: 'Invitation rejected successfully' });
    }
  } catch (error: any) {
    console.error('Respond Invitation API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
