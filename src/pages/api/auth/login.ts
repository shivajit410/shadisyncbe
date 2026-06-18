import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { comparePassword, generateToken } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const { phone, password } = req.body;

  // Simple Input Validation
  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ message: 'Phone number is required' });
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ message: 'Password is required' });
  }

  const normalizedPhone = phone.trim();

  try {
    // Retrieve the user from the database
    const userResult = await query(
      'SELECT id, name, phone, password_hash FROM users WHERE phone = $1',
      [normalizedPhone]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid phone number or password' });
    }

    const dbUser = userResult.rows[0];

    // Verify Password
    const isPasswordValid = await comparePassword(password, dbUser.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid phone number or password' });
    }

    // Generate JWT Token
    const token = generateToken({
      userId: dbUser.id,
      phone: dbUser.phone,
    });

    return res.status(200).json({
      token,
      user: {
        id: dbUser.id,
        name: dbUser.name,
        phone: dbUser.phone,
      },
    });
  } catch (error: any) {
    console.error('Login API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
