# Cmdly

[Documentation source](apps/docs/content/docs/index.mdx) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [GitHub](https://github.com/timoogo/cmdly)

A headless command workflow engine with a React palette adapter. The engine is available from `@cmdly/core` without React or browser globals. The React adapter renders semantic HTML without a styling framework; style its elements in your application. React 18 or 19 is a peer dependency for the adapter.

## Installation

The previous `cmdly/core` import is now `@cmdly/core`; import React APIs from `@cmdly/react` instead of `cmdly`.


Install the packages with `pnpm add @cmdly/core @cmdly/react`. Within this repository, run `pnpm install` from the root.

### Compatibility

Cmdly is an ESM-only library. There is no separate CommonJS build: `import` and `require()` load the same files, so registries and `CommandUnavailableError` keep a single identity whichever way a module is loaded.

- **`import`** works on Node.js 18 and later, and in bundlers. Validated on Node.js 18.20.8, 20.18.3, 20.19.0, 22.12.0 and 26, and with a Vite production build.
- **`require('@cmdly/core')` and `require('@cmdly/react')`** rely on the native `require(esm)` support of Node.js and work from **Node.js 20.19.0 or 22.12.0** (validated on 20.19.0, 22.12.0 and 26). Older versions, including Node.js 18, Node.js 20 before 20.19 and Node.js 22 before 22.12, throw `ERR_REQUIRE_ESM`; use `await import('@cmdly/core')` there.
- Tools that implement their own CommonJS loader instead of using Node.js, such as test runners without ESM support, may still fail to load ES modules. Cmdly does not claim universal CommonJS compatibility.

TypeScript, validated with TypeScript 7.0 unless noted:

- `moduleResolution: "bundler"` and `"nodenext"` are supported, including static imports from CommonJS files (`.cts`) under `nodenext`, which compile to `require()` and need the Node.js versions above. TypeScript versions before 5.8 reject these CommonJS imports.
- `module: "node16"` models Node.js without `require(esm)`: a static import from a CommonJS file fails with TS1479. Use `await import('@cmdly/core')`, and `import type { … } from '@cmdly/core' with { 'resolution-mode': 'import' }` for types.
- `moduleResolution: "node10"` (`"node"`) resolves the declarations through the `types` field (validated with TypeScript 5.9; TypeScript 7 removed this mode).

Run `pnpm check:pack` to verify the packed archives in an isolated project; set `CMDLY_NODE_BINARIES` to a comma-separated list of Node.js executables to run its runtime scenarios on several versions.

## Quick start

```tsx
import { useState } from 'react';
import { CommandPalette, type Command } from '@cmdly/react';

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

Run `pnpm install`, `pnpm test`, `pnpm typecheck`, and `pnpm build` from the repository root.

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

Import `createCommandEngine` from `@cmdly/core` to drive a workflow without React or a browser. `getSnapshot()` returns a stable snapshot until the next change; `subscribe` returns an unsubscribe function. The consumer owns the engine lifecycle and calls `destroy()` when finished.

```ts
import { createCommandEngine } from '@cmdly/core';

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
import type { FinalContext } from '@cmdly/react';

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

The previous `CommandPalette` API remains available from `@cmdly/react`; existing command objects remain valid. Migrate incrementally by importing the engine from `@cmdly/core` only where direct control is needed.

## Composable command registries

`createCommandRegistry()` from `@cmdly/core` creates a headless registry. It can hold application-wide commands and mount temporary registries for a page, component, or selection:

```ts
import { createCommandRegistry } from '@cmdly/core';

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

Registries do not automatically update a command engine; call `refreshRegistry()` to discover registration changes. This is intentional: an engine works from the registry snapshot it read, so registering, unregistering, mounting or unmounting in an existing registry does not change an engine that is already created until `refreshRegistry()` is called.

### Registration identity

`registry.resolve(qualifiedId)` returns `{ command, qualifiedId, shared, runtimeRequired, isValid() }` for a registered command, or `undefined` if the path does not exist. The command is a shallow copy, as with `get()`. `isValid()` checks the original registration and every mount in the captured path. Removing and re-registering a command, or unmounting and remounting a registry under the same name, cannot reactivate an old resolution. Other paths to the same child are independent. Unrelated changes do not invalidate a resolution.

Resolution covers registry entries and mounts only. Nested workflow commands in a command's `commands` array are not separate registrations and cannot be addressed by `resolve()`; the engine carries the root registration provenance through nested workflows. Calling a resolved command directly bypasses engine validity checks.


### Using a registry with the engine

```ts
import { createCommandEngine, createCommandRegistry } from '@cmdly/core';

const registry = createCommandRegistry();
const remove = registry.register({ id: 'save', label: 'Save', run: () => save() });
const engine = createCommandEngine({ registry });
// Later, after registering other commands:
engine.refreshRegistry();
// When finished:
engine.destroy();
remove();
```

Supply either `registry` or `commands`, not both. A registry engine reads an ordered snapshot on creation and again on `refreshRegistry()`; it does not subscribe automatically. New or removed entries appear in its root menu after refresh. `setCommands()` and `setOptions({ commands })` throw before changing state on a registry engine; use `refreshRegistry()` to update its commands. Other `setOptions` fields remain available. Refreshing does not replace the definition of an active registry workflow, even when an entry with the same ID exists. Leave that workflow and select again to use the new entry.

Registry commands retain the identity of their root registration and all mounts while navigating nested workflows. Invalidated provenance prevents contextual evaluations and new executions; failures are reported as `CommandUnavailableError` in the engine snapshot and to `onError`. Pending option results from invalidated commands are not applied. This also applies after re-registration or remounting with the same name. An invocation that has already called `run` is not cancelled by invalidation. Engines have independent snapshots and concurrent invocations retain their own selected identities. `destroy()` still ignores pending results as before.

Ordinary `Command[]` retains its existing behavior: an active command removed by `setCommands()` can still run. Registry reads have contextual command types and cannot be passed as historical `Command[]`; use `{ registry }` for validity checks and context. Nested command IDs remain workflow-local, not registry paths.

### Registry context and invocation runtime

A registry owns the `shared` value captured with each registration. TypeScript infers it when no runtime type is needed:

```ts
const posts = createCommandRegistry({ shared: { postsApi } });
posts.register({ id: 'create', label: 'Create post', run: async (answers, { shared }) => {
  await shared.postsApi.create(answers);
} });
```

Declare both types and set `runtimeRequired: true` when a runtime is required. The explicit flag is necessary because TypeScript types do not exist at runtime. This is a migration for registries previously declaring a non-optional runtime: add the flag. The engine requires a provider in TypeScript, including for commands that execute automatically upon selection or after their last step:

```ts
type Shared = { postsApi: PostsApi };
type Runtime = { userId: string };
const posts = createCommandRegistry<Shared, Runtime>({ shared: { postsApi }, runtimeRequired: true });
posts.register({ id: 'create', label: 'Create post', run: async (answers, { shared, runtime }) => {
  await shared.postsApi.create({ ...answers, authorId: runtime.userId });
} });
const engine = createCommandEngine({ registry: posts, runtime: () => ({ userId: auth.currentUser.id }) });
// For a command awaiting confirmation:
await engine.execute({ runtime: { userId: '123' } });
```

The registry exposes a read-only `runtimeRequired` boolean, and `CommandRegistry<TShared, TRuntime, TRuntimeRequired>` preserves its literal type independently of the runtime's shape. For `runtimeRequired: true`, including when `TRuntime` is `unknown`, a registry engine requires a provider at construction: `execute({ runtime })` alone cannot prepare predicates or options that run before execution. An optional or runtime-free registry does not require a provider. If the requirement is a non-literal `boolean`, or is widened to `CommandRegistry<TShared, TRuntime>`, supply a provider because the requirement may be true. Code that implements `CommandRegistry` itself must provide the new read-only property; existing two-parameter type references remain valid and use `boolean` for the third parameter. The runtime type is invariant, so a registry accepting an optional runtime cannot be assigned to one requiring a more specific runtime. For a required registry, providers and explicit overrides must return a value other than `undefined`; if a value is typed `unknown`, narrow it before returning it. `null`, `false`, `0` and empty strings remain valid.

Mounts may be added or removed after a root registry is created, so an optional root's static type cannot acquire a required flag from later mounts. Supply a provider when any mounted registry requires a runtime. The engine checks each owning registry's requirement at runtime and refuses to evaluate or execute without a required value, even for an untyped or dynamically assembled root. Runtime shapes are not validated automatically; use a typed root or validate an `unknown` value in application code. A runtime-free registry can be mounted under an untyped root whose provider supplies a value: its commands are still typed with `runtime: undefined`, so do not rely on that type when such a provider is used. Declare the registry runtime as `unknown` when it may receive a value. For an `unknown` runtime, TypeScript cannot reject every promise or thenable resolving to `undefined`: even `async () => undefined` is accepted because a promise is itself an object. The engine checks the resolved value before invoking a command.

The provider may return a promise. For registry workflows with contextual predicates, dynamic options or final-step predicates or renderers, the engine prepares a navigation session before evaluating them and reuses its runtime through execution. While an asynchronous provider is pending, the snapshot has `loading: true`; navigation methods remain synchronous. Repeated snapshot reads do not call the provider. Without such evaluations, the runtime is acquired per invocation unless an explicit value is supplied. Errors are reported through the snapshot and `onError`. For an owner with `runtimeRequired: true`, an undefined runtime prevents execution even when TypeScript is bypassed or no provider was supplied. The error is reported through the normal execution error policy. Values such as `false`, `0`, an empty string, and `null` are valid if the declared runtime type permits them. Commands already running retain their captured context; unregistering or unmounting while a provider is pending prevents `run` from starting. Changes in `onExecute` are also checked before `run`.

Registry commands may use `when(answers, context)` and step `when` or `options(answers, context)` with the owning registry’s shared value and the session runtime. Dynamic options may return an array or a promise. Nested commands retain their root registration provenance; results from abandoned or invalidated workflows are not applied. Navigation back and forward retains the current session. After returning to the root menu, selecting a new workflow starts a new session; forward restores the existing one. Close and destroy abandon the session. Refreshing the root menu starts a new session. Only one navigation session is active per engine; separate engines have independent sessions.

An explicit `execute({ runtime })` takes precedence when no contextual decision has been made. Once a predicate, dynamic options callback or final renderer has used the session runtime, an explicit runtime with a different identity is rejected and reported as an execution error: previously evaluated decisions cannot safely authorize a different runtime. Use the same runtime reference or start a new session. A failed preparation can be retried with `retry()`.

A registry with no runtime requirement defaults to `runtimeRequired: false`; for a typed optional runtime, declare `TRuntime` as a union with `undefined`. When `runtimeRequired: true` is inferred without a runtime type, the runtime is `unknown` and must be narrowed by the command. Mounted registries can have different `shared` values and runtime policies; the owning registry supplies both policy and shared value, even through nested workflow commands. Two mounts of the same registry share that value but have independent validity paths. A root with a declared runtime type may mount children accepting that runtime type. An untyped root may mount registries with different runtime types, so its provider and explicit runtime are `unknown`; the caller must provide the right value for the selected command. Discovery on such a root likewise exposes an `unknown` runtime. `get`, `list`, and `resolve` expose `ContextualCommand<unknown, Runtime>` because a result may come from any mounted registry: direct calls require an explicit context, and its `shared` type is unknown. Use the engine to invoke registry commands safely. Historical `Command[]` and single-argument callbacks remain supported.

### Context throughout a workflow

A registry command and its nested commands receive the owner's `shared` value and the session `runtime` in `when`, step `when` and `options`, final-step `when` and `render`, and `run`. `render` keeps its existing final-screen argument and receives the command context as its second argument. Options can return an array or a promise. Treat both supplied values as immutable.

The following example is also checked by the TypeScript test in `packages/core/src/context-extension-example.test.ts`:

```ts
import { createCommandEngine, createCommandRegistry } from '@cmdly/core';

type Runtime = { userId: string };
type Shared = {
  canPublish: (userId: string) => boolean;
  categories: (userId: string) => Promise<{ value: string; label: string }[]>;
  publish: (category: string, visibility: string, userId: string) => void;
};
const shared: Shared = {
  canPublish: userId => userId.length > 0,
  categories: async () => [{ value: 'news', label: 'News' }],
  publish: (category, visibility, userId) => console.log(category, visibility, userId),
};
const registry = createCommandRegistry<Shared, Runtime>({ shared, runtimeRequired: true });
registry.register({
  id: 'publish', label: 'Publish',
  when: (_answers, { shared, runtime }) => shared.canPublish(runtime.userId),
  steps: [
    { id: 'category', label: 'Category', options: (_answers, { shared, runtime }) => shared.categories(runtime.userId) },
    { id: 'visibility', label: 'Visibility', when: (_answers, { runtime }) => runtime.userId !== '', options: [{ value: 'public', label: 'Public' }] },
  ],
  finalStep: {
    timing: 'before', closeOnComplete: false,
    when: (_answers, { shared, runtime }) => shared.canPublish(runtime.userId),
    render: (final, { runtime }) => `${runtime.userId}: ${final.summary.length} answers`,
  },
  run: (answers, { shared, runtime }) => shared.publish(answers.category, answers.visibility, runtime.userId),
});
const engine = createCommandEngine({
  registry,
  runtime: async () => ({ userId: 'user-1' }),
  callbacks: {
    onExecute: (_command, _answers, context) => console.log(context?.runtime.userId),
    onError: (error, _snapshot, context) => console.error(error, context?.runtime.userId),
  },
  strategies: { closeOnComplete: (_command, _answers, _final, context) => context?.runtime.userId === '' },
  plugins: [{ setup(pluginEngine) {
    return pluginEngine.subscribe(() => {
      const context = pluginEngine.getSnapshot().context;
      if (context) console.log(context.runtime.userId);
    });
  } }],
});
```

Engine callbacks keep their existing arguments and receive an optional context as their last argument. `closeOnComplete` receives it after the final step; `allowTransition` remains global. Snapshot context is optional, including in plugin subscriptions: a root menu or a failure before runtime acquisition has no identifiable command context. Its `shared` is `unknown` because a root may contain commands from different owners; narrow it before use. The command-specific callbacks above infer the concrete owner's shared type. Registry snapshots and callbacks expose `CommandView` without `run` or the contextual predicates and option loaders, because those functions cannot be safely called without an owner context. `StepView` likewise exposes display fields only. These are TypeScript views; legacy engines continue to expose `Command` and `Step`. An invocation invalidated after `run` starts may complete and keeps its success result, but subsequent final predicates and completion strategies are skipped. Its final screen is hidden.

For registry engines, predicate, provider and options failures are reported in the snapshot and to `onError`; an evaluation failure does not authorize a command. Historical predicates retain their existing synchronous error behavior. Engine callbacks and plugin setup are synchronous and their returned promises are not awaited. For ordinary `Command[]`, existing one-argument predicates, options and `run`, callbacks, strategies and plugin setup remain valid. The engine remains framework-independent; `useCommandEngine()` subscribes to its snapshot and actions without creating a separate context lifecycle.

Registry engines expose `CommandView` in snapshots, callbacks, strategies, and plugins. It contains the command's display, step, and navigation fields but does not expose `run`; nested commands are also views. These are TypeScript views of the existing objects, not runtime copies or access controls. Historical engines created with `commands: Command[]` retain `Command` in those positions. `useCommandEngine` preserves the corresponding snapshot and action types for both engine kinds. Direct calls to commands returned by registry discovery bypass engine runtime and provenance checks.

## License

Cmdly is released under the [MIT License](LICENSE).
