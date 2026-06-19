import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { verifyPermission } from '@/lib/permissions';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const userId = req.user?.userId;
  const { id: eventId } = req.query;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!eventId || typeof eventId !== 'string') {
    return res.status(400).json({ message: 'Event ID is required' });
  }

  try {
    // 1. Fetch Event to get the workspace ID
    const eventCheck = await query('SELECT workspace_id FROM events WHERE id = $1', [eventId]);
    if (eventCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Event not found' });
    }
    const workspaceId = eventCheck.rows[0].workspace_id;

    // Handle UPDATE
    if (req.method === 'PUT' || req.method === 'PATCH') {
      // Check edit permission
      const hasEditPerm = await verifyPermission(userId, workspaceId, 'Events', 'edit');
      if (!hasEditPerm) {
        return res.status(403).json({ message: 'Forbidden: You do not have permission to edit events' });
      }

      const { title, description, startTime, endTime, location } = req.body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ message: 'Event title is required' });
      }
      if (!startTime || isNaN(Date.parse(startTime))) {
        return res.status(400).json({ message: 'Valid start time is required' });
      }
      if (!endTime || isNaN(Date.parse(endTime))) {
        return res.status(400).json({ message: 'Valid end time is required' });
      }
      if (new Date(startTime) > new Date(endTime)) {
        return res.status(400).json({ message: 'Start time must be before end time' });
      }

      const updateResult = await query(
        'UPDATE events SET title = $1, description = $2, start_time = $3, end_time = $4, location = $5, updated_at = NOW() WHERE id = $6 RETURNING *',
        [title.trim(), description || null, startTime, endTime, location || null, eventId]
      );

      return res.status(200).json({ event: updateResult.rows[0] });
    }

    // Handle DELETE
    if (req.method === 'DELETE') {
      // Check delete permission
      const hasDeletePerm = await verifyPermission(userId, workspaceId, 'Events', 'delete');
      if (!hasDeletePerm) {
        return res.status(403).json({ message: 'Forbidden: You do not have permission to delete events' });
      }

      // Cascade delete tasks linked to this event
      await query('DELETE FROM tasks WHERE event_id = $1', [eventId]);

      const deleteResult = await query('DELETE FROM events WHERE id = $1 RETURNING *', [eventId]);
      return res.status(200).json({ message: 'Event deleted successfully', event: deleteResult.rows[0] });
    }

    res.setHeader('Allow', ['PUT', 'PATCH', 'DELETE']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  } catch (error: any) {
    console.error('Event ID API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
