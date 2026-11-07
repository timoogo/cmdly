# Cmdly

A headless command workflow engine with a React palette adapter. The engine is available from `cmdly/core` without React or browser globals. The React adapter renders semantic HTML without a styling framework; style its elements in your application. React and React DOM 18 or 19 are peer dependencies for the adapter.

## Installation

Install the package from this directory while developing: `npm install ../cmdly`. Once distributed, install it with `npm install cmdly`.

## Quick start

```tsx
import { useState } from 'react';
import { CommandPalette, type Command } from 'cmdly';

const commands: Command[] = [
  { id: 'hello', label: 'Say hello', run: () => alert('Hello!') },
  {
    id: 'deploy', label: 'Deploy',
    steps: [
      { id: 'environment', label: 'Environment', options: [
        { value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' }
      ] },
      { id: 'region', label: 'Region', when: answers => answers.environment === 'production',
        options: async answers => (await fetch(`/regions?env=${answers.environment}`)).json() }
    ],
    run: async answers => { console.log(answers); }
  }
];

function App() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Commands</button>
    <CommandPalette commands={commands} open={open} onOpenChange={setOpen} /></>;
}
```

The host controls opening, including any global shortcut. Search filters the current commands or options. Arrow keys and Enter select; Escape goes back or closes, and Cancel closes. Async option failures can be retried; command failures are displayed. Focus enters the dialog, stays within it while open, and returns on close.

## API and rationale

`CommandPalette` takes `commands: Command[]`, `open: boolean`, and `onOpenChange(open: boolean): void`. A `Command` has `id`, `label`, optional `steps` and `when(answers)`, and either `run(answers)` or nested `commands`. Each `Step` has `id`, `label`, `options` (an array or async function of answers), and optional `when(answers)`. Answers are keyed by step ID. IDs and option values should be unique within their respective lists. `Command`, `Step`, `Option`, and `CommandPaletteProps` are exported types.

The object API keeps a command and its workflow together and makes simple commands concise. JSX composition offers greater control over rendering but adds component nesting and boilerplate; this POC favors the requested small API.

## Local development

Run `npm install`, `npm test`, `npm run typecheck`, and `npm run build` inside `cmdly/`.

## Limitations

The palette owns its semantic markup; built-in styling is not provided. It does not register a global shortcut. Async requests are ignored after navigation but are not aborted. The host is responsible for unique IDs, accessible page-level modal isolation, and HTTP response validation in option loaders.

### Large option lists

Step options remain fully searchable and keyboard-navigable. Cmdly renders up to 50 matching options at a time and keeps the active option in view. Set `maxVisibleItems` on a command to change that limit for all its steps, for example `{ id: 'project', label: 'Project', maxVisibleItems: 25, steps: [{ id: 'project', label: 'Choose a project', options }], run }`. The value must be a positive number; invalid values use the default. The option applies to step choices, not the command list.

### Nested commands

A command may contain `commands: Command[]`. Selecting it runs its steps first, then opens its children; a parent with children never executes its `run`. Each child may itself contain steps or children. Answers from parent steps are inherited by the selected child and available to its `when`, steps, and `run`; child answers do not leak to siblings. Escape returns to the previous step or menu. A command object already on the current path is hidden to prevent cycles. `maxVisibleItems` on a parent also limits its child menu.

### Backtracking

Commands accept `backBehavior: 'preserve' | 'reset' | 'smart'`. The default is `smart`; children inherit the nearest ancestor's value unless they override it. For example, `{ id: 'deploy', label: 'Deploy', backBehavior: 'preserve', steps, run }` restores earlier selections when revisiting steps or branches.

Answers are stored for the current open session by command path and step ID. Only answers traversed in the current branch, plus inherited parent answers, reach predicates, loaders, and `run`; a child step with the same ID shadows its parent. Closing clears saved answers.

- `preserve` remembers selections across back navigation and sibling visits. A saved value is selected only if present in the current options.
- `reset` clears later step selections when going back and clears a command's saved selections when leaving it. Parent answers stay intact.
- `smart` restores unchanged paths. Changing an answer clears subsequent selections in that command and its descendant branches; skipped conditional step selections are discarded. On visiting a step, a saved value absent from successfully loaded options is cleared along with its dependents. Async choices are loaded on entering the step as usual; failures retain saved values and can be retried.

The selection must be confirmed again when revisiting a step. There is no background validation of unvisited async choices; a failed or unavailable loader does not invalidate saved data.

### Horizontal navigation and progress

Set `arrowNavigation: true` to enable Left and Right; children inherit it and may override with `false`. Left uses the same backtracking rules as Escape, without closing at the root. Right returns only to a previously visited compatible state: it validates saved choices and conditions, never executes a command, and cannot recover discarded `reset` history. Choosing an option or branch clears forward history. Horizontal arrows retain their normal editing behavior when the search field contains text, while composing, or when focus is on another control.

Set `progress: 'local'` or `'global'` on a command (inherited by children, overridable with `false`), and pass `renderProgress={progress => ...}` to `CommandPalette` to render it. Both features are disabled by default. The callback receives `{ mode, current, total, percentage, indeterminate }`. `current` is the count of completed decisions: local counts completed steps in the current command; global also counts each selected command and completed ancestor steps. Progress is indeterminate (`total` and `percentage` are `null`) while a child menu remains unresolved or a future conditional step might change the total. In a leaf command with no unresolved future conditional steps, total is completed decisions plus the current and remaining steps. It is recalculated from the active path, not saved sibling answers. Progress is informational and never executes or validates a workflow.


## Framework-independent engine

Import `createCommandEngine` from `cmdly/core` to drive a workflow without React or a browser. `getSnapshot()` returns a stable snapshot until the next change; `subscribe` returns an unsubscribe function. The consumer owns the engine lifecycle and calls `destroy()` when finished.

```ts
import { createCommandEngine } from 'cmdly/core';

const engine = createCommandEngine({
  commands: [{ id: 'hello', label: 'Hello', run: answers => console.log(answers) }],
});
const unsubscribe = engine.subscribe(() => console.log(engine.getSnapshot()));
engine.select(0); // select an item from snapshot.items
unsubscribe();
engine.destroy();
```

The engine exposes `setOptions({ commands, defaults, callbacks, strategies })`, `setCommands(commands)`, `select(index)`, `back()`, `forward()`, `setQuery(query)`, `setActive(index)`, `retry()`, `execute()`, `close()` and `destroy()`. Selection indexes refer to the current filtered `snapshot.items`. `setOptions` updates only supplied properties; `setCommands` is its shorthand for commands. Active commands are matched by ID along the current path, preserving the workflow and answers. If an active command is absent from the new definitions, its previous definition is retained for that path. Updating definitions does not restart a pending asynchronous options load; use retry when a reload is needed. The snapshot includes the phase, current command and step, active answers, options, loading/error and execution status, progress, and final-step summary. Closing clears session answers; create another engine for a new session. Pending async results are ignored after navigation, closing or destruction; requests themselves are not aborted. An execution already in progress is not started a second time.

## Final step

A leaf command can add a final step before or after its `run`. Without one, existing commands run as before. A parent final step is inherited by descendants unless overridden or disabled with `finalStep: false`. `when` receives active inherited answers; false skips the final step. Fields default to all active answers, in answer order. `fields` replaces that list and controls ordering, filtering and labels.

```ts
const commands = [{
  id: 'deploy', label: 'Deploy',
  steps: [{ id: 'environment', label: 'Environment', options: [
    { value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' },
  ] }],
  finalStep: {
    timing: 'before' as const,
    when: (answers: Record<string, string>) => answers.environment === 'production',
    fields: [{ id: 'environment', label: 'Deployment target' }],
  },
  run: async (answers: Record<string, string>) => { console.log(answers); },
}];
```

`before` waits for `execute()` and closes on success by default. `after` runs first and remains open by default; set `closeOnComplete: true` to close after success. Execution errors are captured in the snapshot and passed to `onError`; `execute()` resolves after recording a command failure instead of rejecting with that failure. In a final step `retry()` calls execution again. Applications that need propagation can inspect the snapshot after awaiting `execute()`. `back()` returns to prior choices. Progress counts completed commands and steps; the final screen is not an additional decision.

### React rendering

The default palette displays the summary and standard controls. Supply `render` to replace the final-step content. The context provides `answers`, `summary`, `status`, `error`, `result`, `execute`, `back`, and `close`:

```tsx
import type { FinalContext } from 'cmdly';

const renderConfirmation = (context: FinalContext) => (
  <section>
    <p>Deploy to {context.answers.environment}?</p>
    {context.error && <p role="alert">Execution failed. Try again.</p>}
    <button onClick={context.back}>Back</button>
    <button disabled={context.status === 'loading'} onClick={() => void context.execute()}>
      {context.status === 'error' ? 'Retry' : 'Deploy'}
    </button>
  </section>
);
// Assign renderConfirmation to finalStep.render on a command.
```

For a fully custom React interface, `useCommandEngine(engine)` returns `{ state, actions }`; the caller creates and destroys the engine. `CommandPalette` also accepts the optional `defaults`, `callbacks`, `strategies`, and `plugins` engine options. Changes to `commands`, `defaults`, `callbacks`, or `strategies` update the open engine without resetting the workflow. Keep the `plugins` array referentially stable (for example with `useMemo`): changing it cleans up the old plugins and installs the new ones.

## Configuration and extensions

`defaults` supplies settings for commands. The nearest defined command setting wins; `false` explicitly disables applicable boolean and final-step settings. Final-step objects are merged shallowly from defaults through ancestors to the current command: primitives and functions replace earlier values, and `fields` replaces the whole array. No other deep merge occurs.

Optional callbacks `onNavigate`, `onExecute`, `onError`, and `onClose` observe the engine. `strategies.allowTransition(snapshot, action)` can reject an action; `strategies.closeOnComplete(command, answers, finalStep)` overrides the default closing decision. Plugins are optional: each `{ setup(engine) { ...; return cleanup; } }` is installed in array order, and cleanup functions run in reverse order on destruction. Setup errors propagate after cleaning up previously installed plugins. Only these two strategy hooks are currently provided; navigation and history algorithms are not replaceable wholesale. Callback and strategy functions should not throw unless their caller is prepared to handle that error.

The previous `CommandPalette` API remains available from `cmdly`; existing command objects remain valid. Migrate incrementally by importing the engine from `cmdly/core` only where direct control is needed.

## Composable command registries

`createCommandRegistry()` from `cmdly/core` creates a headless registry. It can hold application-wide commands and mount temporary registries for a page, component, or selection:

```ts
import { createCommandRegistry } from 'cmdly/core';

const global = createCommandRegistry();
const posts = createCommandRegistry();
const removeCreate = posts.register({ id: 'create', label: 'Create post', run: () => {} });
const unmountPosts = global.mount('posts', posts);
const unsubscribe = global.subscribe(() => console.log(global.list()));
global.get('posts.create');
// When the context ends:
unmountPosts();
removeCreate();
unsubscribe();
```

`registerMany(commands)` validates the entire batch before adding it and returns one cleanup. Registration and mount cleanups are idempotent and cannot remove a later entry. `subscribe(listener)` returns an idempotent unsubscribe. A successful nonempty change notifies the changed registry and each ancestor once, including when a child is mounted more than once. Listeners run synchronously; all affected listeners are called even if one throws, and the first error is rethrown after the change has committed. Listeners should not throw, especially during registration or mounting, because an exception prevents the cleanup function from being returned.

Local command IDs and namespaces must be nonempty, non-whitespace strings without dots. Dots separate namespace segments; `get` takes the full qualified ID. A local command and a mount cannot share a name, nor can two mounts in the same registry. Duplicate entries, invalid segments, and direct or indirect cycles throw before changing state. These rules also prevent collisions after mounting: a conflicting child change is rejected by the child, leaving every registry unchanged. The same child may be mounted under different names or parents. Only registries created by `createCommandRegistry` can be mounted.

`list()` returns a fresh array of shallow command copies in insertion order, expanding each mount in place recursively. Removing and adding an entry moves it to the end. `get()` also returns a shallow copy. The registry captures top-level command properties on registration; nested workflow objects and functions remain shared and should be treated as immutable. Nested `commands` are workflow menus, not registry entries, and are not qualified individually.

Registries do not automatically update a command engine or provide React hooks. Consumers may explicitly pass `registry.list()` to an engine and manage updates themselves. Shared/runtime context and reactive engine and React integration are reserved for later work.
