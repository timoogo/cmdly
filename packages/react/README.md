# @cmdly/react

Headless React integration for `@cmdly/core`. React 18 or 19 is a peer dependency; Cmdly does not impose a styling framework.

```sh
pnpm add @cmdly/core@0.2.0 @cmdly/react@0.2.0
```

## Command Bubble

`CommandBubble` provides a trigger and an unstyled command interface. Its default `trigger` mode opens a modal command palette; `standalone` opens a non-modal popover beside the trigger.

```tsx
import { CommandBubble, type Command } from '@cmdly/react';

const commands: Command[] = [{ id: 'hello', label: 'Say hello', run: () => alert('Hello!') }];

export function App() {
  return <CommandBubble commands={commands} mode="standalone" label="Commands" />;
}
```

Use `mode="trigger"` to open the palette instead. The bubble supports controlled `open`/`onOpenChange`, custom triggers and content. Pass `commands` to create an internal session per opening, or `engine` to display an externally owned session. External sessions are hidden rather than closed on dismissal; their owner must destroy them.

## Other APIs

`CommandPalette` renders a modal palette directly. `useCommandEngine` subscribes to an engine; `useCommandSession` owns one session, and `useCommandCombobox` supplies headless state, actions and accessibility props for custom interfaces. Token feedback can be configured on the palette and bubble. Core exports are also available from `@cmdly/react`.

See the [0.1.2 to 0.2.0 migration notes](https://github.com/timoogo/cmdly/blob/main/MIGRATION.md) for TypeScript and interaction changes.

See the [repository](https://github.com/timoogo/cmdly) for usage and examples.

## Compatibility

ESM-only. `import` works on Node.js 18 and later and in bundlers. `require()` works from Node.js 20.19.0 or 22.12.0 through native `require(esm)`; older versions throw `ERR_REQUIRE_ESM`. See [Compatibility](https://github.com/timoogo/cmdly#compatibility) for TypeScript details.

## License

MIT. See [LICENSE](LICENSE).
