export type Answers = Record<string, string>;
export type Option = { value: string; label: string };
export type Step = { id: string; label: string; options: Option[] | ((answers: Answers) => Promise<Option[]>); when?: (answers: Answers) => boolean; /** Token types recognized while this step is active (local scope). */ tokens?: TokenType<any>[] };
export type ProgressMode = 'global' | 'local';
export type WorkflowProgress = { mode: ProgressMode; current: number; total: number | null; percentage: number | null; indeterminate: boolean };
export type BackBehavior = 'preserve' | 'reset' | 'smart';
export type FinalStatus = 'idle' | 'loading' | 'success' | 'error';
export type SummaryField = { id: string; label?: string };
export type SummaryItem = { id: string; label: string; value: string };
export type FinalContext = { answers: Answers; summary: SummaryItem[]; status: FinalStatus; error: unknown; result: unknown; execute: () => Promise<void>; back: () => void; close: () => void };
export type FinalStep = { timing?: 'before' | 'after'; when?: (answers: Answers) => boolean; fields?: SummaryField[]; closeOnComplete?: boolean; render?: (context: FinalContext) => unknown };
export type CommandSettings = { arrowNavigation?: boolean; progress?: ProgressMode | false; backBehavior?: BackBehavior; maxVisibleItems?: number; finalStep?: FinalStep | false };

// ---------------------------------------------------------------------------
// Tag system
// ---------------------------------------------------------------------------

/** Visual variant for a tag badge. */
export type TagVariant = 'solid' | 'outline' | 'soft';

/**
 * Definition of a single tag in a tag catalog.
 * All fields are optional — a tag entry need not specify all of them.
 */
export type TagDefinition = {
  /** Human-readable label shown in the UI. */
  label?: string;
  /** CSS colour string (hex, rgb, hsl, …). Framework-agnostic. */
  color?: string;
  /** Additional CSS class names. Use literal Tailwind classes for purge detection. */
  className?: string;
  /** Badge rendering variant. */
  variant?: TagVariant;
  /** Arbitrary inline styles. CSSProperties-compatible but not React-typed at core level. */
  style?: Record<string, string | number>;
};

/**
 * A fully resolved tag definition after merging registry catalog + command override.
 * Includes the tag key for convenience.
 */
export type ResolvedTagDefinition = TagDefinition & { key: string };

/**
 * A tag catalog: mapping from tag key to its definition.
 * The generic `TTags` constrains which keys are valid.
 */
export type TagCatalog<TTags extends string = string> = Record<TTags, TagDefinition>;

/**
 * Per-command tag overrides. Keys must be valid catalog keys.
 * Merged on top of the catalog definition (command override wins).
 */
export type TagOverrides<TTags extends string = string> = Partial<Record<TTags, Partial<TagDefinition>>>;

/**
 * Customisable error message factories.
 * Keys are stable `CmdlyErrorCode` values; each function receives typed details.
 */
export type ErrorMessages = {
  TAG_CONFLICT?: (details: { tag: string; registries: string[] }) => string;
  UNKNOWN_TAG?: (details: { tag: string; commandId: string; allowedTags: string[] }) => string;
  INVALID_TAG_OVERRIDE?: (details: { tag: string; commandId: string }) => string;
  COMMAND_UNAVAILABLE?: (details: { qualifiedId: string }) => string;
};


// ---------------------------------------------------------------------------
// Tokens (recognized in user input; unrelated to tags)
// ---------------------------------------------------------------------------

/** Validation status of a recognized token. */
export type TokenStatus = 'pending' | 'valid' | 'invalid' | 'error' | 'ambiguous';

/** One entry of a token type's optional value registry. */
export type TokenValue<TData = unknown> = { value: string; label?: string; data?: TData };

/**
 * Result of a token matcher. Either a plain boolean, or an object discriminated by `valid`
 * (use the object form to attach typed data or an invalidity message).
 */
export type TokenMatchResult<TData = unknown> =
  | boolean
  | { valid: true; data: TData }
  | { valid: false; message?: string };

/** Validates a token value. May be synchronous or asynchronous; honour `signal` to stop obsolete work. */
export type TokenMatcher<TData = unknown> = (
  value: string,
  context: { signal: AbortSignal; type: TokenType<TData> },
) => TokenMatchResult<TData> | Promise<TokenMatchResult<TData>>;

type TokenTypeBase = { id: string; label?: string };
type TokenValidation<TData> =
  | { values?: TokenValue<TData>[]; match?: never }
  | { match: TokenMatcher<TData>; values?: never };
type TokenDetection =
  | { prefixMode?: 'required'; prefix: string; detect?: never }
  | { prefixMode: 'none'; detect: RegExp | ((word: string) => boolean); prefix?: never };

/**
 * A kind of token recognized in the input.
 * - `prefixMode: 'required'` (default): the word must start with `prefix` (one or more characters).
 * - `prefixMode: 'none'`: no prefix; `detect` decides whether a whole word is a token.
 * Validation uses `values` (optional registry) or `match` (custom, sync or async); without either,
 * any non-empty value is valid.
 */
export type TokenType<TData = unknown> = TokenTypeBase & TokenValidation<TData> & TokenDetection;

/** A token recognized in the input. Immutable: a new object is published on every change. */
export type Token<TData = unknown> = {
  /** Stable identifier for the token's lifetime (usable as a React key). */
  id: string;
  /** Id of the selected type; absent when `status` is `'ambiguous'`. */
  type?: string;
  /** Ids of the competing types (more than one when several types matched). */
  candidates: string[];
  /** The matched prefix; `''` for prefix-less types. */
  prefix: string;
  value: string;
  raw: string;
  start: number;
  end: number;
  status: TokenStatus;
  data?: TData;
  message?: string;
  error?: unknown;
  /** Step id where the token was typed; absent for the menu. */
  step?: string;
};

/** Picks one type among same-prefix candidates of the same scope. Return `undefined` to leave the token ambiguous. */
export type TokenResolver = (input: {
  prefix: string;
  value: string;
  candidates: TokenType<any>[];
  scope: 'global' | 'command' | 'step';
}) => string | undefined;

export type TokenOptions = { types?: TokenType<any>[]; resolve?: TokenResolver };

/** Aggregated, render-independent token feedback. Tokens with an empty value are ignored. */
export type TokenFeedback = {
  /** Priority: error > ambiguous > invalid > pending > valid; `'idle'` when there is nothing to report. */
  status: 'idle' | TokenStatus;
  pending: Token[];
  /** Tokens whose status is `'invalid'`, `'error'` or `'ambiguous'`. */
  issues: Token[];
};

/** Token data handed to commands at execution time (only when tokens are configured). */
export type TokenRunContext = {
  /** Tokens captured along the workflow path, in order. */
  tokens: Token[];
  /** Resolves once no captured token is `'pending'`. */
  settleTokens: () => Promise<Token[]>;
};

/** Dynamic registry of global token types. */
export type TokenTypeRegistry = {
  /** Add a type, replacing any type with the same id. Returns a disposer. */
  register: (type: TokenType<any>) => () => void;
  unregister: (id: string) => void;
  /** Replace the value registry of a type. Throws for types using `match`. */
  setValues: (id: string, values: TokenValue<any>[] | undefined) => void;
  list: () => TokenType<any>[];
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type CommandBase = CommandSettings & {
  id: string;
  label: string;
  /** Tag keys from the registry's catalog (or free-form strings when no catalog). */
  tags?: string[];
  steps?: Step[];
  when?: (answers: Answers) => boolean;
  /** Token types recognized in this command's submenu and steps (local scope). */
  tokens?: TokenType<any>[];
};

/** `tokens` and `settleTokens` are present when token recognition is configured. */
export type CommandContext<TShared, TRuntime> = { shared: TShared; runtime: TRuntime } & Partial<TokenRunContext>;

export type ContextualStep<TShared, TRuntime> = Omit<Step, 'options' | 'when'> & {
  options: Option[] | ((answers: Answers, context: CommandContext<TShared, TRuntime>) => Option[] | Promise<Option[]>);
  when?: (answers: Answers, context: CommandContext<TShared, TRuntime>) => boolean;
};
export type ContextualFinalStep<TShared, TRuntime> = Omit<FinalStep, 'when' | 'render'> & {
  when?: (answers: Answers, context: CommandContext<TShared, TRuntime>) => boolean;
  render?: (final: FinalContext, context: CommandContext<TShared, TRuntime>) => unknown;
};

type ContextualCommandBase<TShared, TRuntime, TTags extends string = string> = Omit<CommandBase, 'when' | 'steps' | 'finalStep' | 'tags'> & {
  /** Tag keys — constrained to the registry's catalog when one is declared. */
  tags?: TTags[];
  /** Per-command tag presentation overrides. Keys must match declared tags. */
  tagOverrides?: TagOverrides<TTags>;
  finalStep?: ContextualFinalStep<TShared, TRuntime> | false;
  when?: (answers: Answers, context: CommandContext<TShared, TRuntime>) => boolean;
  steps?: ContextualStep<TShared, TRuntime>[];
};

export type ContextualCommand<TShared, TRuntime, TTags extends string = string> =
  ContextualCommandBase<TShared, TRuntime, TTags> &
  (
    | { commands: ContextualCommand<TShared, TRuntime, TTags>[]; run?: (answers: Answers, context: CommandContext<TShared, TRuntime>) => unknown | Promise<unknown> }
    | { commands?: never; run: (answers: Answers, context: CommandContext<TShared, TRuntime>) => unknown | Promise<unknown> }
  );

export type Command = CommandBase & {
  tagOverrides?: TagOverrides;
} & (
  | { commands: Command[]; run?: (answers: Answers, context?: Partial<TokenRunContext>) => unknown | Promise<unknown> }
  | { commands?: never; run: (answers: Answers, context?: Partial<TokenRunContext>) => unknown | Promise<unknown> }
);

export type StepView = Omit<Step, 'when' | 'options'>;
export type CommandView = Omit<CommandBase, 'when' | 'steps' | 'finalStep'> & {
  tagOverrides?: TagOverrides;
  steps?: StepView[];
  commands?: CommandView[];
};

export type EngineSnapshot<TCommand extends CommandView = Command, TRuntime = unknown> = {
  context?: CommandContext<unknown, TRuntime>;
  phase: 'menu' | 'step' | 'running' | 'final';
  command: TCommand | null;
  menuLabel: string;
  step: (TCommand extends Command ? Step : StepView) | undefined;
  answers: Answers;
  items: (TCommand | Option)[];
  query: string;
  /** The query without recognized tokens; used for search. Equals `query` when no token is recognized. */
  text: string;
  /** Tokens recognized in the current query. */
  tokens: Token[];
  /** Aggregated feedback over the current and captured tokens. */
  tokenFeedback: TokenFeedback;
  active: number;
  loading: boolean;
  running: boolean;
  error: unknown;
  loadFailed: boolean;
  progress: WorkflowProgress | null;
  finalStep: FinalStep | null;
  summary: SummaryItem[];
  status: FinalStatus;
  result: unknown;
  arrowNavigation: boolean;
  maxVisibleItems: number;
  canBack: boolean;
  canForward: boolean;
  closed: boolean;
};
export type EngineCallbacks<TCommand extends CommandView = Command, TRuntime = unknown> = { onNavigate?: (snapshot: EngineSnapshot<TCommand, TRuntime>, context?: CommandContext<unknown, TRuntime>) => void; onExecute?: (command: TCommand, answers: Answers, context?: CommandContext<unknown, TRuntime>) => void; onError?: (error: unknown, snapshot: EngineSnapshot<TCommand, TRuntime>, context?: CommandContext<unknown, TRuntime>) => void; onClose?: (snapshot: EngineSnapshot<TCommand, TRuntime>, context?: CommandContext<unknown, TRuntime>) => void };
export type EngineStrategies<TCommand extends CommandView = Command, TRuntime = unknown> = { allowTransition?: (from: EngineSnapshot<TCommand, TRuntime>, action: string) => boolean; closeOnComplete?: (command: TCommand, answers: Answers, finalStep: FinalStep | null, context?: CommandContext<unknown, TRuntime>) => boolean };
export type EnginePlugin<TCommand extends CommandView = Command, TRuntime = unknown> = { setup: (engine: CommandEngine<TCommand, TRuntime>) => void | (() => void) };
export type EngineOptions = { commands: Command[]; defaults?: CommandSettings; callbacks?: EngineCallbacks; strategies?: EngineStrategies; plugins?: EnginePlugin[]; tokens?: TokenOptions };
export type RegistryRuntime<TRuntime> = [TRuntime] extends [undefined] ? unknown : TRuntime;
export type RequiredRuntime<TRuntime> = RegistryRuntime<TRuntime> & ({} | null);

/**
 * Controls how global commands (registered via `register("*", ...)`) are presented.
 *
 * - `"unique"` *(default)*: each global command appears exactly once.
 *   When `activeRegistry` is set, the command resolves through that namespace.
 * - `"per-registry"`: the global appears once per namespace it was injected into.
 */
export type GlobalDisplayMode = 'unique' | 'per-registry';

export type RegistryEngineOptions<TShared = undefined, TRuntime = undefined, TRuntimeRequired extends boolean = boolean> = {
  registry: CommandRegistry<TShared, TRuntime, TRuntimeRequired>;
  commands?: never;
  defaults?: CommandSettings;
  callbacks?: EngineCallbacks<CommandView, RegistryRuntime<TRuntime>>;
  strategies?: EngineStrategies<CommandView, RegistryRuntime<TRuntime>>;
  plugins?: EnginePlugin<CommandView, RegistryRuntime<TRuntime>>[];
  /** Global token types and collision resolver. */
  tokens?: TokenOptions;
  /** Controls global-command deduplication. Defaults to `"unique"`. */
  globalDisplay?: GlobalDisplayMode;
  /**
   * The namespace id whose `shared`/`runtime` context should own global commands
   * when `globalDisplay` is `"unique"`. Never inferred automatically.
   */
  activeRegistry?: string;
} & ([TRuntimeRequired] extends [false]
  ? { runtime?: () => RegistryRuntime<TRuntime> | Promise<RegistryRuntime<TRuntime>> }
  : { runtime: () => RequiredRuntime<TRuntime> | Promise<RequiredRuntime<TRuntime>> });

export type CommandEngine<TCommand extends CommandView = Command, TRuntime = unknown> = { getSnapshot: () => EngineSnapshot<TCommand, TRuntime>; subscribe: (listener: () => void) => () => void; setCommands: (commands: Command[]) => void; setOptions: (options: { commands?: Command[]; defaults?: CommandSettings; callbacks?: EngineCallbacks<TCommand, TRuntime>; strategies?: EngineStrategies<TCommand, TRuntime>; tokens?: TokenOptions }) => void; tokens: TokenTypeRegistry; select: (index: number) => void; back: () => void; forward: () => void; setQuery: (query: string) => void; setActive: (index: number) => void; retry: () => void; execute: () => Promise<void>; close: () => void; destroy: () => void };

export type RegistryCommandEngine<TRuntime = undefined, TRuntimeRequired extends boolean = boolean> = Omit<CommandEngine<CommandView, RegistryRuntime<TRuntime>>, 'execute'> & {
  execute: (options?: { runtime: [TRuntimeRequired] extends [false] ? RegistryRuntime<TRuntime> : RequiredRuntime<TRuntime> }) => Promise<void>;
  refreshRegistry: () => void;
};

export type ObservedRuntime<TRuntime> = [TRuntime] extends [undefined] ? unknown : TRuntime;

export type ResolvedCommand<TRuntime = undefined> = {
  readonly command: ContextualCommand<unknown, ObservedRuntime<TRuntime>>;
  readonly qualifiedId: string;
  readonly shared: unknown;
  readonly runtimeRequired: boolean;
  /** True when this command was registered via `register("*", ...)` / `registerGlobal()`. */
  readonly isGlobal: boolean;
  /**
   * The namespace path at which this command was resolved (e.g. `"editor"` for `"editor.search"`).
   * Empty string for root-level commands.
   */
  readonly sourceRegistry: string;
  /**
   * The effective tag catalog at the registry where this command was resolved,
   * after inheriting from parent registries.
   */
  readonly tagCatalog: Readonly<TagCatalog>;
  isValid(): boolean;
};

declare const runtimeType: unique symbol;

/**
 * Options for wildcard (global) registration.
 * `skipRegistries` lists the namespace ids to skip — registry mount points, not command ids.
 */
export type GlobalRegistrationOptions = { skipRegistries?: string[] };

/**
 * Options for `createCommandRegistry()`.
 * Provide `tags` to enable static tag key validation.
 */
export type CreateRegistryOptions<TShared, TTags extends string> = {
  shared?: TShared;
  runtimeRequired?: boolean;
  /**
   * Tag catalog. Keys become the allowed tag values in commands registered to this registry.
   * When omitted, `tags: string[]` is accepted (backward-compatible).
   */
  tags?: Record<TTags, TagDefinition>;
  /**
   * Custom error message factories. Only the message text is affected — code and details
   * remain unchanged and the error is always thrown.
   */
  errorMessages?: ErrorMessages;
};

export type CommandRegistry<TShared = undefined, TRuntime = undefined, TRuntimeRequired extends boolean = boolean, TTags extends string = string> = {
  readonly [runtimeType]?: (runtime: TRuntime) => TRuntime;
  readonly runtimeRequired: TRuntimeRequired;
  /**
   * The effective tag catalog for this registry (own tags merged with inherited parent tags).
   * Updated dynamically when new parents are mounted.
   */
  readonly tagCatalog: Readonly<TagCatalog<TTags>>;

  /**
   * Register a command in this registry.
   * When a tag catalog exists, `tags` is constrained to its keys.
   */
  register(command: ContextualCommand<TShared, TRuntime, TTags>): () => void;
  /**
   * Register a command into every namespace (current and future).
   * @example registry.register("*", helpCmd, { skipRegistries: ["admin"] })
   */
  register(wildcard: '*', command: ContextualCommand<TShared, TRuntime, TTags>, options?: GlobalRegistrationOptions): () => void;

  registerMany(commands: readonly ContextualCommand<TShared, TRuntime, TTags>[]): () => void;

  /** Alias for `register("*", command, options)`. */
  registerGlobal(command: ContextualCommand<TShared, TRuntime, TTags>, options?: GlobalRegistrationOptions): () => void;

  /**
   * Permanently block command ids from being registered in this registry.
   * Retroactively removes existing entries. Throws on future attempts.
   * Blocks command ids — not registry namespace ids.
   */
  exclude(ids: string[]): void;

  mount<TChild, TChildRuntime, TChildRequired extends boolean, TChildTags extends string>(
    namespace: string,
    registry: CommandRegistry<TChild, TChildRuntime, TChildRequired, TChildTags> &
      ([TRuntime] extends [undefined] ? unknown : [Exclude<TRuntime, undefined>] extends [TChildRuntime] ? unknown : never),
  ): () => void;

  get(id: string): ContextualCommand<unknown, ObservedRuntime<TRuntime>, TTags> | undefined;
  resolve(id: string): ResolvedCommand<TRuntime> | undefined;
  list(): ContextualCommand<unknown, ObservedRuntime<TRuntime>, TTags>[];
  subscribe(listener: () => void): () => void;

  /** Filter commands by tag key. */
  listByTag(tag: TTags): ContextualCommand<unknown, ObservedRuntime<TRuntime>, TTags>[];

  /**
   * Resolve the display definition for a tag on a specific command.
   * Merges: command override → own catalog → inherited catalog → empty object.
   */
  resolveTagDefinition(tag: TTags, command?: ContextualCommand<unknown, unknown, TTags>): ResolvedTagDefinition;
};
