import type { NextApiResponse } from 'next';
import { query } from '@/lib/db';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/middleware';
import { verifyPermission } from '@/lib/permissions';
import { checkAndNotifyBudget } from '@/lib/notifications';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const userId = req.user?.userId;
  const { id: expenseId } = req.query;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!expenseId || typeof expenseId !== 'string') {
    return res.status(400).json({ message: 'Expense ID is required' });
  }

  try {
    // 1. Fetch Expense to get workspace ID
    const expCheck = await query('SELECT workspace_id FROM expenses WHERE id = $1', [expenseId]);
    if (expCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Expense not found' });
    }
    const workspaceId = expCheck.rows[0].workspace_id;

    // Handle UPDATE (PUT)
    if (req.method === 'PUT') {
      const hasEditPerm = await verifyPermission(userId, workspaceId, 'Expenses', 'edit');
      if (!hasEditPerm) {
        return res.status(403).json({ message: 'Forbidden: You do not have permission to edit expenses' });
      }

      const { amount, description, categoryId, eventId, taskId, expenseDate } = req.body;

      if (amount === undefined || isNaN(Number(amount)) || Number(amount) <= 0) {
        return res.status(400).json({ message: 'A valid positive expense amount is required' });
      }

      // 1. Check workspace overall budget limit (excluding this expense's current amount)
      const budgetRes = await query(
        'SELECT allocated FROM budgets WHERE workspace_id = $1',
        [workspaceId]
      );
      if (budgetRes.rows.length > 0) {
        const budget = budgetRes.rows[0];
        if (budget.allocated !== null && budget.allocated !== undefined) {
          const allocatedLimit = Number(budget.allocated);
          // Calculate the total spent in this workspace, excluding this expense
          const totalSpentRes = await query(
            'SELECT SUM(amount) AS total_spent FROM expenses WHERE workspace_id = $1 AND id != $2',
            [workspaceId, expenseId]
          );
          const currentTotalSpent = Number(totalSpentRes.rows[0].total_spent || 0);
          if (currentTotalSpent + Number(amount) > allocatedLimit) {
            return res.status(400).json({
              message: `Expense exceeds workspace overall budget limit of ₹${allocatedLimit.toLocaleString('en-IN')}. Remaining: ₹${(allocatedLimit - currentTotalSpent).toLocaleString('en-IN')}`,
            });
          }
        }
      }

      // 2. Check user's allocated budget limit in the workspace (excluding this expense's current amount)
      const memberRes = await query(
        'SELECT role, allocated_budget FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );
      if (memberRes.rows.length > 0) {
        const member = memberRes.rows[0];
        if (member.allocated_budget !== null && member.allocated_budget !== undefined) {
          const limit = Number(member.allocated_budget);
          // Calculate the total spent by this user in this workspace, excluding this expense
          const spentRes = await query(
            'SELECT SUM(amount) AS total_spent FROM expenses WHERE workspace_id = $1 AND created_by = $2 AND id != $3',
            [workspaceId, userId, expenseId]
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

      const updateResult = await query(
        `UPDATE expenses 
         SET amount = $1, description = $2, category_id = $3, event_id = $4, task_id = $5, expense_date = $6 
         WHERE id = $7 
         RETURNING *`,
        [Number(amount), description || null, categoryId || null, eventId || null, taskId || null, formattedDate, expenseId]
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

      return res.status(200).json({ expense: updateResult.rows[0] });
    }

    // Handle DELETE
    if (req.method === 'DELETE') {
      const hasDeletePerm = await verifyPermission(userId, workspaceId, 'Expenses', 'delete');
      if (!hasDeletePerm) {
        return res.status(403).json({ message: 'Forbidden: You do not have permission to delete expenses' });
      }

      const deleteResult = await query('DELETE FROM expenses WHERE id = $1 RETURNING *', [expenseId]);

      // Automatically update the budget spent amount
      await query(
        `UPDATE budgets 
         SET spent = COALESCE((SELECT SUM(amount) FROM expenses WHERE workspace_id = $1), 0.00), updated_at = NOW() 
         WHERE workspace_id = $1`,
        [workspaceId]
      );

      // Check budget spent warning thresholds (90% / 100%)
      await checkAndNotifyBudget(workspaceId, userId);

      return res.status(200).json({
        message: 'Expense deleted successfully',
        expense: deleteResult.rows[0],
      });
    }

    res.setHeader('Allow', ['PUT', 'DELETE']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  } catch (error: any) {
    console.error('Expense ID API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default withAuth(handler);
