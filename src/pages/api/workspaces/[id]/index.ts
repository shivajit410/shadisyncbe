import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const userId = req.user?.userId;
  const { id: workspaceId } = req.query;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ message: 'Workspace ID is required' });
  }

  // 1. Check if the user is a member of the workspace and get their role and custom settings
  let memberRole: 'OWNER' | 'EDITOR' | 'VIEWER';
  let memberPermissions: any = null;
  let memberAllocatedBudget: any = null;
  try {
    const memberCheck = await query(
      'SELECT role, permissions, allocated_budget FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Forbidden: You are not a member of this workspace' });
    }
    memberRole = memberCheck.rows[0].role;
    memberPermissions = memberCheck.rows[0].permissions;
    memberAllocatedBudget = memberCheck.rows[0].allocated_budget;
  } catch (error: any) {
    console.error('Workspace Member Check Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }

  // Handle GET detail
  if (req.method === 'GET') {
    try {
      const result = await query(
        'SELECT id, name, wedding_date, owner_id, archived, created_at, cover_image_url FROM workspaces WHERE id = $1',
        [workspaceId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Workspace not found' });
      }

      return res.status(200).json({
        workspace: {
          ...result.rows[0],
          role: memberRole,
          permissions: memberPermissions,
          allocated_budget: memberAllocatedBudget,
        },
      });
    } catch (error: any) {
      console.error('Fetch Workspace Detail API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  // Handle UPDATE
  if (req.method === 'PUT' || req.method === 'PATCH') {
    // Only OWNER and EDITOR can edit workspace details
    if (memberRole !== 'OWNER' && memberRole !== 'EDITOR') {
      return res.status(403).json({ message: 'Forbidden: You do not have permission to edit this workspace' });
    }

    const { name, weddingDate, coverImageUrl } = req.body;
    
    // Support partial updates
    const queryFields: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ message: 'Workspace name is required' });
      }
      queryFields.push(`name = $${paramIndex++}`);
      queryParams.push(name.trim());
    }

    if (weddingDate !== undefined) {
      if (!weddingDate || isNaN(Date.parse(weddingDate))) {
        return res.status(400).json({ message: 'A valid wedding date is required' });
      }
      queryFields.push(`wedding_date = $${paramIndex++}`);
      queryParams.push(weddingDate);
    }

    if (coverImageUrl !== undefined) {
      queryFields.push(`cover_image_url = $${paramIndex++}`);
      queryParams.push(coverImageUrl || null);
    }

    if (queryFields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    try {
      queryParams.push(workspaceId);
      const updateResult = await query(
        `UPDATE workspaces SET ${queryFields.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`,
        queryParams
      );

      return res.status(200).json({
        workspace: {
          ...updateResult.rows[0],
          role: memberRole,
          permissions: memberPermissions,
          allocated_budget: memberAllocatedBudget,
        },
      });
    } catch (error: any) {
      console.error('Update Workspace API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  // Handle ARCHIVE (DELETE method)
  if (req.method === 'DELETE') {
    // Only the OWNER can archive the workspace
    if (memberRole !== 'OWNER') {
      return res.status(403).json({ message: 'Forbidden: Only the workspace owner can archive this workspace' });
    }

    try {
      const archiveResult = await query(
        'UPDATE workspaces SET archived = true, updated_at = NOW() WHERE id = $1 RETURNING *',
        [workspaceId]
      );

      return res.status(200).json({
        message: 'Workspace archived successfully',
        workspace: archiveResult.rows[0],
      });
    } catch (error: any) {
      console.error('Archive Workspace API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['GET', 'PUT', 'PATCH', 'DELETE']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

export default withAuth(handler);
