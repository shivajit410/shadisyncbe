const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Manually parse .env file
try {
  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const dotenvLines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of dotenvLines) {
      const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    }
  }
} catch (e) {
  console.warn("Failed to load .env file manually:", e);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT t.*, u.name as assignee_name, e.title as event_title, c.name as category_name 
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      LEFT JOIN events e ON t.event_id = e.id
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.workspace_id = '35cf7edf-0850-45ad-bede-e5c8caae27ac'
    `);
    const resPerms = await pool.query('SELECT * FROM member_permissions');
    console.log('Member Permissions:', resPerms.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
