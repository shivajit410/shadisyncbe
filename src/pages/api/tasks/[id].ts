import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { verifyPermission } from '@/lib/permissions';
import { createNotification } from '@/lib/notifications';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const userId = req.user?.userId;
  const { id: taskId } = req.query;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ message: 'Task ID is required' });
  }

  try {
    // 1. Fetch Task to get workspace_id, current assignee, and creator
    const taskCheck = await query('SELECT workspace_id, assigned_to, created_by, title, status FROM tasks WHERE id = $1', [taskId]);
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }
    const { workspace_id: workspaceId, assigned_to: previousAssignee, created_by: taskCreator, title: taskTitle } = taskCheck.rows[0];

    // Handle UPDATE
    if (req.method === 'PUT' || req.method === 'PATCH') {
      // Fetch user's role in the workspace
      const memberRoleRes = await query(
        'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );
      const userRole = memberRoleRes.rows[0]?.role;
      const isWorkspaceOwner = userRole === 'OWNER';
      const isAssignee = previousAssignee === userId;

      // If the task has an assignee, ONLY the workspace owner and the assignee can modify/tick it!
      if (previousAssignee) {
        if (!isWorkspaceOwner && !isAssignee) {
          return res.status(403).json({ message: 'Forbidden: Only the workspace owner and the assigned user can modify this task' });
        }
      } else {
        // Fallback to standard permission checks if there is no assignee
        const hasEditPerm = await verifyPermission(userId, workspaceId, 'Tasks', 'edit');
        const isCreator = taskCreator === userId;
        if (!hasEditPerm && !isAssignee && !isCreator && !isWorkspaceOwner) {
          return res.status(403).json({ message: 'Forbidden: You do not have permission to edit tasks' });
        }
      }

      const { title, description, status, priority, assignedTo, dueDate, eventId, categoryId } = req.body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ message: 'Task title is required' });
      }
      if (!status || !['Pending', 'In Progress', 'Completed'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status value' });
      }
      if (!priority || !['Low', 'Medium', 'High'].includes(priority)) {
        return res.status(400).json({ message: 'Invalid priority level' });
      }

      // Validate assignee (if provided)
      if (assignedTo) {
        const memberCheck = await query(
          'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
          [workspaceId, assignedTo]
        );
        if (memberCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Assignee must be a member of this workspace' });
        }
      }

      // Validate event (if provided)
      if (eventId) {
        const eventCheck = await query(
          'SELECT 1 FROM events WHERE id = $1 AND workspace_id = $2',
          [eventId, workspaceId]
        );
        if (eventCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Invalid Event ID' });
        }
      }

      // Validate category (if provided)
      if (categoryId) {
        const catCheck = await query(
          'SELECT 1 FROM categories WHERE id = $1 AND workspace_id = $2',
          [categoryId, workspaceId]
        );
        if (catCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Invalid Category ID' });
        }
      }

      const updateResult = await query(
        `UPDATE tasks 
         SET title = $1, description = $2, status = $3, priority = $4, assigned_to = $5, due_date = $6, event_id = $7, category_id = $8, updated_at = NOW() 
         WHERE id = $9 
         RETURNING *`,
        [
          title.trim(),
          description || null,
          status,
          priority,
          assignedTo || null,
          dueDate || null,
          eventId || null,
          categoryId || null,
          taskId,
        ]
      );

      const updatedTask = updateResult.rows[0];

      // Send assignment notification if assignee changed
      if (assignedTo && assignedTo !== previousAssignee && assignedTo !== userId) {
        await createNotification(
          assignedTo,
          'Task Assigned',
          `You have been assigned the task: "${title.trim()}"`
        );
      }

      // Send completion notification if task was marked Completed
      if (status === 'Completed' && status !== taskCheck.rows[0].status) {
        const ownerCheck = await query('SELECT owner_id FROM workspaces WHERE id = $1', [workspaceId]);
        const workspaceOwnerId = ownerCheck.rows[0]?.owner_id;

        // Notify creator if they are not the one who completed it
        if (taskCreator && taskCreator !== userId) {
          await createNotification(
            taskCreator,
            'Task Completed',
            `The task "${taskTitle}" was marked as Completed.`
          );
        }

        // Notify owner if they are not the creator and not the one who completed it
        if (workspaceOwnerId && workspaceOwnerId !== userId && workspaceOwnerId !== taskCreator) {
          await createNotification(
            workspaceOwnerId,
            'Task Completed',
            `The task "${taskTitle}" was marked as Completed.`
          );
        }
      }

      return res.status(200).json({ task: updatedTask });
    }

    // Handle DELETE
    if (req.method === 'DELETE') {
      const hasDeletePerm = await verifyPermission(userId, workspaceId, 'Tasks', 'delete');
      if (!hasDeletePerm) {
        return res.status(403).json({ message: 'Forbidden: You do not have permission to delete tasks' });
      }

      const deleteResult = await query('DELETE FROM tasks WHERE id = $1 RETURNING *', [taskId]);
      return res.status(200).json({ message: 'Task deleted successfully', task: deleteResult.rows[0] });
    }

    res.setHeader('Allow', ['PUT', 'PATCH', 'DELETE']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  } catch (error: any) {
    console.error('Task ID API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
