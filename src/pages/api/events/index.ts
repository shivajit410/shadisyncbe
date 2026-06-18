import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { withPermission } from '@/lib/permissions';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { workspaceId } = req.method === 'GET' ? req.query : req.body;

  if (req.method === 'GET') {
    try {
      const result = await query(
        'SELECT id, title, description, start_time, end_time, location, created_at FROM events WHERE workspace_id = $1 ORDER BY start_time ASC',
        [workspaceId]
      );
      return res.status(200).json({ events: result.rows });
    } catch (error: any) {
      console.error('Fetch Events API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
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

    try {
      const result = await query(
        'INSERT INTO events (workspace_id, title, description, start_time, end_time, location) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [workspaceId, title.trim(), description || null, startTime, endTime, location || null]
      );
      return res.status(201).json({ event: result.rows[0] });
    } catch (error: any) {
      console.error('Create Event API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

// 1. Authenticate the request
// 2. Ensure user has permission (view/create) on the Events module in this workspace
export default withAuth((req, res) => {
  if (req.method === 'GET') {
    return withPermission('Events', 'view', handler)(req, res);
  }
  if (req.method === 'POST') {
    return withPermission('Events', 'create', handler)(req, res);
  }
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
});
