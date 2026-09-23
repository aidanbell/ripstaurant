# News extraction test

Extracts structured closure facts from news articles with Claude. See "News extraction test" in `../../PLAN.md` for results.

```sh
bun install
ANTHROPIC_API_KEY=... bun extract.ts            # all 25 sample articles
ANTHROPIC_API_KEY=... bun extract.ts --limit 3  # quick check
EFFORT=low bun extract.ts                       # compare effort levels
```

- `schema.ts`: output schema (closure types and reason codes match PLAN.md)
- `extract.ts`: runs extraction, writes `data/extractions.jsonl`, prints token usage and cost
- `data/` (git-ignored): `articles.json` (cleaned article text), `extractions.manual.jsonl` (hand-filled dry run for comparison)
