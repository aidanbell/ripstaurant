# @ripstaurant/db

The database of record: Postgres 17 + PostGIS 3.5, locally in Docker and in production on Neon. Migrations are plain SQL; jobs connect with Bun's built-in client.

```ts
import { sql } from "@ripstaurant/db";

const [toronto] = await sql`select id from cities where slug = 'toronto'`;
```

## Local setup

```sh
cp .env.example .env   # DATABASE_URL for the local container
bun run db:up          # start Postgres + PostGIS (localhost:5432)
bun run db:migrate     # apply pending migrations
bun run db:psql        # psql shell inside the container
bun run db:reset       # drop the volume and rebuild from migrations
bun run db:down        # stop the container (data is kept)
```

## Migrations

`migrations/NNNN_name.sql`, applied in filename order, each in its own transaction, and recorded in `schema_migrations` with a checksum. **Never edit an applied migration**: the runner refuses to continue if one changed. Add a new file instead.

- Vocabularies (event types, statuses, reason codes, claims) are `text` + `CHECK`, and mirror `contract/src/codes.ts`. Change the contract first, then add a migration.
- `ingests` and `source_records` are append-only: a trigger rejects `UPDATE` and `DELETE`. Rows are identified by content hash, so an unchanged record is stored once (see `pipeline/README.md`).
- Scripts refuse a non-local `DATABASE_URL` outside CI unless run with `--remote`.
- CI applies every migration to a fresh database on each push. Production (Neon) is migrated by hand with the **Migrate** workflow in GitHub Actions.

## Backups

The **Backup** workflow (`.github/workflows/backup.yml`) runs after every Snapshot run, or by hand. It takes a `pg_dump` of production (~50 MB compressed) and stores it in two places:

- R2, at `backups/ripstaurant-<time>.dump`
- A release in the private backups repo (`BACKUP_REPO`)

Each has a `.sha256` next to it. Both keep 180 days: R2 through its lifecycle rule, GitHub through the workflow's prune step, which always keeps the newest 3.

**Restore** into an empty database. Not a migrated one: the dump includes the schema and `schema_migrations`, so `db:migrate` carries on from where the backup left off.

```sh
shasum -a 256 -c ripstaurant-<time>.dump.sha256
docker compose -f db/compose.yaml down -v && bun run db:up   # empty local database
docker compose -f db/compose.yaml exec -T db \
  pg_restore -U ripstaurant -d ripstaurant --no-owner --exit-on-error < ripstaurant-<time>.dump
bun run db:migrate                                           # applies anything newer
```

For Neon, restore into a new empty branch or project with `pg_restore -d "<its connection string>"` using the same flags, then point `DATABASE_URL` at it.
