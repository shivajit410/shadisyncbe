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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set!");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  console.log("Running migrations...");
  try {
    // 1. Add task_id to expenses table
    await pool.query(`
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
    `);
    console.log("Added task_id column to expenses successfully.");

    // 2. Add cover_image_url to workspaces table
    await pool.query(`
      ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
    `);
    console.log("Added cover_image_url column to workspaces successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}

main();
