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
- `source_records` is append-only: a trigger rejects `UPDATE` and `DELETE`.
- CI applies every migration to a fresh database on each push. Production (Neon) is migrated by hand with the **Migrate** workflow in GitHub Actions.
