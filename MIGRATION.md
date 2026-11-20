# Migrating from 0.1.2 to 0.2.0

Upgrade `@cmdly/core` and `@cmdly/react` together. React 0.2.0 depends on core 0.2.0 exactly. For a headless integration, upgrade core alone. Existing command definitions and ordinary engine-created snapshots continue to work; the TypeScript changes below matter when constructing or implementing public types yourself.

## Engine snapshots and mocks

`EngineSnapshot` now requires `text`, `tokens`, `tokenFeedback`, and `tokensEnabled`. Prefer deriving test snapshots from a real engine's `getSnapshot()` and overriding the fields needed by the test. If constructing a snapshot, populate all four fields: `text` is the query with recognized tokens removed, `tokens` is the current token list, `tokenFeedback` is the aggregated feedback, and `tokensEnabled` indicates whether token recognition is available. For a snapshot with no tokens, use `text: query`, `tokens: []`, `tokenFeedback: { status: 'idle', pending: [], issues: [] }`, and `tokensEnabled: false`.

`CommandEngine` now requires a `tokens` registry with `register`, `unregister`, `setValues`, and `list`. Prefer `createCommandEngine()` in tests instead of implementing an engine manually. Otherwise update the implementation and mocks to satisfy `TokenTypeRegistry`.

## Error codes

`CmdlyErrorCode` adds `INVALID_TOKEN_TYPE` and `INVALID_TOKEN_MATCH`. Update exhaustive switches and `Record<CmdlyErrorCode, ...>` mappings to handle both. Token configuration and matcher errors may report these codes.

## React interactions

- Escape on a final screen now dismisses the interface directly rather than navigating back. Use the Back button when navigation is desired.
- The palette now dismisses on an outside press. An owned session is closed; an external engine is only hidden and remains the owner's responsibility.
- A successful `before` confirmation with `closeOnComplete: false` shows a completed result and Close instead of leaving Confirm available for a second execution. Custom final renderers remain responsible for their own content.
- The input stays focused after selecting a non-focusable option with the mouse, so keyboard navigation can continue. Focusable controls in custom options can still receive focus.

Token recognition is opt-in. If enabled, recognized tokens are removed from the text used to filter commands and options; command execution can receive token context. See the [token documentation](apps/docs/content/docs/core/tokens.mdx) and [React integration guide](apps/docs/content/docs/react/integration.mdx).
