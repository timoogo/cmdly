import type { Command } from './core.js';

export type ResolvedCommand = {
  readonly command: Command;
  readonly qualifiedId: string;
  isValid(): boolean;
};

export type CommandRegistry = {
  register(command: Command): () => void;
  registerMany(commands: readonly Command[]): () => void;
  mount(namespace: string, registry: CommandRegistry): () => void;
  get(id: string): Command | undefined;
  resolve(id: string): ResolvedCommand | undefined;
  list(): Command[];
  subscribe(listener: () => void): () => void;
};

type Entry = { command: Command } | { registry: State };
type State = { entries: Map<string, Entry>; parents: Map<State, number>; listeners: Set<() => void> };
const states = new WeakMap<CommandRegistry, State>();

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

function commands(state: State, prefix = ''): Command[] {
  const result: Command[] = [];
  for (const [id, entry] of state.entries) {
    const qualified = prefix + id;
    if ('command' in entry) result.push({ ...entry.command, id: qualified });
    else result.push(...commands(entry.registry, qualified + '.'));
  }
  return result;
}

/** Creates a composable, framework-independent command registry. */
export function createCommandRegistry(): CommandRegistry {
  const state: State = { entries: new Map(), parents: new Map(), listeners: new Set() };
  const registry: CommandRegistry = {
    register(command) { return registry.registerMany([command]); },
    registerMany(items) {
      const additions = new Map<string, Entry>();
      for (const command of items) {
        segment(command.id, 'Command id');
        if (state.entries.has(command.id) || additions.has(command.id)) throw new Error(`Duplicate registry entry: ${command.id}`);
        additions.set(command.id, { command: { ...command } });
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
    get(id) { return commands(state).find(command => command.id === id); },
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
            command: { ...entry.command, id },
            qualifiedId: id,
            isValid: () => path.every(part => part.state.entries.get(part.id) === part.entry),
          };
        }
        current = entry.registry;
      }
      return undefined;
    },
    list() { return commands(state); },
    subscribe(listener) { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; },
  };
  states.set(registry, state);
  return registry;
}
