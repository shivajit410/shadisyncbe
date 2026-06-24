const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// 1. Load env variables manually from .env file
const envPath = path.join(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  console.error('.env file not found at:', envPath);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.substring(1, value.length - 1);
    }
    env[match[1]] = value;
  }
});

const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables in .env');
  process.exit(1);
}

async function run() {
  console.log('--- starting database truncation and storage clear ---');

  // 2. Truncate DB Tables
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Connecting to PostgreSQL database...');
    // Truncate all tables CASCADE except member_permissions (seed data)
    const tablesToTruncate = [
      'users',
      'workspaces',
      'workspace_members',
      'invitations',
      'events',
      'categories',
      'tasks',
      'budgets',
      'expenses',
      'notes',
      'folders',
      'documents',
      'attachments',
      'notifications'
    ];

    console.log('Truncating tables...');
    await pool.query(`TRUNCATE TABLE ${tablesToTruncate.join(', ')} CASCADE;`);
    console.log('Database tables truncated successfully! (Cascade preserved permission seeds)');
  } catch (dbErr) {
    console.error('Database truncation failed:', dbErr);
  } finally {
    await pool.end();
  }

  // 3. Clear Supabase Storage
  try {
    console.log('\nConnecting to Supabase Storage...');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // List root contents
    const { data: rootItems, error: listError } = await supabase.storage
      .from('documents')
      .list();

    if (listError) {
      throw listError;
    }

    if (!rootItems || rootItems.length === 0) {
      console.log('Supabase storage bucket "documents" is already empty.');
    } else {
      console.log(`Found ${rootItems.length} root item(s) in documents bucket.`);

      for (const item of rootItems) {
        if (item.id === undefined) {
          // It's a folder (placeholder/directory structure)
          const folderName = item.name;
          console.log(`Listing files in folder: ${folderName}`);
          
          const { data: files, error: filesError } = await supabase.storage
            .from('documents')
            .list(folderName);

          if (filesError) {
            console.error(`Failed to list files in ${folderName}:`, filesError);
            continue;
          }

          if (files && files.length > 0) {
            const pathsToDelete = files.map(f => `${folderName}/${f.name}`);
            console.log(`Deleting files:`, pathsToDelete);
            const { error: delError } = await supabase.storage
              .from('documents')
              .remove(pathsToDelete);

            if (delError) {
              console.error(`Failed to delete files in ${folderName}:`, delError);
            } else {
              console.log(`Deleted files in folder ${folderName} successfully.`);
            }
          }
        } else {
          // It's a file in the root
          console.log(`Deleting root file: ${item.name}`);
          const { error: delError } = await supabase.storage
            .from('documents')
            .remove([item.name]);

          if (delError) {
            console.error(`Failed to delete root file ${item.name}:`, delError);
          } else {
            console.log(`Deleted root file ${item.name} successfully.`);
          }
        }
      }
    }

    console.log('\n======================================');
    console.log('TRUNCATION & STORAGE CLEANUP COMPLETED! ✅');
    console.log('======================================');
  } catch (storageErr) {
    console.error('Storage cleanup failed:', storageErr);
  }
}

run();
