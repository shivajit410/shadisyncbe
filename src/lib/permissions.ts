import type { NextApiResponse } from 'next';
import { query } from './db';
import { AuthenticatedNextApiRequest } from './middleware';

/**
 * Checks if a user has a specific permission in a workspace for a module.
 */
export async function verifyPermission(
  userId: string,
  workspaceId: string,
  moduleName: string,
  action: 'view' | 'create' | 'edit' | 'delete'
): Promise<boolean> {
  try {
    // 1. Get user role in the workspace
    const memberResult = await query(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );

    if (memberResult.rows.length === 0) {
      return false; // Not a member
    }

    const role = memberResult.rows[0].role;

    // 2. Fetch permission for this role and module
    const permissionResult = await query(
      'SELECT can_view, can_create, can_edit, can_delete FROM member_permissions WHERE role = $1 AND module = $2',
      [role, moduleName]
    );

    if (permissionResult.rows.length === 0) {
      return false; // No permissions configured for this module/role
    }

    const perms = permissionResult.rows[0];

    switch (action) {
      case 'view':
        return perms.can_view;
      case 'create':
        return perms.can_create;
      case 'edit':
        return perms.can_edit;
      case 'delete':
        return perms.can_delete;
      default:
        return false;
    }
  } catch (error) {
    console.error('Error verifying permission:', error);
    return false;
  }
}

/**
 * Middleware wrapper to enforce module permissions.
 */
export function withPermission(
  moduleName: string,
  action: 'view' | 'create' | 'edit' | 'delete',
  handler: (req: AuthenticatedNextApiRequest, res: NextApiResponse) => void | Promise<void>
) {
  return async (req: AuthenticatedNextApiRequest, res: NextApiResponse) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Attempt to extract workspaceId
    const workspaceId =
      (req.query.workspaceId as string) ||
      (req.body.workspaceId as string) ||
      (req.headers['x-workspace-id'] as string);

    if (!workspaceId) {
      return res.status(400).json({ message: 'Workspace ID is required to verify permissions' });
    }

    const hasPermission = await verifyPermission(userId, workspaceId, moduleName, action);
    if (!hasPermission) {
      return res.status(403).json({
        message: `Forbidden: You do not have permission to ${action} ${moduleName} in this workspace`,
      });
    }

    return handler(req, res);
  };
}
