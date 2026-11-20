# Cmdly playground

From the repository root, run `pnpm install`, then `pnpm dev`. Open the URL Vite prints. Run `pnpm --filter playground test` and `pnpm --filter playground build` to check the app.

The dev server uses the local `@cmdly/react` and `@cmdly/core` sources directly, so changes do not require a package rebuild. The production build uses the packages' `dist` exports; run `pnpm --filter @cmdly/core build` and `pnpm --filter @cmdly/react build` first (or use `pnpm build` from the root).

Open the palette with the button or Ctrl/⌘ K. Search for “Say hello”, “Open a project”, or “Invite a teammate”. Project choices load asynchronously; use the failure toggle to exercise the error state. Choose the admin role to reveal the conditional access step. Use the palette's back and cancel controls to navigate without running a command.
