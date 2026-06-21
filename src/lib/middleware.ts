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
 * Next.js API Middleware Wrapper to handle CORS headers and preflight OPTIONS requests
 */
export function withCors(handler: any) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,PATCH,POST,PUT,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    return await handler(req, res);
  };
}

/**
 * Next.js API Middleware Wrapper to protect routes with JWT Auth
 */
export function withAuth(handler: AuthenticatedHandler) {
  return withCors(async (req: AuthenticatedNextApiRequest, res: NextApiResponse) => {
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
  });
}
