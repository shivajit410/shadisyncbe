import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { withPermission } from '@/lib/permissions';
import { checkAndNotifyBudget } from '@/lib/notifications';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { workspaceId } = req.method === 'GET' ? req.query : req.body;

  if (req.method === 'GET') {
    try {
      const result = await query(
        `SELECT e.id, e.amount, e.description, e.expense_date, e.created_at, e.task_id, e.created_by,
                c.name AS category_name, ev.title AS event_title, u.name AS creator_name, t.title AS task_title
         FROM expenses e
         LEFT JOIN categories c ON e.category_id = c.id
         LEFT JOIN events ev ON e.event_id = ev.id
         LEFT JOIN users u ON e.created_by = u.id
         LEFT JOIN tasks t ON e.task_id = t.id
         WHERE e.workspace_id = $1
         ORDER BY e.expense_date DESC, e.created_at DESC`,
        [workspaceId]
      );
      return res.status(200).json({ expenses: result.rows });
    } catch (error: any) {
      console.error('Fetch Expenses API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    const { amount, description, categoryId, eventId, taskId, expenseDate } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (amount === undefined || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ message: 'A valid positive expense amount is required' });
    }

    try {
      // 1. Check workspace overall budget limit
      const budgetRes = await query(
        'SELECT allocated FROM budgets WHERE workspace_id = $1',
        [workspaceId]
      );
      if (budgetRes.rows.length > 0) {
        const budget = budgetRes.rows[0];
        if (budget.allocated !== null && budget.allocated !== undefined) {
          const allocatedLimit = Number(budget.allocated);
          // Calculate the total spent in this workspace
          const totalSpentRes = await query(
            'SELECT SUM(amount) AS total_spent FROM expenses WHERE workspace_id = $1',
            [workspaceId]
          );
          const currentTotalSpent = Number(totalSpentRes.rows[0].total_spent || 0);
          if (currentTotalSpent + Number(amount) > allocatedLimit) {
            return res.status(400).json({
              message: `Expense exceeds workspace overall budget limit of ₹${allocatedLimit.toLocaleString('en-IN')}. Remaining: ₹${(allocatedLimit - currentTotalSpent).toLocaleString('en-IN')}`,
            });
          }
        }
      }

      // 2. Check user's allocated budget limit in the workspace
      const memberRes = await query(
        'SELECT role, allocated_budget FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );
      if (memberRes.rows.length > 0) {
        const member = memberRes.rows[0];
        if (member.allocated_budget !== null && member.allocated_budget !== undefined) {
          const limit = Number(member.allocated_budget);
          // Calculate the total spent by this user in this workspace
          const spentRes = await query(
            'SELECT SUM(amount) AS total_spent FROM expenses WHERE workspace_id = $1 AND created_by = $2',
            [workspaceId, userId]
          );
          const currentSpent = Number(spentRes.rows[0].total_spent || 0);
          if (currentSpent + Number(amount) > limit) {
            return res.status(400).json({
              message: `Expense exceeds your allocated budget limit of ₹${limit.toLocaleString('en-IN')}. Remaining: ₹${(limit - currentSpent).toLocaleString('en-IN')}`,
            });
          }
        }
      }

      // Validate category belongs to workspace
      if (categoryId) {
        const catCheck = await query(
          'SELECT 1 FROM categories WHERE id = $1 AND workspace_id = $2',
          [categoryId, workspaceId]
        );
        if (catCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Invalid Category ID' });
        }
      }

      // Validate event belongs to workspace
      if (eventId) {
        const eventCheck = await query(
          'SELECT 1 FROM events WHERE id = $1 AND workspace_id = $2',
          [eventId, workspaceId]
        );
        if (eventCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Invalid Event ID' });
        }
      }

      // Validate task belongs to workspace
      if (taskId) {
        const taskCheck = await query(
          'SELECT 1 FROM tasks WHERE id = $1 AND workspace_id = $2',
          [taskId, workspaceId]
        );
        if (taskCheck.rows.length === 0) {
          return res.status(400).json({ message: 'Invalid Task ID' });
        }
      }

      const formattedDate = expenseDate || new Date().toISOString().split('T')[0];

      const result = await query(
        `INSERT INTO expenses (workspace_id, amount, description, category_id, event_id, task_id, created_by, expense_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
         RETURNING *`,
        [
          workspaceId,
          Number(amount),
          description || null,
          categoryId || null,
          eventId || null,
          taskId || null,
          userId,
          formattedDate,
        ]
      );

      // Automatically update the budget spent amount
      await query(
        `UPDATE budgets 
         SET spent = COALESCE((SELECT SUM(amount) FROM expenses WHERE workspace_id = $1), 0.00), updated_at = NOW() 
         WHERE workspace_id = $1`,
        [workspaceId]
      );

      // Check budget spent warning thresholds (90% / 100%)
      await checkAndNotifyBudget(workspaceId, userId);

      return res.status(201).json({ expense: result.rows[0] });
    } catch (error: any) {
      console.error('Create Expense API Error:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}

export default withAuth((req, res) => {
  if (req.method === 'GET') {
    return withPermission('Expenses', 'view', handler)(req, res);
  }
  if (req.method === 'POST') {
    return withPermission('Expenses', 'create', handler)(req, res);
  }
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
});
