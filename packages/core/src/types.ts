export type Answers = Record<string, string>;
export type Option = { value: string; label: string };
export type Step = { id: string; label: string; options: Option[] | ((answers: Answers) => Promise<Option[]>); when?: (answers: Answers) => boolean };
export type ProgressMode = 'global' | 'local';
export type WorkflowProgress = { mode: ProgressMode; current: number; total: number | null; percentage: number | null; indeterminate: boolean };
export type BackBehavior = 'preserve' | 'reset' | 'smart';
export type FinalStatus = 'idle' | 'loading' | 'success' | 'error';
export type SummaryField = { id: string; label?: string };
export type SummaryItem = { id: string; label: string; value: string };
export type FinalContext = { answers: Answers; summary: SummaryItem[]; status: FinalStatus; error: unknown; result: unknown; execute: () => Promise<void>; back: () => void; close: () => void };
export type FinalStep = { timing?: 'before' | 'after'; when?: (answers: Answers) => boolean; fields?: SummaryField[]; closeOnComplete?: boolean; render?: (context: FinalContext) => unknown };
export type CommandSettings = { arrowNavigation?: boolean; progress?: ProgressMode | false; backBehavior?: BackBehavior; maxVisibleItems?: number; finalStep?: FinalStep | false };
type CommandBase = CommandSettings & { id: string; label: string; steps?: Step[]; when?: (answers: Answers) => boolean };
export type CommandContext<TShared, TRuntime> = { shared: TShared; runtime: TRuntime };
export type ContextualStep<TShared, TRuntime> = Omit<Step, 'options' | 'when'> & {
  options: Option[] | ((answers: Answers, context: CommandContext<TShared, TRuntime>) => Option[] | Promise<Option[]>);
  when?: (answers: Answers, context: CommandContext<TShared, TRuntime>) => boolean;
};
export type ContextualFinalStep<TShared, TRuntime> = Omit<FinalStep, 'when' | 'render'> & {
  when?: (answers: Answers, context: CommandContext<TShared, TRuntime>) => boolean;
  render?: (final: FinalContext, context: CommandContext<TShared, TRuntime>) => unknown;
};
type ContextualCommandBase<TShared, TRuntime> = Omit<CommandBase, 'when' | 'steps' | 'finalStep'> & {
  finalStep?: ContextualFinalStep<TShared, TRuntime> | false;
  when?: (answers: Answers, context: CommandContext<TShared, TRuntime>) => boolean;
  steps?: ContextualStep<TShared, TRuntime>[];
};
export type ContextualCommand<TShared, TRuntime> = ContextualCommandBase<TShared, TRuntime> & ({ commands: ContextualCommand<TShared, TRuntime>[]; run?: (answers: Answers, context: CommandContext<TShared, TRuntime>) => unknown | Promise<unknown> } | { commands?: never; run: (answers: Answers, context: CommandContext<TShared, TRuntime>) => unknown | Promise<unknown> });
export type Command = CommandBase & ({ commands: Command[]; run?: (answers: Answers) => unknown | Promise<unknown> } | { commands?: never; run: (answers: Answers) => unknown | Promise<unknown> });
export type StepView = Omit<Step, 'when' | 'options'>;
export type CommandView = Omit<CommandBase, 'when' | 'steps' | 'finalStep'> & { steps?: StepView[]; commands?: CommandView[] };
export type EngineSnapshot<TCommand extends CommandView = Command, TRuntime = unknown> = { context?: CommandContext<unknown, TRuntime>; phase: 'menu' | 'step' | 'running' | 'final'; command: TCommand | null; menuLabel: string; step: (TCommand extends Command ? Step : StepView) | undefined; answers: Answers; items: (TCommand | Option)[]; query: string; active: number; loading: boolean; running: boolean; error: unknown; loadFailed: boolean; progress: WorkflowProgress | null; finalStep: FinalStep | null; summary: SummaryItem[]; status: FinalStatus; result: unknown; arrowNavigation: boolean; maxVisibleItems: number; canBack: boolean; canForward: boolean; closed: boolean };
export type EngineCallbacks<TCommand extends CommandView = Command, TRuntime = unknown> = { onNavigate?: (snapshot: EngineSnapshot<TCommand, TRuntime>, context?: CommandContext<unknown, TRuntime>) => void; onExecute?: (command: TCommand, answers: Answers, context?: CommandContext<unknown, TRuntime>) => void; onError?: (error: unknown, snapshot: EngineSnapshot<TCommand, TRuntime>, context?: CommandContext<unknown, TRuntime>) => void; onClose?: (snapshot: EngineSnapshot<TCommand, TRuntime>, context?: CommandContext<unknown, TRuntime>) => void };
export type EngineStrategies<TCommand extends CommandView = Command, TRuntime = unknown> = { allowTransition?: (from: EngineSnapshot<TCommand, TRuntime>, action: string) => boolean; closeOnComplete?: (command: TCommand, answers: Answers, finalStep: FinalStep | null, context?: CommandContext<unknown, TRuntime>) => boolean };
export type EnginePlugin<TCommand extends CommandView = Command, TRuntime = unknown> = { setup: (engine: CommandEngine<TCommand, TRuntime>) => void | (() => void) };
export type EngineOptions = { commands: Command[]; defaults?: CommandSettings; callbacks?: EngineCallbacks; strategies?: EngineStrategies; plugins?: EnginePlugin[] };
export type RegistryRuntime<TRuntime> = [TRuntime] extends [undefined] ? unknown : TRuntime;
export type RequiredRuntime<TRuntime> = RegistryRuntime<TRuntime> & ({} | null);
export type RegistryEngineOptions<TShared = undefined, TRuntime = undefined, TRuntimeRequired extends boolean = boolean> = { registry: CommandRegistry<TShared, TRuntime, TRuntimeRequired>; commands?: never; defaults?: CommandSettings; callbacks?: EngineCallbacks<CommandView, RegistryRuntime<TRuntime>>; strategies?: EngineStrategies<CommandView, RegistryRuntime<TRuntime>>; plugins?: EnginePlugin<CommandView, RegistryRuntime<TRuntime>>[] } & ([TRuntimeRequired] extends [false] ? { runtime?: () => RegistryRuntime<TRuntime> | Promise<RegistryRuntime<TRuntime>> } : { runtime: () => RequiredRuntime<TRuntime> | Promise<RequiredRuntime<TRuntime>> });
export type CommandEngine<TCommand extends CommandView = Command, TRuntime = unknown> = { getSnapshot: () => EngineSnapshot<TCommand, TRuntime>; subscribe: (listener: () => void) => () => void; setCommands: (commands: Command[]) => void; setOptions: (options: { commands?: Command[]; defaults?: CommandSettings; callbacks?: EngineCallbacks<TCommand, TRuntime>; strategies?: EngineStrategies<TCommand, TRuntime> }) => void; select: (index: number) => void; back: () => void; forward: () => void; setQuery: (query: string) => void; setActive: (index: number) => void; retry: () => void; execute: () => Promise<void>; close: () => void; destroy: () => void };

export type RegistryCommandEngine<TRuntime = undefined, TRuntimeRequired extends boolean = boolean> = Omit<CommandEngine<CommandView, RegistryRuntime<TRuntime>>, 'execute'> & { execute: (options?: { runtime: [TRuntimeRequired] extends [false] ? RegistryRuntime<TRuntime> : RequiredRuntime<TRuntime> }) => Promise<void>; refreshRegistry: () => void };

export type ObservedRuntime<TRuntime> = [TRuntime] extends [undefined] ? unknown : TRuntime;

export type ResolvedCommand<TRuntime = undefined> = {
  readonly command: ContextualCommand<unknown, ObservedRuntime<TRuntime>>;
  readonly qualifiedId: string;
  readonly shared: unknown;
  readonly runtimeRequired: boolean;
  isValid(): boolean;
};

declare const runtimeType: unique symbol;
export type CommandRegistry<TShared = undefined, TRuntime = undefined, TRuntimeRequired extends boolean = boolean> = {
  readonly [runtimeType]?: (runtime: TRuntime) => TRuntime;
  readonly runtimeRequired: TRuntimeRequired;
  register(command: ContextualCommand<TShared, TRuntime>): () => void;
  registerMany(commands: readonly ContextualCommand<TShared, TRuntime>[]): () => void;
  mount<TChild, TChildRuntime, TChildRequired extends boolean>(namespace: string, registry: CommandRegistry<TChild, TChildRuntime, TChildRequired> & ([TRuntime] extends [undefined] ? unknown : [Exclude<TRuntime, undefined>] extends [TChildRuntime] ? unknown : never)): () => void;
  get(id: string): ContextualCommand<unknown, ObservedRuntime<TRuntime>> | undefined;
  resolve(id: string): ResolvedCommand<TRuntime> | undefined;
  list(): ContextualCommand<unknown, ObservedRuntime<TRuntime>>[];
  subscribe(listener: () => void): () => void;
};
