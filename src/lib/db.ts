import { Pool } from 'pg';

let pool: Pool;

if (process.env.NODE_ENV === 'production') {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false, // Required for Supabase in some serverless/hosting envs
    },
  });
} else {
  if (!(global as any).pgPool) {
    (global as any).pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }
  pool = (global as any).pgPool;
}

export const db = pool;

// Query helper for ease of use
export async function query<T = any>(text: string, params?: any[]) {
  const start = Date.now();
  const res = await db.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log('Executed query', { text, duration, rowsCount: res.rowCount });
  }
  return res;
}
