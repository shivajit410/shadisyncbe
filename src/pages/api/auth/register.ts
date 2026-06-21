import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { hashPassword, generateToken } from '@/lib/auth';
import { createNotification } from '@/lib/notifications';
import { withCors } from '@/lib/middleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("here")
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const { name, phone, password } = req.body;

  // Simple Input Validation
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ message: 'Name is required' });
  }
  if (!phone || typeof phone !== 'string' || phone.trim().length < 8) {
    return res.status(400).json({ message: 'A valid phone number is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  const normalizedPhone = phone.trim();

  try {
    // Check if phone number already exists
    const existingUser = await query('SELECT id FROM users WHERE phone = $1', [normalizedPhone]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'Phone number already registered' });
    }

    // Hash the password
    const hashed = await hashPassword(password);

    // Save the user to the database
    const insertResult = await query(
      'INSERT INTO users (name, phone, password_hash) VALUES ($1, $2, $3) RETURNING id, name, phone',
      [name.trim(), normalizedPhone, hashed]
    );

    const newUser = insertResult.rows[0];

    // Check for pre-existing pending invitations for this phone number
    try {
      const pendingInvites = await query(
        `SELECT i.id, w.name AS workspace_name, i.role 
         FROM invitations i
         JOIN workspaces w ON i.workspace_id = w.id
         WHERE i.phone_number = $1 AND i.status = 'PENDING'`,
        [normalizedPhone]
      );

      for (const invite of pendingInvites.rows) {
        await createNotification(
          newUser.id,
          'New Workspace Invitation',
          `You have a pending invitation to join "${invite.workspace_name}" as an ${invite.role}. Go to settings to respond!`
        );
      }
    } catch (inviteErr) {
      console.error('Failed to link pre-existing invitations:', inviteErr);
    }

    // Generate JWT Token
    const token = generateToken({
      userId: newUser.id,
      phone: newUser.phone,
    });

    return res.status(201).json({
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        phone: newUser.phone,
      },
    });
  } catch (error: any) {
    console.error('Registration API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withCors(handler);
