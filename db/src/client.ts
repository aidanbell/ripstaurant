// The database connection shared by every script and job.
//
// Reads DATABASE_URL (Bun loads .env automatically). Required, so nothing silently
// falls back to a default server. Outside CI, a non-local database also needs the
// script to be run with --remote, so a stray .env can't point local runs at production.

import { SQL } from "bun";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL is not set. For local dev, copy .env.example to .env.",
  );

const { hostname } = new URL(url);
if (
  !LOCAL_HOSTS.includes(hostname) &&
  !process.env.CI &&
  !process.argv.includes("--remote")
)
  throw new Error(
    `DATABASE_URL points at ${hostname}, not a local database. Pass --remote if that's intended.`,
  );

export const sql = new SQL(url);
