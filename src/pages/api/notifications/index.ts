import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      const result = await query(
        'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
        [userId]
      );
      return res.status(200).json({ notifications: result.rows });
    } catch (error: any) {
      console.error('Fetch Notifications API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    const { notificationId } = req.body;

    try {
      if (notificationId) {
        // Mark specific notification as read
        const result = await query(
          'UPDATE notifications SET read_status = TRUE WHERE id = $1 AND user_id = $2 RETURNING *',
          [notificationId, userId]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ message: 'Notification not found' });
        }
        return res.status(200).json({ notification: result.rows[0] });
      } else {
        // Mark all as read
        const result = await query(
          'UPDATE notifications SET read_status = TRUE WHERE user_id = $1 RETURNING *',
          [userId]
        );
        return res.status(200).json({ 
          message: 'All notifications marked as read', 
          count: result.rows.length 
        });
      }
    } catch (error: any) {
      console.error('Update Notifications API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

export default withAuth(handler);
