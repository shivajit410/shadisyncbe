import { query } from './db';

/**
 * Creates a notification in the database and dispatches a push notification to Expo if the user has registered a token.
 */
export async function createNotification(userId: string, title: string, message: string) {
  try {
    // 1. Insert into PostgreSQL notifications table
    const result = await query(
      'INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3) RETURNING *',
      [userId, title, message]
    );

    // 2. Fetch target user's registered push token
    const userRes = await query('SELECT push_token FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length > 0) {
      const pushToken = userRes.rows[0].push_token;
      
      // Enforce Expo push token formatting
      if (pushToken && pushToken.startsWith('ExponentPushToken[')) {
        try {
          const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({
              to: pushToken,
              sound: 'default',
              title: title,
              body: message,
            }),
          });
          if (!response.ok) {
            console.error('Expo push delivery warning, status:', response.status);
          }
        } catch (pushErr) {
          console.error('Failed to dispatch Expo push request:', pushErr);
        }
      }
    }

    return result.rows[0];
  } catch (err) {
    console.error('createNotification Error:', err);
    throw err;
  }
}

/**
 * Evaluates the wedding workspace budget total against expense sums, triggering warnings at 90% or 100%.
 */
export async function checkAndNotifyBudget(workspaceId: string, userId?: string) {
  try {
    const res = await query(
      `SELECT b.allocated, b.spent, w.name, w.owner_id 
       FROM budgets b
       JOIN workspaces w ON b.workspace_id = w.id
       WHERE b.workspace_id = $1`,
      [workspaceId]
    );

    if (res.rows.length > 0) {
      const { allocated, spent, name: workspaceName, owner_id: ownerId } = res.rows[0];
      const allocatedNum = Number(allocated);
      const spentNum = Number(spent);

      if (allocatedNum > 0) {
        const ratio = spentNum / allocatedNum;
        
        if (ratio >= 1.0) {
          await createNotification(
            ownerId,
            'Budget Limit Reached (100%)',
            `Alert: Your expenses in "${workspaceName}" have reached 100% of your allocated budget (₹${spentNum.toLocaleString('en-IN')} / ₹${allocatedNum.toLocaleString('en-IN')}).`
          );
        } else if (ratio >= 0.90) {
          await createNotification(
            ownerId,
            'Budget Warning (90%)',
            `Warning: Your expenses in "${workspaceName}" have reached 90% of your allocated budget (₹${spentNum.toLocaleString('en-IN')} / ₹${allocatedNum.toLocaleString('en-IN')}).`
          );
        }
      }
    }

    // 2. Member-specific budget allocation check
    if (userId) {
      const memberRes = await query(
        `SELECT wm.allocated_budget, u.name as user_name, w.name as workspace_name, w.owner_id
         FROM workspace_members wm
         JOIN users u ON wm.user_id = u.id
         JOIN workspaces w ON wm.workspace_id = w.id
         WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
        [workspaceId, userId]
      );

      if (memberRes.rows.length > 0) {
        const { allocated_budget, user_name, workspace_name, owner_id } = memberRes.rows[0];
        const memberAllocated = Number(allocated_budget);

        if (memberAllocated > 0) {
          // Calculate sum of expenses logged by this member in this workspace
          const spentRes = await query(
            'SELECT SUM(amount) as member_spent FROM expenses WHERE workspace_id = $1 AND created_by = $2',
            [workspaceId, userId]
          );
          const memberSpent = Number(spentRes.rows[0]?.member_spent || 0);
          const ratio = memberSpent / memberAllocated;

          if (ratio >= 1.0) {
            // Notify both owner and the member themselves
            await createNotification(
              owner_id,
              `Member Budget Limit Reached: ${user_name}`,
              `Alert: ${user_name} has reached 100% of their allocated budget in "${workspace_name}" (₹${memberSpent.toLocaleString('en-IN')} / ₹${memberAllocated.toLocaleString('en-IN')}).`
            );
            if (userId !== owner_id) {
              await createNotification(
                userId,
                'Personal Budget Limit Reached (100%)',
                `Alert: You have reached 100% of your allocated budget in "${workspace_name}" (₹${memberSpent.toLocaleString('en-IN')} / ₹${memberAllocated.toLocaleString('en-IN')}).`
              );
            }
          } else if (ratio >= 0.90) {
            await createNotification(
              owner_id,
              `Member Budget Warning: ${user_name}`,
              `Warning: ${user_name} has reached 90% of their allocated budget in "${workspace_name}" (₹${memberSpent.toLocaleString('en-IN')} / ₹${memberAllocated.toLocaleString('en-IN')}).`
            );
            if (userId !== owner_id) {
              await createNotification(
                userId,
                'Personal Budget Warning (90%)',
                `Warning: You have reached 90% of your allocated budget in "${workspace_name}" (₹${memberSpent.toLocaleString('en-IN')} / ₹${memberAllocated.toLocaleString('en-IN')}).`
              );
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('checkAndNotifyBudget Error:', err);
  }
}
