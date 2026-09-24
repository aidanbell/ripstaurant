// The database connection shared by every script and job.
//
// Reads DATABASE_URL (Bun loads .env automatically). Required, so nothing silently
// falls back to a default server.

import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL is not set. For local dev, copy .env.example to .env.",
  );

export const sql = new SQL(url);
