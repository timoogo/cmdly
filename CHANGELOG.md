# Changelog

## 0.1.1 — Unreleased

- Fix `ERR_PACKAGE_PATH_NOT_EXPORTED` when CommonJS code resolves `@cmdly/core` or `@cmdly/react`: the exports now use a `default` condition instead of `import` only, and `main` points to the same ESM entry. The packages remain ESM-only, with a single build.
- `require()` works on Node.js 20.19.0 or 22.12.0 and later through native `require(esm)`, and loads the same module instance as `import`.
- `pnpm check:pack` now tests the packed archives with ESM, CommonJS, import/require identity and TypeScript `bundler`, `nodenext`, `node16` and `node10` consumers.
- Document compatibility and the intentional `refreshRegistry()` behavior.

## 0.1.0 — Unreleased

- Split the headless engine and React integration into `@cmdly/core` and `@cmdly/react`.
- Organize the engine, registries, documentation and playground in a pnpm workspace.
- Add Fumadocs documentation and automated validation of examples and package archives.
- License the project under the MIT License.

The release has not been published.
