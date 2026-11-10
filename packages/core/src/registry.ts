import type { Command, ContextualCommand, CommandRegistry, GlobalRegistrationOptions, ResolvedCommand, ObservedRuntime } from './types.js';

type Entry = { command: Command } | { registry: State };
type GlobalEntry = { command: Command; exclude: Set<string> };
type State = { shared: unknown; runtimeRequired: boolean; entries: Map<string, Entry>; globals: GlobalEntry[]; excluded: Set<string>; parents: Map<State, number>; listeners: Set<() => void> };
const states = new WeakMap<object, State>();

function segment(value: string, kind: string): void {
  if (typeof value !== 'string' || !value.trim() || value.includes('.')) throw new Error(`${kind} must be non-empty and contain no dots`);
}

function contains(state: State, target: State, visited = new Set<State>()): boolean {
  if (state === target) return true;
  if (visited.has(state)) return false;
  visited.add(state);
  for (const entry of state.entries.values()) if ('registry' in entry && contains(entry.registry, target, visited)) return true;
  return false;
}

function publish(state: State): void {
  const affected = new Set<State>();
  const collect = (current: State) => {
    if (affected.has(current)) return;
    affected.add(current);
    for (const parent of current.parents.keys()) collect(parent);
  };
  collect(state);
  let failure: unknown, failed = false;
  for (const current of affected) for (const listener of [...current.listeners]) {
    try { listener(); } catch (error) { if (!failed) failure = error; failed = true; }
  }
  if (failed) throw failure;
}

/** Collect globals visible in this state (from all ancestor states via parents). */
function collectGlobals(state: State): GlobalEntry[] {
  const seen = new Set<State>();
  const result: GlobalEntry[] = [];
  const walk = (s: State) => {
    if (seen.has(s)) return;
    seen.add(s);
    result.push(...s.globals);
    for (const parent of s.parents.keys()) walk(parent);
  };
  walk(state);
  return result;
}

function commands(state: State, prefix = ''): Command[] {
  const result: Command[] = [];
  const localExcluded = state.excluded;

  for (const [id, entry] of state.entries) {
    const qualified = prefix + id;
    if ('command' in entry) result.push({ ...entry.command, id: qualified });
    else {
      // Inject globals from parent into this sub-namespace, filtered by exclusions
      const childGlobals = collectGlobals(entry.registry);
      for (const global of childGlobals) {
        if (!global.exclude.has(id) && !entry.registry.excluded.has(global.command.id)) {
          result.push({ ...global.command, id: qualified + '.' + global.command.id });
        }
      }
      result.push(...commands(entry.registry, qualified + '.'));
    }
  }

  // Append globals at this level (not injected into sub-registries here, that's done above)
  const allGlobals = state.globals;
  for (const global of allGlobals) {
    if (!localExcluded.has(global.command.id)) {
      result.push({ ...global.command, id: prefix + global.command.id });
    }
  }

  return result;
}

/** Creates a composable, framework-independent command registry. */
export function createCommandRegistry<TShared>(options: { shared: TShared; runtimeRequired: true }): CommandRegistry<TShared, unknown, true>;
export function createCommandRegistry<TShared, TRuntime extends {} | null>(options: { shared: TShared; runtimeRequired: true }): CommandRegistry<TShared, TRuntime, true>;
export function createCommandRegistry<TShared, TRuntime>(options: { shared: TShared; runtimeRequired: true } & ([TRuntime] extends [undefined] ? never : unknown)): CommandRegistry<TShared, TRuntime, true>;
export function createCommandRegistry<TShared, TRuntime = undefined>(options: { shared: TShared } & (undefined extends TRuntime ? { runtimeRequired?: false } : never)): CommandRegistry<TShared, TRuntime, false>;
export function createCommandRegistry<TShared>(options: { shared: TShared; runtimeRequired?: boolean }): CommandRegistry<TShared, unknown, boolean>;
export function createCommandRegistry<TShared, TRuntime = undefined>(options: { shared: TShared } & ([TRuntime] extends [undefined] ? { runtimeRequired?: false } : undefined extends TRuntime ? { runtimeRequired?: boolean } : { runtimeRequired: true })): CommandRegistry<TShared, TRuntime, boolean>;
export function createCommandRegistry(): CommandRegistry<undefined, undefined, false>;
export function createCommandRegistry<TShared = undefined, TRuntime = undefined>(options?: { shared: TShared; runtimeRequired?: boolean }): CommandRegistry<TShared, TRuntime, boolean> {
  const state: State = { shared: options?.shared, runtimeRequired: options?.runtimeRequired === true, entries: new Map(), globals: [], excluded: new Set(), parents: new Map(), listeners: new Set() };
  const registry: CommandRegistry<TShared, TRuntime, boolean> = {
    runtimeRequired: state.runtimeRequired,
    register(command) { return registry.registerMany([command]); },
    registerMany(items) {
      const additions = new Map<string, Entry>();
      for (const command of items) {
        segment(command.id, 'Command id');
        if (state.excluded.has(command.id)) throw new Error(`Registration of '${command.id}' is excluded in this registry`);
        if (state.entries.has(command.id) || additions.has(command.id)) throw new Error(`Duplicate registry entry: ${command.id}`);
        additions.set(command.id, { command: { ...command } as unknown as Command });
      }
      if (!additions.size) return () => {};
      for (const [id, entry] of additions) state.entries.set(id, entry);
      publish(state);
      return () => {
        let changed = false;
        for (const [id, entry] of additions) if (state.entries.get(id) === entry) { state.entries.delete(id); changed = true; }
        if (changed) publish(state);
      };
    },
    registerGlobal(command, options?: GlobalRegistrationOptions) {
      segment(command.id, 'Command id');
      const excludeSet = new Set(options?.exclude ?? []);
      const global: GlobalEntry = { command: { ...command } as unknown as Command, exclude: excludeSet };
      state.globals.push(global);
      publish(state);
      return () => {
        const index = state.globals.indexOf(global);
        if (index !== -1) { state.globals.splice(index, 1); publish(state); }
      };
    },
    exclude(ids) {
      let changed = false;
      for (const id of ids) {
        if (state.excluded.has(id)) continue;
        state.excluded.add(id);
        // Retroactively remove any existing entry with this id
        if (state.entries.has(id)) { state.entries.delete(id); changed = true; } else { changed = true; }
      }
      if (changed) publish(state);
    },
    mount(namespace, child) {
      segment(namespace, 'Namespace');
      const childState = states.get(child);
      if (!childState) throw new Error('Child must be a Cmdly command registry');
      if (state.entries.has(namespace)) throw new Error(`Duplicate registry entry: ${namespace}`);
      if (contains(childState, state)) throw new Error('Circular registry mount');
      const entry: Entry = { registry: childState };
      state.entries.set(namespace, entry);
      childState.parents.set(state, (childState.parents.get(state) ?? 0) + 1);
      publish(state);
      return () => {
        if (state.entries.get(namespace) !== entry) return;
        state.entries.delete(namespace);
        const count = childState.parents.get(state)!;
        if (count === 1) childState.parents.delete(state); else childState.parents.set(state, count - 1);
        publish(state);
      };
    },
    get(id) { return commands(state).find(command => command.id === id) as unknown as ContextualCommand<unknown, ObservedRuntime<TRuntime>> | undefined; },
    resolve(id) {
      const parts = id.split('.');
      const path: { state: State; id: string; entry: Entry }[] = [];
      let current = state;
      for (let i = 0; i < parts.length; i++) {
        const name = parts[i], entry = current.entries.get(name);
        if (!entry) return undefined;
        path.push({ state: current, id: name, entry });
        if ('command' in entry) {
          if (i !== parts.length - 1) return undefined;
          return {
            command: { ...entry.command, id } as unknown as ContextualCommand<unknown, ObservedRuntime<TRuntime>>,
            qualifiedId: id,
            shared: current.shared,
            runtimeRequired: current.runtimeRequired,
            isValid: () => path.every(part => part.state.entries.get(part.id) === part.entry),
          };
        }
        current = entry.registry;
      }
      return undefined;
    },
    list() { return commands(state) as unknown as ContextualCommand<unknown, ObservedRuntime<TRuntime>>[]; },
    listByTag(tag) { return registry.list().filter(cmd => cmd.tags?.includes(tag)); },
    subscribe(listener) { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; },
  };
  states.set(registry, state);
  return registry;
}
