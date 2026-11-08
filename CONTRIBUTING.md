# Contributing

The monorepo uses pnpm 11.21.0 and Node.js 24 LTS. Run `pnpm install --frozen-lockfile` from the repository root.

- `packages/core`: headless engine and registries.
- `packages/react`: React hook and palette.
- `apps/playground`: example application.
- `apps/docs`: Fumadocs documentation and checked examples.

Run `pnpm build`, `pnpm typecheck`, and `pnpm test`. To run browser tests, install Chromium with `pnpm --filter @cmdly/docs exec playwright install --with-deps chromium`, then run `pnpm --filter @cmdly/docs test:browser` after the build. `pnpm check:pack` packs and installs both packages in a temporary independent project; it needs npm registry access.

Use `pnpm dev` for the playground and `pnpm dev:docs` for docs. Do not publish packages or deploy documentation without explicit authorization. Contributions are made under the [MIT License](LICENSE).
