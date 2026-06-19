const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT t.id, t.title, t.status, t.assigned_to, u.name as assignee_name 
      FROM tasks t 
      LEFT JOIN users u ON t.assigned_to = u.id
    `);
    console.log('Tasks with assignees:', res.rows);
    
    const users = await pool.query('SELECT id, name, phone FROM users');
    console.log('Users in DB:', users.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
