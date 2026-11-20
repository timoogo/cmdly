import type {
  Command,
  ContextualCommand,
  CommandRegistry,
  GlobalRegistrationOptions,
  ResolvedCommand,
  ObservedRuntime,
  TagCatalog,
  TagDefinition,
  ResolvedTagDefinition,
  CreateRegistryOptions,
  ErrorMessages,
} from './types.js';
import { CmdlyError } from './errors.js';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type Entry = { command: Command } | { registry: State };

/** skipRegistries: set of *namespace ids* (mount points) where this global must NOT be injected. */
type GlobalEntry = { command: Command; skipRegistries: Set<string> };

type State = {
  shared: unknown;
  runtimeRequired: boolean;
  /** Own tag catalog as declared in createCommandRegistry options. */
  ownTags: Readonly<TagCatalog>;
  /**
   * Effective (merged) catalog: own tags merged over inherited parent tags.
   * Recomputed whenever a parent mounts or unmounts.
   */
  effectiveTags: TagCatalog;
  errorMessages: ErrorMessages;
  entries: Map<string, Entry>;
  globals: GlobalEntry[];
  excluded: Set<string>;
  /** parent state → mount count (a state can be mounted multiple times under different namespaces) */
  parents: Map<State, number>;
  /** namespace id under each parent where this state is mounted, for conflict reporting */
  parentNamespaces: Map<State, string[]>;
  listeners: Set<() => void>;
};

const states = new WeakMap<object, State>();

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function throwTagConflict(state: State, tag: string, registryNames: string[]): never {
  const factory = state.errorMessages.TAG_CONFLICT;
  const details = { tag, registries: registryNames };
  const message = factory ? factory(details) : `Tag conflict on "${tag}" between ${registryNames.join(' and ')}. Add a local override to resolve it.`;
  throw new CmdlyError('TAG_CONFLICT', message, details);
}

function throwUnknownTag(state: State, tag: string, commandId: string, allowedTags: string[]): never {
  const factory = state.errorMessages.UNKNOWN_TAG;
  const details = { tag, commandId, allowedTags };
  const message = factory ? factory(details) : `Unknown tag "${tag}" on command "${commandId}". Allowed tags: ${allowedTags.join(', ')}.`;
  throw new CmdlyError('UNKNOWN_TAG', message, details);
}

function throwInvalidTagOverride(state: State, tag: string, commandId: string): never {
  const factory = state.errorMessages.INVALID_TAG_OVERRIDE;
  const details = { tag, commandId };
  const message = factory ? factory(details) : `Invalid tagOverride key "${tag}" on command "${commandId}". Tag not found in catalog.`;
  throw new CmdlyError('INVALID_TAG_OVERRIDE', message, details);
}

// ---------------------------------------------------------------------------
// Tag catalog helpers
// ---------------------------------------------------------------------------

/**
 * Walk the parent chain of `state` and collect all ancestor catalogs in
 * bottom-up order (direct parents first).
 */
function collectAncestorCatalogs(state: State, visited = new Set<State>()): TagCatalog[] {
  if (visited.has(state)) return [];
  visited.add(state);
  const result: TagCatalog[] = [];
  for (const parent of state.parents.keys()) {
    result.push(parent.effectiveTags);
    result.push(...collectAncestorCatalogs(parent, visited));
  }
  return result;
}

/**
 * Recompute the effective catalog for `state`.
 * Throws `TAG_CONFLICT` if an unresolvable conflict is detected.
 */
function computeEffectiveCatalog(state: State, namespace: string): TagCatalog {
  const ancestorCatalogs = collectAncestorCatalogs(state);

  // Build merged base from ancestors (first occurrence wins among ancestors)
  const merged: TagCatalog = {};
  // Track which ancestor namespace contributed each key (for conflict detection)
  const contributors = new Map<string, { catalog: TagCatalog; namespace: string }[]>();

  for (const catalog of ancestorCatalogs) {
    for (const key of Object.keys(catalog)) {
      if (!contributors.has(key)) contributors.set(key, []);
      contributors.get(key)!.push({ catalog, namespace });
    }
  }

  // Detect conflicts: same key from multiple parents with different definitions,
  // not overridden locally.
  for (const [key, sources] of contributors) {
    if (state.ownTags[key] !== undefined) continue; // local override resolves it
    if (sources.length < 2) continue;
    // Check whether all sources agree on the definition
    const first = JSON.stringify(sources[0].catalog[key]);
    const conflicting = sources.filter(s => JSON.stringify(s.catalog[key]) !== first);
    if (conflicting.length > 0) {
      const registryNames = [...new Set(sources.map(s => s.namespace))];
      throwTagConflict(state, key, registryNames);
    }
  }

  // Merge: ancestors first (first ancestor wins for a given key), then own overrides
  for (const catalog of [...ancestorCatalogs].reverse()) {
    for (const [key, def] of Object.entries(catalog)) {
      merged[key] = def;
    }
  }
  // Own tags win
  for (const [key, def] of Object.entries(state.ownTags)) {
    merged[key] = def;
  }

  return merged;
}

/**
 * Recompute effective catalogs for `state` and all its descendants.
 * Called after a mount/unmount changes the parent graph.
 * Throws if any conflict is detected (before mutating anything — atomicity).
 */
function recomputeCatalogs(state: State, namespace: string): void {
  // Phase 1: dry-run all computations and collect results
  const updates: { target: State; catalog: TagCatalog }[] = [];
  const walk = (s: State, ns: string, visited = new Set<State>()) => {
    if (visited.has(s)) return;
    visited.add(s);
    updates.push({ target: s, catalog: computeEffectiveCatalog(s, ns) });
    for (const [childNs, entry] of s.entries) {
      if ('registry' in entry) walk(entry.registry, childNs, visited);
    }
  };
  walk(state, namespace);

  // Phase 2: apply all updates atomically (only reached if no conflict)
  for (const { target, catalog } of updates) {
    target.effectiveTags = catalog;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function segment(value: string, kind: string): void {
  if (typeof value !== 'string' || !value.trim() || value.includes('.'))
    throw new Error(`${kind} must be non-empty and contain no dots`);
}

function validateCommandTags(command: { id?: string; tags?: string[]; tagOverrides?: Record<string, unknown> }, state: State): void {
  const catalogKeys = Object.keys(state.effectiveTags);
  if (catalogKeys.length === 0) return; // no catalog → free-form tags allowed

  const id = command.id ?? '(unknown)';

  if (command.tags) {
    for (const tag of command.tags) {
      if (!state.effectiveTags[tag]) {
        throwUnknownTag(state, tag, id, catalogKeys);
      }
    }
  }

  if (command.tagOverrides) {
    for (const tag of Object.keys(command.tagOverrides)) {
      if (!state.effectiveTags[tag]) {
        throwInvalidTagOverride(state, tag, id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// commands() — walk state tree and collect qualified commands
// ---------------------------------------------------------------------------

function contains(state: State, target: State, visited = new Set<State>()): boolean {
  if (state === target) return true;
  if (visited.has(state)) return false;
  visited.add(state);
  for (const entry of state.entries.values())
    if ('registry' in entry && contains(entry.registry, target, visited)) return true;
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
  for (const current of affected)
    for (const listener of [...current.listeners]) {
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
    if ('command' in entry) {
      result.push({ ...entry.command, id: qualified });
    } else {
      // Inject globals from parent into this sub-namespace.
      const childGlobals = collectGlobals(entry.registry);
      for (const global of childGlobals) {
        if (global.skipRegistries.has(id)) continue;
        if (entry.registry.excluded.has(global.command.id)) continue;
        result.push({ ...global.command, id: qualified + '.' + global.command.id });
      }
      result.push(...commands(entry.registry, qualified + '.'));
    }
  }

  // Append globals at this level.
  for (const global of state.globals) {
    if (!localExcluded.has(global.command.id)) {
      result.push({ ...global.command, id: prefix + global.command.id });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// createCommandRegistry
// ---------------------------------------------------------------------------

/** runtimeRequired: true + tag catalog */
export function createCommandRegistry<TShared, TRuntime, TTags extends string>(
  options: CreateRegistryOptions<TShared, TTags> & { shared: TShared; runtimeRequired: true; tags: Record<TTags, TagDefinition> } & ([TRuntime] extends [undefined] ? never : unknown),
): CommandRegistry<TShared, TRuntime, true, TTags>;

/** runtimeRequired: true, TRuntime = unknown (1-arg generic) */
export function createCommandRegistry<TShared>(
  options: { shared: TShared; runtimeRequired: true; errorMessages?: ErrorMessages },
): CommandRegistry<TShared, unknown, true, string>;

/** runtimeRequired: true, TRuntime extends {} | null */
export function createCommandRegistry<TShared, TRuntime extends {} | null>(
  options: { shared: TShared; runtimeRequired: true; errorMessages?: ErrorMessages },
): CommandRegistry<TShared, TRuntime, true, string>;

/** runtimeRequired: true, any TRuntime (catches unknown, etc.) */
export function createCommandRegistry<TShared, TRuntime>(
  options: { shared: TShared; runtimeRequired: true; errorMessages?: ErrorMessages } & ([TRuntime] extends [undefined] ? never : unknown),
): CommandRegistry<TShared, TRuntime, true, string>;

/** Tag catalog, no shared */
export function createCommandRegistry<TTags extends string>(
  options: { tags: Record<TTags, TagDefinition>; errorMessages?: ErrorMessages },
): CommandRegistry<undefined, undefined, false, TTags>;

/** Tag catalog + shared, TRuntime optional */
export function createCommandRegistry<TShared, TTags extends string>(
  options: CreateRegistryOptions<TShared, TTags> & { tags: Record<TTags, TagDefinition> },
): CommandRegistry<TShared, undefined, false, TTags>;

/** No catalog, runtimeRequired?: false (TRuntime may include undefined) */
export function createCommandRegistry<TShared, TRuntime = undefined>(
  options: { shared: TShared; errorMessages?: ErrorMessages } & (undefined extends TRuntime ? { runtimeRequired?: false } : never),
): CommandRegistry<TShared, TRuntime, false, string>;

/** No catalog, runtimeRequired?: boolean */
export function createCommandRegistry<TShared>(
  options: { shared: TShared; runtimeRequired?: boolean; errorMessages?: ErrorMessages },
): CommandRegistry<TShared, unknown, boolean, string>;

/** No catalog, full generic form */
export function createCommandRegistry<TShared, TRuntime = undefined>(
  options: { shared: TShared; errorMessages?: ErrorMessages } & (
    [TRuntime] extends [undefined] ? { runtimeRequired?: false }
    : undefined extends TRuntime ? { runtimeRequired?: boolean }
    : { runtimeRequired: true }
  ),
): CommandRegistry<TShared, TRuntime, boolean, string>;

/** Custom errors without shared context or a tag catalog */
export function createCommandRegistry(options: { errorMessages: ErrorMessages }): CommandRegistry<undefined, undefined, false, string>;

/** No args */
export function createCommandRegistry(): CommandRegistry<undefined, undefined, false, string>;

export function createCommandRegistry<TShared = undefined, TRuntime = undefined, TTags extends string = string>(
  options?: CreateRegistryOptions<TShared, TTags> | { shared?: TShared; runtimeRequired?: boolean },
): CommandRegistry<TShared, TRuntime, boolean, TTags> {
  const opts = options as CreateRegistryOptions<TShared, TTags> | undefined;
  const ownTags: TagCatalog = (opts?.tags ?? {}) as TagCatalog;

  const state: State = {
    shared: opts?.shared,
    runtimeRequired: opts?.runtimeRequired === true,
    ownTags,
    effectiveTags: { ...ownTags },
    errorMessages: opts?.errorMessages ?? {},
    entries: new Map(),
    globals: [],
    excluded: new Set(),
    parents: new Map(),
    parentNamespaces: new Map(),
    listeners: new Set(),
  };

  const registry: CommandRegistry<TShared, TRuntime, boolean, TTags> = {
    runtimeRequired: state.runtimeRequired,

    get tagCatalog(): Readonly<TagCatalog<TTags>> {
      return state.effectiveTags as Readonly<TagCatalog<TTags>>;
    },

    register(
      commandOrWildcard: ContextualCommand<TShared, TRuntime, TTags> | '*',
      commandIfWildcard?: ContextualCommand<TShared, TRuntime, TTags>,
      wildcardOptions?: GlobalRegistrationOptions,
    ): () => void {
      if (commandOrWildcard === '*') {
        return registry.registerGlobal(commandIfWildcard!, wildcardOptions);
      }
      return registry.registerMany([commandOrWildcard]);
    },

    registerMany(items) {
      const additions = new Map<string, Entry>();
      for (const command of items) {
        segment(command.id, 'Command id');
        if (state.excluded.has(command.id))
          throw new Error(`Registration of '${command.id}' is excluded in this registry`);
        if (state.entries.has(command.id) || additions.has(command.id))
          throw new Error(`Duplicate registry entry: ${command.id}`);
        validateCommandTags(command as { id?: string; tags?: string[]; tagOverrides?: Record<string, unknown> }, state);
        additions.set(command.id, { command: { ...command } as unknown as Command });
      }
      if (!additions.size) return () => {};
      for (const [id, entry] of additions) state.entries.set(id, entry);
      publish(state);
      return () => {
        let changed = false;
        for (const [id, entry] of additions)
          if (state.entries.get(id) === entry) { state.entries.delete(id); changed = true; }
        if (changed) publish(state);
      };
    },

    registerGlobal(command, options?: GlobalRegistrationOptions) {
      segment(command.id, 'Command id');
      validateCommandTags(command as { id?: string; tags?: string[]; tagOverrides?: Record<string, unknown> }, state);
      const skipRegistries = new Set(options?.skipRegistries ?? []);
      const global: GlobalEntry = { command: { ...command } as unknown as Command, skipRegistries };
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

      // Atomic catalog recompute: throws TAG_CONFLICT before any mutation
      childState.parents.set(state, (childState.parents.get(state) ?? 0) + 1);
      const namespaces = childState.parentNamespaces.get(state) ?? [];
      namespaces.push(namespace);
      childState.parentNamespaces.set(state, namespaces);

      try {
        recomputeCatalogs(childState, namespace);
      } catch (err) {
        // Rollback the parent registration
        const count = childState.parents.get(state)!;
        if (count === 1) {
          childState.parents.delete(state);
          childState.parentNamespaces.delete(state);
        } else {
          childState.parents.set(state, count - 1);
          childState.parentNamespaces.set(state, namespaces.filter(n => n !== namespace));
        }
        throw err;
      }

      const entry: Entry = { registry: childState };
      state.entries.set(namespace, entry);
      publish(state);

      return () => {
        if (state.entries.get(namespace) !== entry) return;
        state.entries.delete(namespace);
        const count = childState.parents.get(state)!;
        if (count === 1) {
          childState.parents.delete(state);
          childState.parentNamespaces.delete(state);
        } else {
          childState.parents.set(state, count - 1);
          childState.parentNamespaces.set(
            state,
            (childState.parentNamespaces.get(state) ?? []).filter(n => n !== namespace),
          );
        }
        // Recompute catalogs after unmount (no conflict possible on removal)
        try { recomputeCatalogs(childState, namespace); } catch { /* ignore on unmount */ }
        publish(state);
      };
    },

    get(id) {
      return commands(state).find(c => c.id === id) as unknown as
        ContextualCommand<unknown, ObservedRuntime<TRuntime>, TTags> | undefined;
    },

    resolve(id) {
      const parts = id.split('.');
      const path: { state: State; id: string; entry: Entry }[] = [];
      let current = state;

      for (let i = 0; i < parts.length; i++) {
        const name = parts[i];
        const entry = current.entries.get(name);
        const isLast = i === parts.length - 1;

        if (isLast) {
          // Namespace path prefix (everything before the last segment)
          const sourceRegistry = parts.slice(0, i).join('.');

          if (entry && 'command' in entry) {
            path.push({ state: current, id: name, entry });
            return {
              command: { ...entry.command, id } as unknown as ContextualCommand<unknown, ObservedRuntime<TRuntime>>,
              qualifiedId: id,
              shared: current.shared,
              runtimeRequired: current.runtimeRequired,
              isGlobal: false,
              sourceRegistry,
              tagCatalog: { ...current.effectiveTags },
              isValid: () => path.every(part => part.state.entries.get(part.id) === part.entry),
            };
          }

          if (entry) return undefined;

          // Try resolving as a globally injected command.
          const globals = collectGlobals(current);
          const global = globals.find(
            item =>
              item.command.id === name &&
              !current.excluded.has(name) &&
              path.every(part => !item.skipRegistries.has(part.id)),
          );

          if (!global) return undefined;

          const isVisible = () =>
            path.every(part => part.state.entries.get(part.id) === part.entry) &&
            !current.excluded.has(name) &&
            collectGlobals(current).includes(global) &&
            path.every(part => !global.skipRegistries.has(part.id)) &&
            !current.entries.has(name);

          return {
            command: { ...global.command, id } as unknown as ContextualCommand<unknown, ObservedRuntime<TRuntime>>,
            qualifiedId: id,
            shared: current.shared,
            runtimeRequired: current.runtimeRequired,
            isGlobal: true,
            sourceRegistry,
            tagCatalog: { ...current.effectiveTags },
            isValid: isVisible,
          };
        }

        if (!entry || !('registry' in entry)) return undefined;
        path.push({ state: current, id: name, entry });
        current = entry.registry;
      }

      return undefined;
    },

    list() {
      return commands(state) as unknown as ContextualCommand<unknown, ObservedRuntime<TRuntime>, TTags>[];
    },

    listByTag(tag) {
      return registry.list().filter(cmd => (cmd.tags as string[] | undefined)?.includes(tag as string));
    },

    resolveTagDefinition(tag, command?) {
      const catalogDef: TagDefinition = state.effectiveTags[tag as string] ?? {};
      const override = (command as { tagOverrides?: Record<string, Partial<TagDefinition>> } | undefined)
        ?.tagOverrides?.[tag as string] ?? {};
      return { key: tag as string, ...catalogDef, ...override };
    },

    subscribe(listener) {
      state.listeners.add(listener);
      return () => { state.listeners.delete(listener); };
    },
  };

  states.set(registry, state);
  return registry;
}

// ---------------------------------------------------------------------------
// Utility: merge two tag catalogs (for explicit static composition)
// ---------------------------------------------------------------------------

/**
 * Merge tag catalogs from left to right; rightmost wins for duplicate keys.
 * Useful for explicit static composition before mounting.
 *
 * @example
 * const childTags = mergeTagCatalogs(rootTags, { destructive: { color: 'red' } });
 */
export function mergeTagCatalogs<
  A extends Record<string, TagDefinition>,
  B extends Record<string, TagDefinition>,
>(a: A, b: B): A & B {
  return { ...a, ...b } as A & B;
}
