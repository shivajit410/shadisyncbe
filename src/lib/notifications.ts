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
export async function checkAndNotifyBudget(workspaceId: string) {
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
  } catch (err) {
    console.error('checkAndNotifyBudget Error:', err);
  }
}
