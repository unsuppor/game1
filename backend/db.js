// simple db helper (optional usage). If you don't use DB, leave this as a placeholder.
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || null });

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
