import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { pushToken } = req.body;

  if (pushToken === undefined) {
    return res.status(400).json({ message: 'pushToken is required' });
  }

  try {
    // Save push token to user profile
    await query(
      'UPDATE users SET push_token = $1, updated_at = NOW() WHERE id = $2',
      [pushToken ? pushToken.trim() : null, userId]
    );

    return res.status(200).json({ message: 'Push token registered successfully' });
  } catch (error: any) {
    console.error('Register Push Token API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
