import { NextApiRequest, NextApiResponse } from 'next';
import { verifyToken, TokenPayload } from './auth';

export interface AuthenticatedNextApiRequest extends NextApiRequest {
  user?: TokenPayload;
}

export type AuthenticatedHandler = (
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) => Promise<void> | void;

/**
 * Next.js API Middleware Wrapper to protect routes with JWT Auth
 */
export function withAuth(handler: AuthenticatedHandler) {
  return async (req: AuthenticatedNextApiRequest, res: NextApiResponse) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication required. Authorization header missing.' });
      }

      const token = authHeader.split(' ')[1];
      const payload = verifyToken(token);
      
      // Inject authenticated user info into request object
      req.user = payload;

      return await handler(req, res);
    } catch (error: any) {
      return res.status(401).json({ message: error.message || 'Unauthorized: Invalid token' });
    }
  };
}
