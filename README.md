# RIPstaurant

A map and list of Toronto restaurants that have closed since March 2022, and why, built from City of Toronto open data and local news.

**Status:** research done; Phase 1 (foundation) in progress. The export contract and sample data are ready for frontend work.

- [PLAN.md](PLAN.md): concept, data model, architecture, development plan, decisions
- [docs/research/phase-0-findings.md](docs/research/phase-0-findings.md): what each data source can tell us
- [docs/hosting-options.md](docs/hosting-options.md): hosting comparison and costs
- [web/](web/): the public site (React + Vite + MapLibre)
- [contract/](contract/): the site data format (Zod schemas + types) and sample data
- [research/news-extraction/](research/news-extraction/): news extraction prototype (Bun + Claude API)

```sh
bun install
bun run sample            # rebuild contract/sample/ from the fixture
bun run sample:synthetic  # 10k-row perf-test export (git-ignored)
bun test && bun run typecheck
```

Contains information licensed under the Open Government Licence – Toronto.
