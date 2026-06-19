import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { withPermission } from '@/lib/permissions';
import { createNotification } from '@/lib/notifications';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { workspaceId } = req.method === 'GET' ? req.query : req.body;

  if (req.method === 'GET') {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
      const memberRoleResult = await query(
        'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );
      const role = memberRoleResult.rows[0]?.role || 'VIEWER';

      let result;
      if (role === 'OWNER' || role === 'EDITOR') {
        result = await query(
          `SELECT t.*, u.name as assignee_name, e.title as event_title, c.name as category_name 
           FROM tasks t
           LEFT JOIN users u ON t.assigned_to = u.id
           LEFT JOIN events e ON t.event_id = e.id
           LEFT JOIN categories c ON t.category_id = c.id
           WHERE t.workspace_id = $1
           ORDER BY t.due_date ASC, t.created_at DESC`,
          [workspaceId]
        );
      } else {
        result = await query(
          `SELECT t.*, u.name as assignee_name, e.title as event_title, c.name as category_name 
           FROM tasks t
           LEFT JOIN users u ON t.assigned_to = u.id
           LEFT JOIN events e ON t.event_id = e.id
           LEFT JOIN categories c ON t.category_id = c.id
           WHERE t.workspace_id = $1 AND (t.assigned_to = $2 OR t.created_by = $2 OR t.assigned_to IS NULL)
           ORDER BY t.due_date ASC, t.created_at DESC`,
          [workspaceId, userId]
        );
      }
      return res.status(200).json({ tasks: result.rows });
    } catch (error: any) {
      console.error('Fetch Tasks API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    const { title, description, priority, assignedTo, dueDate, eventId, categoryId } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ message: 'Task title is required' });
    }
    if (!priority || !['Low', 'Medium', 'High'].includes(priority)) {
      return res.status(400).json({ message: 'Invalid priority level' });
    }

    try {
      // Validate assignee is in workspace (if assignedTo is provided)
      if (assignedTo) {
        const memberCheck = await query(
          'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
          [workspaceId, assignedTo]
        );
        if (memberCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Assignee must be a member of this workspace' });
        }
      }

      // Validate event belongs to workspace (if eventId is provided)
      if (eventId) {
        const eventCheck = await query(
          'SELECT 1 FROM events WHERE id = $1 AND workspace_id = $2',
          [eventId, workspaceId]
        );
        if (eventCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Invalid Event ID for this workspace' });
        }
      }

      // Validate category belongs to workspace (if categoryId is provided)
      if (categoryId) {
        const catCheck = await query(
          'SELECT 1 FROM categories WHERE id = $1 AND workspace_id = $2',
          [categoryId, workspaceId]
        );
        if (catCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Invalid Category ID for this workspace' });
        }
      }

      const result = await query(
        `INSERT INTO tasks (workspace_id, title, description, priority, assigned_to, due_date, event_id, category_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING *`,
        [
          workspaceId,
          title.trim(),
          description || null,
          priority,
          assignedTo || null,
          dueDate || null,
          eventId || null,
          categoryId || null,
          userId,
        ]
      );

      // Create notification for assignee
      if (assignedTo && assignedTo !== userId) {
        await createNotification(
          assignedTo,
          'New Task Assigned',
          `You have been assigned the task: "${title.trim()}"`
        );
      }

      return res.status(201).json({ task: result.rows[0] });
    } catch (error: any) {
      console.error('Create Task API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

export default withAuth((req, res) => {
  if (req.method === 'GET') {
    return withPermission('Tasks', 'view', handler)(req, res);
  }
  if (req.method === 'POST') {
    return withPermission('Tasks', 'create', handler)(req, res);
  }
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
});
