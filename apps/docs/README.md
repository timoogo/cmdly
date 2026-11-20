# Cmdly documentation

From the repository root, run `pnpm install`, `pnpm dev:docs`, `pnpm check:docs`, and `pnpm build:docs`. The docs build first builds `@cmdly/core` and `@cmdly/react`, then prerenders documentation, Markdown pages, the search index, and LLM indexes into `build/client`. Finally it builds the Vite playground into `build/client/playground` for `/playground/`, after React Router has finished writing its output. The playground remains independently available locally with `pnpm dev`. A static host must provide a 404 fallback; Markdown content negotiation and `.md` redirects require the React Router server (`pnpm --filter @cmdly/docs start`).

The six examples in `examples/` are typechecked by the application TypeScript configuration. `pnpm check:docs` also checks that their displayed MDX snippets match those files.

For browser tests, install Playwright Chromium with `pnpm --filter @cmdly/docs exec playwright install chromium`, build the docs, then run `pnpm --filter @cmdly/docs test:browser`. To use an existing Chromium binary, set `CMDLY_CHROMIUM_PATH` to its absolute path. The tests launch the production server locally.
