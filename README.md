# RIPstaurant

A map and list of Toronto restaurants that have closed since March 2022, and why, built from City of Toronto open data and local news.

**Status:** research done; Phase 1 (foundation) in progress. The export contract and sample data are ready for frontend work.

- [web/](web/): the public site (React + Vite + MapLibre)
- [contract/](contract/): the site data format (Zod schemas + types) and sample data
- [db/](db/): Postgres + PostGIS schema migrations and the shared database client
- [pipeline/](pipeline/): scheduled jobs; the twice-monthly open data snapshot
- [research/news-extraction/](research/news-extraction/): news extraction prototype (Bun + Claude API)

```sh
bun install               # one workspace: contract, db, web, research/*
cp .env.example .env      # local DATABASE_URL
bun run db:up             # local Postgres + PostGIS in Docker
bun run db:migrate        # apply migrations (see db/README.md)
bun run snapshot          # pull the open datasets into the local DB (see pipeline/README.md)
bun run reference         # load neighbourhoods and Address Points
bun run address:report    # how well each dataset's addresses match
bun run sample            # rebuild contract/sample/ from the fixture
bun run sample:synthetic  # 10k-row perf-test export (git-ignored)
bun run typecheck         # every package, against the root tsconfig.base.json
bun run lint              # root ESLint config (packages extend it)
bun run format            # root Prettier config; format:check to verify
bun test
bun run start:web         # start vite dev server
```

Contains information licensed under the Open Government Licence – Toronto.
