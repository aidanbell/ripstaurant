// Applies db/migrations/*.sql in filename order, each in its own transaction, and
// records it in schema_migrations.
//
//   bun run db:migrate
//   bun run db:migrate --remote   # a non-local database, outside CI
//
// Applied migrations must not change (a checksum catches it): add a new file instead.

import { readdir } from "node:fs/promises";
import { CryptoHasher } from "bun";
import { sql } from "./client";

const dir = new URL("../migrations/", import.meta.url);

await sql`
  create table if not exists schema_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )
`;

const rows: { name: string; checksum: string }[] =
  await sql`select name, checksum from schema_migrations`;
const applied = new Map(rows.map((r) => [r.name, r.checksum]));

const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
let count = 0;

for (const name of files) {
  const text = await Bun.file(new URL(name, dir)).text();
  const checksum = new CryptoHasher("sha256").update(text).digest("hex");
  const previous = applied.get(name);
  if (previous === checksum) continue;
  if (previous)
    throw new Error(
      `${name} changed after it was applied; add a new migration instead`,
    );

  await sql.begin(async (tx) => {
    await tx.unsafe(text);
    await tx`insert into schema_migrations (name, checksum) values (${name}, ${checksum})`;
  });
  console.log(`applied ${name}`);
  count++;
}

console.log(count ? `${count} migration(s) applied` : "up to date");
await sql.close();
