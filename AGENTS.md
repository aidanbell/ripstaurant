Here’s your refined AGENTS.md with the requested code snippet formatting:

---

# AGENTS.md

_Source of truth for coding agents in this repo. Edit only this file._

**For:** Cursor, Codex, Copilot, and other AGENTS.md clients.
**Claude Code:** Use [`CLAUDE.md`](./CLAUDE.md) (imports this file).

---

## Core Principles

1. **Trace first:** Understand the real flow—files touched, existing patterns, helpers.
2. **YAGNI:** Skip speculative code. Say why in one line.
3. **Reuse first:** Existing helpers, components, types, or patterns > new code.
4. **Stdlib/platform first:** Use native features (CSS over JS, DB constraints over app code).
5. **Minimal change:** Smallest diff that works. No drive-by refactors, new abstractions, or config "for later."
6. **Never skip:** Validation at trust boundaries, error handling, security, accessibility, or explicit user requests.

---

## Code Rules

### TypeScript

- Use TypeScript in TS/JS repos. No plain JS. Never weaken compiler flags.
- Prefer concrete types. `unknown` only for `JSON.parse`, untyped callbacks, or `catch` clauses—narrow immediately. Never use `any`.

### UI

- **No nested ternaries:** Use render functions or `if/else` for UI logic.

  ```tsx
  // Avoid
  {
    isLoading ? <Spinner /> : error ? <ErrorMessage /> : <List />;
  }
  // Prefer
  function renderList() {
    if (isLoading) return <Spinner />;
    if (error) return <ErrorMessage />;
    return <List />;
  }
  ```

- **Single ternary:** Only for `condition ? a : b`. For `null`/`undefined`, use `&&` or `??`.
- **Use existing wrappers:** `components/ui` for primitives, project layouts for page chrome, existing composites for widgets.
- **Theme tokens:** Use project tokens (e.g., `text-muted`), not raw palette classes (e.g., `text-gray-500`).
- **Component exports:** `export function ComponentName` (never `React.FC` or arrow functions).
- **Feature folders:** kebab-case. Update aliases/loaders after moving files. No barrel files unless already used.

### API

- Validate input at boundaries. Auth on mutating routes.
- Prefer existing service helpers. Use route maps in `docs/` if available.

### Tests

- Write tests only if explicitly asked.

---

## Repo Workflow

- **Read first:** `README` and `docs/` for stack, commands, and app boundaries.
- **Scripts:** Use existing repo scripts. No parallel task runners.
- **Data flow:** Reads: query layer. Writes: mutation layer. URL state: search params. Draft editors: local client store. No mirroring server cache.
- **Helpers:** Search `utils/` before adding new ones. Use path aliases (`@/`).

---

**Note:** App-specific details live in `docs/` and `README`. Keep this file lean and up-to-date.

---
