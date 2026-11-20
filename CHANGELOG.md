# Changelog

## 0.2.0 — Unreleased

- Add token recognition, value registries, asynchronous validation and token feedback.
- Add `CommandBubble` in trigger and standalone modes, external sessions, and headless React session and combobox APIs.
- Keep configured confirmations open after success, close final screens directly on Escape, and improve focus handling.
- Expand public engine snapshots, engine types and error codes. See [migration notes](MIGRATION.md) for TypeScript and interaction changes.

## 0.1.2

- Add registry tags, global command registration and display modes, and stable error codes.
- Align wildcard registration and clarify registry concepts.

## 0.1.1

- Fix `ERR_PACKAGE_PATH_NOT_EXPORTED` when CommonJS code resolves `@cmdly/core` or `@cmdly/react`: the exports now use a `default` condition instead of `import` only, and `main` points to the same ESM entry. The packages remain ESM-only, with a single build.
- `require()` works on Node.js 20.19.0 or 22.12.0 and later through native `require(esm)`, and loads the same module instance as `import`.
- `pnpm check:pack` now tests the packed archives with ESM, CommonJS, import/require identity and TypeScript `bundler`, `nodenext`, `node16` and `node10` consumers.
- Document compatibility and the intentional `refreshRegistry()` behavior.

## 0.1.0

- Split the headless engine and React integration into `@cmdly/core` and `@cmdly/react`.
- Organize the engine, registries, documentation and playground in a pnpm workspace.
- Add Fumadocs documentation and automated validation of examples and package archives.
- License the project under the MIT License.
