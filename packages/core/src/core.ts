import type { Frame, Level, Position, TokenCell } from './engine-state.js';
import { createTokenTypeRegistry, evaluateToken, getTokenFeedback, sameValidation, tokenize } from './tokens.js';
import type { TokenMatch, TokenOutcome, TokenScope } from './tokens.js';
import { key, clearSavedBranch, resolveSetting, resolveFinalConfig, summarizeAnswers, calculateProgress } from './workflow.js';
import { CommandUnavailableError, CmdlyError } from './errors.js';
import type { Token, TokenType, Answers, Option, Step, ProgressMode, WorkflowProgress, BackBehavior, FinalStatus, SummaryField, SummaryItem, FinalContext, FinalStep, CommandSettings, CommandContext, ContextualStep, ContextualFinalStep, ContextualCommand, Command, StepView, CommandView, EngineSnapshot, EngineCallbacks, EngineStrategies, EnginePlugin, EngineOptions, RegistryRuntime, RequiredRuntime, RegistryEngineOptions, CommandEngine, RegistryCommandEngine, ResolvedCommand, CommandRegistry, GlobalRegistrationOptions, GlobalDisplayMode, TagDefinition, TagCatalog, TagVariant, TagOverrides, ResolvedTagDefinition, ErrorMessages, CreateRegistryOptions, TokenRunContext } from './types.js';
export type { Answers, Option, Step, ProgressMode, WorkflowProgress, BackBehavior, FinalStatus, SummaryField, SummaryItem, FinalContext, FinalStep, CommandSettings, CommandContext, ContextualStep, ContextualFinalStep, ContextualCommand, Command, StepView, CommandView, EngineSnapshot, EngineCallbacks, EngineStrategies, EnginePlugin, EngineOptions, RegistryRuntime, RequiredRuntime, RegistryEngineOptions, CommandEngine, RegistryCommandEngine, ResolvedCommand, CommandRegistry, GlobalRegistrationOptions, GlobalDisplayMode, TagDefinition, TagCatalog, TagVariant, TagOverrides, ResolvedTagDefinition, ErrorMessages, CreateRegistryOptions, TokenStatus, TokenValue, TokenMatchResult, TokenMatcher, TokenType, Token, TokenResolver, TokenOptions, TokenFeedback, TokenRunContext, TokenTypeRegistry } from './types.js';
export { defineTokenType, getTokenFeedback, tokenize, validateTokenType } from './tokens.js';
export type { TokenScope, TokenScopeKind, TokenMatch } from './tokens.js';
export { createCommandRegistry, mergeTagCatalogs } from './registry.js';
export { CommandUnavailableError, CmdlyError } from './errors.js';
export type { CmdlyErrorCode, CmdlyErrorDetails } from './errors.js';

/** Filter an array of commands by tag. */
export function filterByTag<T extends { tags?: string[] }>(commands: T[], tag: string): T[] {
  return commands.filter(cmd => cmd.tags?.includes(tag));
}


/** Creates a framework-independent workflow store. Async operations are ignored after navigation or destruction. */
export function createCommandEngine<TShared, TRuntime, TRuntimeRequired extends boolean>(input: RegistryEngineOptions<TShared, TRuntime, TRuntimeRequired>): RegistryCommandEngine<TRuntime, TRuntimeRequired>;
export function createCommandEngine(input?: EngineOptions): CommandEngine;
export function createCommandEngine(inputValue: unknown = { commands: [] }): unknown {
  const input = inputValue as EngineOptions | RegistryEngineOptions<never, never>;
  if ('registry' in input && input.registry && 'commands' in input) throw new Error('Provide commands or registry, not both');
  const registry = 'registry' in input ? input.registry : undefined;
  const globalDisplay: GlobalDisplayMode = ('globalDisplay' in input ? input.globalDisplay : undefined) ?? 'unique';
  const activeRegistry: string | undefined = 'activeRegistry' in input ? input.activeRegistry : undefined;
  const provenance = new WeakMap<Command, ResolvedCommand<never>>();
  const readRegistry = (): Command[] => {
    if (!registry) throw new Error('Engine has no registry');
    const resolved = registry.list().map(item => {
      const entry = registry.resolve(item.id);
      if (!entry || !entry.isValid()) throw new Error(`Registry changed while reading: ${item.id}`);
      return entry;
    });
    if (resolved.some(entry => !entry.isValid())) throw new Error('Registry changed while reading');

    let entries = resolved;

    if (globalDisplay === 'unique') {
      // For each global command (by its base id), keep exactly one entry.
      // Preference order:
      //   1. `activeRegistry` namespace  → "ns.cmdId"
      //   2. root-level                   → "cmdId"
      //   3. first occurrence (fallback)
      const seenGlobalIds = new Set<string>();
      const deduplicated: ResolvedCommand<never>[] = [];

      for (const entry of resolved) {
        if (!entry.isGlobal) {
          // Local commands are always kept as-is.
          deduplicated.push(entry);
          continue;
        }

        // The base command id is the last segment of the qualified id.
        const baseId = entry.qualifiedId.split('.').pop()!;

        if (seenGlobalIds.has(baseId)) continue; // already chose a winner for this global

        // Look for the preferred variant:
        // 1. activeRegistry prefix wins
        // 2. root-level (no dot) is second best
        // 3. fall back to current entry
        let winner = entry;
        let matched = false;
        if (activeRegistry) {
          const preferred = resolved.find(
            e => e.isGlobal && e.qualifiedId === `${activeRegistry}.${baseId}`,
          );
          if (preferred) { winner = preferred; matched = true; }
        }
        if (!matched && winner.qualifiedId.includes('.')) {
          // No activeRegistry match; prefer root-level if one exists
          const root = resolved.find(
            e => e.isGlobal && e.qualifiedId === baseId,
          );
          if (root) winner = root;
        }

        seenGlobalIds.add(baseId);
        deduplicated.push(winner);
      }

      entries = deduplicated;
    }

    for (const entry of entries) provenance.set(entry.command as unknown as Command, entry);
    return entries.map(entry => entry.command as unknown as Command);
  };
  let config: EngineOptions = { ...(input as unknown as EngineOptions), commands: registry ? readRegistry() : (input as EngineOptions).commands };

  let path: Level[] = [], command: Command | null = null, frames: Frame[] = [];
  let phase: Position['phase'] = 'menu', finalAnswers: Answers = {}, query = '', active = 0;
  let options: Option[] = [], loading = false, running = false, error: unknown = null, loadFailed = false;
  let status: FinalStatus = 'idle', result: unknown = undefined, closed = false, destroyed = false, generation = 0, finalVisible = false;
  let forward: Position[] = [];
  // Tokens: `liveCells` belong to the current query; captured cells travel with frames/levels like answers.
  let tokenResolve = config.tokens?.resolve, tokenConfigured = config.tokens !== undefined, tokenSeq = 0;
  let liveCells: TokenCell[] = [], finalTokens: TokenCell[] = [], transitionTokens: TokenCell[] | undefined, text = '';
  const pendingCells = new Set<TokenCell>();
  // Aborted on close/destroy only — never by navigation. Exposed to commands as `signal`.
  const lifetime = new AbortController();
  const tokenTypes = createTokenTypeRegistry(() => { tokenConfigured = true; if (destroyed) return; refreshTokens(); publish(); }, config.tokens?.types ?? []);
  type Session = { state: 'preparing' | 'ready' | 'failed'; runtime: unknown; used: boolean };
  let session: Session | undefined;
  const missingRuntimeError = new Error('Runtime is required');
  let invocationContext: CommandContext<unknown, unknown> | undefined;
  let invocationCommand: Command | undefined;
  let rootRetired = false, readyToReport = false, initialPredicateError: unknown;
  const originFor = (selected: Command) => provenance.get(path[0]?.command ?? selected);
  const ensureOrigin = (origin: ResolvedCommand<never> | undefined) => { if (origin && !origin.isValid()) throw new CommandUnavailableError(origin.qualifiedId); };
  const contextFor = (selected: Command) => {
    const origin = originFor(selected); ensureOrigin(origin);
    if (!origin) return undefined;
    if (!session || session.state !== 'ready') throw new Error('Runtime is not prepared');
    if (origin.runtimeRequired && session.runtime === undefined) throw missingRuntimeError;
    session.used = true; return withTokens({ shared: origin.shared, runtime: session.runtime }, selected);
  };
  const evaluate = (callback: (answers: Answers) => boolean, answers: Answers, selected: Command) => {
    const origin = originFor(selected), context = contextFor(selected), evaluationGeneration = generation;
    const value = (callback as (answers: Answers, context?: { shared: unknown; runtime: unknown }) => boolean)(answers, context);
    ensureOrigin(origin);
    if (destroyed || closed || generation !== evaluationGeneration) throw new Error('Workflow transition cancelled');
    return value;
  };
  const needsContext = (selected: Command) => {
    let final: FinalStep | false | undefined = config.defaults?.finalStep;
    for (const item of [...path.map(level => level.command), selected]) {
      if (item.finalStep === false) final = false;
      else if (item.finalStep) final = { ...(final || {}), ...item.finalStep };
    }
    return !!selected.when || !!selected.commands?.some(child => !!child.when) || !!selected.steps?.some(step => !!step.when || typeof step.options === 'function') || !!(final && (final.when || final.render));
  };
  const observedContext = (): CommandContext<unknown, unknown> | undefined => {
    const selected = command ?? path[path.length - 1]?.command;
    if (!selected) return undefined;
    const origin = originFor(selected);
    if (!origin || !origin.isValid()) return undefined;
    if (invocationContext && invocationCommand === selected) return invocationContext;
    if (session?.state !== 'ready' || (origin.runtimeRequired && session.runtime === undefined)) return undefined;
    return withTokens({ shared: origin.shared, runtime: session.runtime }, selected);
  };
  const menuNeedsContext = () => !!registry && (path[path.length - 1]?.command.commands ?? config.commands).some(item => !!item.when);

  const saved = new Map<string, Answers>(), listeners = new Set<() => void>(), cleanups: (() => void)[] = [];
  const chain = () => [...path.map(level => level.command), ...(command ? [command] : [])];
  const currentFrame = () => frames[frames.length - 1];
  const currentStep = () => command && currentFrame() ? command.steps?.[currentFrame().step] : undefined;
  const currentTokens = () => transitionTokens ?? ((phase === 'final' || phase === 'running') ? finalTokens : currentFrame()?.tokens ?? path[path.length - 1]?.tokens ?? []);
  const tokensEnabled = (selected?: Command) => tokenConfigured || [...chain(), ...(selected ? [selected] : [])].some(item => !!item.tokens || !!item.steps?.some(step => !!step.tokens));
  const settleCells = async (cells: TokenCell[]): Promise<Token[]> => { for (;;) { if (lifetime.signal.aborted) throw lifetime.signal.reason; const pending = cells.filter(cell => cell.token.status === 'pending'); if (!pending.length) return cells.map(cell => cell.token); await Promise.all(pending.map(cell => cell.done)); } };
  const tokenContext = (cells: TokenCell[]): TokenRunContext => ({ tokens: cells.map(cell => cell.token), settleTokens: () => settleCells(cells), signal: lifetime.signal });
  function withTokens<T extends object>(context: T, selected?: Command): T { return tokensEnabled(selected) ? { ...context, ...tokenContext(currentTokens()) } : context; }
  const tokenScopes = (): TokenScope[] => {
    // Innermost first. Future dynamically registered local types plug in here, next to the declared ones.
    const scopes: TokenScope[] = [], step = phase === 'step' ? currentStep() : undefined;
    if (step?.tokens?.length) scopes.push({ kind: 'step', types: step.tokens });
    for (const item of chain().reverse()) if (item.tokens?.length) scopes.push({ kind: 'command', types: item.tokens });
    scopes.push({ kind: 'global', types: tokenTypes.list() });
    return scopes;
  };
  const tokenReachable = (cell: TokenCell) => liveCells.includes(cell) || currentTokens().includes(cell);
  const applyOutcome = (cell: TokenCell, outcome: TokenOutcome) => { cell.token = { ...cell.token, ...outcome }; pendingCells.delete(cell); cell.settle(); };
  const createCell = (match: TokenMatch, key: string, source: unknown, step: string | undefined): TokenCell => {
    let settle!: () => void; const done = new Promise<void>(resolve => { settle = resolve; });
    const token: Token = { id: `token-${++tokenSeq}`, type: match.type?.id, candidates: match.candidates.map(type => type.id), prefix: match.prefix, value: match.value, raw: match.raw, start: match.start, end: match.end, status: 'pending', ...(step === undefined ? {} : { step }) };
    const cell: TokenCell = { key, source, token, controller: new AbortController(), done, settle, captured: false, dead: false };
    if (!match.type) { applyOutcome(cell, { status: 'ambiguous' }); return cell; }
    const outcome = evaluateToken(match.type, match.value, cell.controller.signal);
    if (!(outcome instanceof Promise)) { applyOutcome(cell, outcome); return cell; }
    pendingCells.add(cell);
    void outcome.then(result => { if (cell.dead || destroyed) return; applyOutcome(cell, result); if (tokenReachable(cell)) publish(); });
    return cell;
  };
  const discardCell = (cell: TokenCell) => { if (cell.captured) return; cell.dead = true; pendingCells.delete(cell); cell.controller.abort(); cell.settle(); };
  const sameSource = (a: unknown, b: unknown) => a === b || (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, i) => sameValidation(item, b[i])) : !Array.isArray(a) && !Array.isArray(b) && sameValidation(a as TokenType<unknown>, b as TokenType<unknown>));
  const refreshTokens = () => {
    const parsed = tokenize(query, tokenScopes(), tokenResolve), step = phase === 'step' ? currentStep()?.id : undefined;
    const previous = new Map(liveCells.map(cell => [cell.key, cell])), counts = new Map<string, number>();
    text = parsed.text;
    liveCells = parsed.matches.map(match => {
      const base = [step ?? '', match.scope, match.type ? match.type.id : `?${match.candidates.map(type => type.id).join(',')}`, match.prefix, match.value].join('\u0000');
      const n = counts.get(base) ?? 0; counts.set(base, n + 1);
      const key = `${base}\u0000${n}`, source = match.type ?? match.candidates, old = previous.get(key);
      if (old && !old.dead && !old.captured && sameSource(old.source, source)) {
        previous.delete(key);
        if (old.token.start !== match.start) old.token = { ...old.token, start: match.start, end: match.end };
        return old;
      }
      return createCell(match, key, source, step);
    });
    for (const cell of previous.values()) discardCell(cell);
  };
  const clearTokens = () => { for (const cell of liveCells) discardCell(cell); liveCells = []; text = ''; };
  const abortTokens = () => {
    if (!lifetime.signal.aborted) lifetime.abort(new DOMException('The command palette session ended', 'AbortError'));
    for (const cell of pendingCells) { cell.dead = true; cell.controller.abort(); cell.token = { ...cell.token, status: 'error', error: cell.controller.signal.reason }; cell.settle(); }
    pendingCells.clear(); liveCells = []; finalTokens = []; text = '';
  };
  const capture = (base: TokenCell[]) => { for (const cell of liveCells) cell.captured = true; return [...base, ...liveCells]; };
  const currentAnswers = () => (phase === 'final' || phase === 'running') ? finalAnswers : currentFrame()?.answers ?? path[path.length - 1]?.answers ?? {};
  const setting = <K extends keyof CommandSettings>(name: K): CommandSettings[K] => resolveSetting(chain(), name, config.defaults?.[name]);
  const behavior = () => setting('backBehavior') ?? 'smart';
  const clearBranch = (items: Command[]) => clearSavedBranch(saved, items);
  const finalConfig = (): FinalStep | null => resolveFinalConfig(config.defaults?.finalStep, chain());
  const buildSummary = (answers: Answers, final: FinalStep | null): SummaryItem[] => summarizeAnswers(chain(), answers, final);
  let cachedSource: (Command | Option)[] | undefined, cachedPath: Level[] | undefined, cachedCommand: Command | null | undefined, cachedQuery: string | undefined, cachedPhase: Position['phase'] | undefined, cachedItems: (Command | Option)[] = [];
  const visibility = new Map<Command, boolean>();
  let reportedVisibilityErrors = new WeakMap<Command, unknown>();
  const sameVisibilityError = (first: unknown, second: unknown) => first === second || (first instanceof CommandUnavailableError && second instanceof CommandUnavailableError && first.qualifiedId === second.qualifiedId);
  const getItems = (): (Command | Option)[] => {
    if (closed || phase === 'final' || phase === 'running') return [];
    const source = command ? options : path[path.length - 1]?.command.commands ?? config.commands;
    if (source === cachedSource && path === cachedPath && command === cachedCommand && text === cachedQuery && phase === cachedPhase) return cachedItems;
    const search = text.toLowerCase();
    cachedSource = source; cachedPath = path; cachedCommand = command; cachedQuery = text; cachedPhase = phase;
    visibility.clear();
    cachedItems = source.filter(item => {
      if (command) return !search || item.label.toLowerCase().includes(search);
      const selected = item as Command;
      let visible = false;
      try {
        ensureOrigin(originFor(selected));
        visible = !path.some(level => level.command === selected) && (!selected.when || ((!registry || session?.state === 'ready') && evaluate(selected.when, currentAnswers(), selected)));
        reportedVisibilityErrors.delete(selected);
      } catch (err) { if (!registry) throw err; if (readyToReport) { const alreadyReported = reportedVisibilityErrors.has(selected) && sameVisibilityError(reportedVisibilityErrors.get(selected), err); reportedVisibilityErrors.set(selected, err); if (!alreadyReported && !(error !== null && sameVisibilityError(error, err))) report(err); } else { error = err; initialPredicateError = err; } }
      visibility.set(selected, visible);
      return visible && (!search || item.label.toLowerCase().includes(search));
    });
    return cachedItems;
  };
  const getProgress = (): WorkflowProgress | null => calculateProgress(setting('progress'), path, command, frames, phase);
  const makeSnapshot = (): EngineSnapshot => {
    const items = getItems();
    let final = phase === 'final' && finalVisible ? finalConfig() : null;
    const capturedContext = observedContext();
    if (registry && final && command) {
      const render = final.render, when = final.when, selected = command, origin = originFor(selected), token = generation;
      const available = () => !destroyed && !closed && command === selected && generation === token && !!capturedContext && !!origin?.isValid();
      final = { ...final,
        render: render && capturedContext ? finalContext => available() ? (render as (final: FinalContext, context: CommandContext<unknown, unknown>) => unknown)(finalContext, capturedContext) : null : undefined,
        when: when && capturedContext ? answers => available() && (when as (answers: Answers, context: CommandContext<unknown, unknown>) => boolean)(answers, capturedContext) : undefined,
      };
    }
    const requested = setting('maxVisibleItems');
    return { context: capturedContext, phase, command, menuLabel: path[path.length - 1]?.command.label ?? 'Commands', step: currentStep(), answers: { ...currentAnswers() }, items, query, text, tokens: liveCells.map(cell => cell.token), tokenFeedback: getTokenFeedback([...currentTokens(), ...liveCells].map(cell => cell.token)), tokensEnabled: tokenConfigured || tokenScopes().some(scope => scope.types.length > 0) || currentTokens().length > 0, active: Math.min(active, Math.max(0, items.length - 1)), loading, running, error, loadFailed, progress: getProgress(), finalStep: final, summary: buildSummary(currentAnswers(), final), status, result, arrowNavigation: setting('arrowNavigation') ?? false, maxVisibleItems: typeof requested === 'number' && Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 50, canBack: !!command || path.length > 0, canForward: forward.length > 0, closed };
  };
  if (menuNeedsContext()) loading = true;
  let snapshot = makeSnapshot();
  const publish = (navigate = false) => {
    if (destroyed) return;
    snapshot = makeSnapshot();
    if (navigate && !closed && phase === 'menu' && behavior() === 'smart') {
      const ancestors = path.map(item => item.command);
      for (const child of path[path.length - 1]?.command.commands ?? config.commands) if (child.when && visibility.get(child) === false && (!registry || session?.state === 'ready')) clearBranch([...ancestors, child]);
    }
    let failure: unknown; let failed = false;
    for (const listener of [...listeners]) { try { listener(); } catch (err) { if (!failed) failure = err; failed = true; } }
    if (navigate && !destroyed) { try { if (registry) config.callbacks?.onNavigate?.(snapshot, snapshot.context); else config.callbacks?.onNavigate?.(snapshot); } catch (err) { if (!failed) failure = err; failed = true; } }
    if (failed) throw failure;
  };
  const allowed = (action: string) => !destroyed && !closed && (config.strategies?.allowTransition?.(snapshot, action) ?? true);
  const report = (err: unknown) => { error = err; try { if (registry) config.callbacks?.onError?.(err, snapshot, observedContext()); else config.callbacks?.onError?.(err, snapshot); } catch (callbackError) { error = new Error(`Workflow failed (${String(err)}); onError also failed (${String(callbackError)})`); } };
  const prepare = (resume?: () => void, origin?: ResolvedCommand<never>) => {
    if (!registry || session?.state === 'ready') return true;
    if (session?.state === 'preparing') return false;
    const current: Session = { state: 'preparing', runtime: undefined, used: false };
    session = current; loading = true; error = null; loadFailed = false;
    const fail = (err: unknown) => {
      if (destroyed || session !== current) return;
      current.state = 'failed'; loading = false; loadFailed = true; cachedSource = undefined;
      report(err); publish();
    };
    const finish = (runtime: unknown, asynchronous: boolean) => {
      if (destroyed || session !== current) return;
      try {
        ensureOrigin(origin); current.runtime = runtime; current.state = 'ready'; loading = false; cachedSource = undefined;
        if (asynchronous) { publish(); resume?.(); }
      } catch (err) { fail(err); }
    };
    try {
      const provider = 'runtime' in input ? input.runtime : undefined;
      const value = provider?.();
      if (value && typeof (value as PromiseLike<unknown>).then === 'function') { Promise.resolve(value).then(value => finish(value, true), fail); return false; }
      finish(value, false); return current.state === 'ready';
    } catch (err) { fail(err); return false; }
  };
  readyToReport = true;
  if (initialPredicateError !== undefined) report(initialPredicateError);
  const clearTransient = () => { reportedVisibilityErrors = new WeakMap(); query = ''; clearTokens(); active = 0; error = null; loadFailed = false; loading = false; running = false; status = 'idle'; result = undefined; };
  const load = () => {
    const step = currentStep(), frame = currentFrame(), selected = command; if (!step || !frame || !selected) return;
    const token = ++generation, selectedChain = chain(), currentKey = key(selectedChain), selectedBehavior = behavior(), origin = originFor(selected), capturedSession = session;
    options = []; loading = false; error = null; loadFailed = false; active = 0;
    const accept = (items: Option[]) => {
      const previous = saved.get(currentKey)?.[step.id], index = items.findIndex(item => item.value === previous);
      if (previous !== undefined && index < 0 && selectedBehavior === 'smart') {
        const stored = saved.get(currentKey); if (stored) for (const item of selected.steps?.slice(frame.step) ?? []) delete stored[item.id];
        for (const child of selected.commands ?? []) clearBranch([...selectedChain, child]);
      }
      options = items; active = Math.max(0, index); loading = false;
    };
    if (Array.isArray(step.options)) { accept(step.options); return; }
    loading = true;
    Promise.resolve().then(() => {
      if (destroyed || generation !== token || session !== capturedSession) return undefined;
      ensureOrigin(origin); const context = contextFor(selected);
      const value = (step.options as (answers: Answers, context?: { shared: unknown; runtime: unknown }) => Option[] | Promise<Option[]>)({ ...frame.answers }, context);
      ensureOrigin(origin); return value;
    }).then(items => { if (!destroyed && generation === token && session === capturedSession) { if (origin && !origin.isValid()) { loading = false; loadFailed = true; report(new CommandUnavailableError(origin.qualifiedId)); publish(); } else if (items) { accept(items); publish(); } } }, err => { if (!destroyed && generation === token && session === capturedSession) { loading = false; loadFailed = true; report(err); publish(); } });
  };
  const enter = (selected: Command, answers: Answers, start: number, history: Frame[], tokens: TokenCell[]) => {
    transitionTokens = tokens;
    try { enterWith(selected, answers, start, history, tokens); } finally { transitionTokens = undefined; }
  };
  const enterWith = (selected: Command, answers: Answers, start: number, history: Frame[], tokens: TokenCell[]) => {
    const next = selected.steps?.findIndex((step, i) => i >= start && (!step.when || evaluate(step.when, answers, selected))) ?? -1;
    const selectedChain = [...path.map(level => level.command), selected];
    if (behavior() === 'smart') { const stored = saved.get(key(selectedChain)); for (const skipped of selected.steps?.slice(start, next === -1 ? undefined : next) ?? []) if (stored) delete stored[skipped.id]; }
    if (next !== -1) { command = selected; phase = 'step'; frames = [...history, { step: next, answers, tokens }]; clearTransient(); load(); publish(true); return; }
    if (selected.commands) { path = [...path, { command: selected, frames: history, answers, tokens }]; command = null; frames = []; phase = 'menu'; clearTransient(); publish(true); return; }
    command = selected; frames = history; finalAnswers = answers; finalTokens = tokens;
    const final = finalConfig();
    finalVisible = !!final && final.timing !== 'after' && (!final.when || evaluate(final.when, answers, selected));
    if (registry && finalVisible && final?.render) contextFor(selected);
    if (final && (final.timing === 'after' || finalVisible)) {
      phase = final.timing === 'after' ? 'running' : 'final'; clearTransient(); publish(true);
      if (final.timing === 'after') void execute();
    } else { phase = 'running'; clearTransient(); void execute(); }
  };
  const close = () => { if (!allowed('close')) return false; const closingContext = observedContext(); generation++; session = undefined; invocationContext = undefined; invocationCommand = undefined; rootRetired = false; path = []; command = null; frames = []; forward = []; saved.clear(); options = []; phase = 'menu'; finalAnswers = {}; abortTokens(); clearTransient(); closed = true; publish(true); if (!destroyed) { if (registry) config.callbacks?.onClose?.(snapshot, closingContext); else config.callbacks?.onClose?.(snapshot); } return true; };
  async function execute(execution?: { runtime: never }) {
    if (!allowed('execute') || running || !command || (phase !== 'final' && phase !== 'running')) return;
    const selected = command, answers = { ...finalAnswers }, final = finalConfig();
    const token = ++generation; let evaluatedAfter = false; invocationContext = undefined; running = true; status = 'loading'; error = null;
    try {
      publish();
      if (destroyed || token !== generation) return;
      const appliesBefore = !!final && final.timing !== 'after' && finalVisible;
      const origin = provenance.get(path[0]?.command ?? selected);
      if (origin && !origin.isValid()) throw new CommandUnavailableError(origin.qualifiedId);
      const provider = 'runtime' in input ? input.runtime : undefined;
      const supplied = execution && Object.prototype.hasOwnProperty.call(execution, 'runtime');
      if (supplied && session?.used && !Object.is(execution.runtime, session.runtime)) throw new Error('Cannot replace runtime after contextual decisions');
      let runtime: unknown = supplied ? execution.runtime : session?.state === 'ready' && session.used ? session.runtime : provider?.();
      if (runtime && typeof (runtime as PromiseLike<unknown>).then === 'function') runtime = await runtime;
      if (origin?.runtimeRequired && runtime === undefined) throw new Error('Runtime is required');
      if (destroyed || token !== generation) return;
      if (origin && !origin.isValid()) throw new CommandUnavailableError(origin.qualifiedId);
      invocationContext = origin ? withTokens({ shared: origin.shared, runtime }, selected) : undefined;
      invocationCommand = selected;
      if (registry && invocationContext) { publish(); if (destroyed || token !== generation) return; ensureOrigin(origin); }
      if (registry) config.callbacks?.onExecute?.(selected, answers, invocationContext); else config.callbacks?.onExecute?.(selected, answers);
      if (destroyed || token !== generation) return;
      if (origin && !origin.isValid()) throw new CommandUnavailableError(origin.qualifiedId);
      const value = origin ? await (selected.run as unknown as (answers: Answers, context: { shared: unknown; runtime: unknown }) => unknown)(answers, withTokens({ shared: origin.shared, runtime }, selected)) : tokensEnabled(selected) ? await selected.run!(answers, tokenContext(finalTokens)) : await selected.run!(answers);
      if (destroyed || token !== generation) return;
      running = false; status = 'success'; result = value; phase = 'final';
      if (origin && !origin.isValid()) { finalVisible = false; publish(); return; }
      let appliesAfter = appliesBefore;
      if (final?.timing === 'after') {
        ensureOrigin(origin); evaluatedAfter = true;
        appliesAfter = !final.when || (origin ? (final.when as (answers: Answers, context: CommandContext<unknown, unknown>) => boolean)(answers, invocationContext!) : final.when(answers));
        ensureOrigin(origin);
      }
      finalVisible = appliesAfter;
      const defaultClose = !appliesAfter || (final!.closeOnComplete ?? final!.timing === 'before');
      ensureOrigin(origin);
      const shouldClose = (registry ? config.strategies?.closeOnComplete?.(selected, answers, appliesAfter ? final : null, invocationContext) : config.strategies?.closeOnComplete?.(selected, answers, appliesAfter ? final : null)) ?? defaultClose;
      ensureOrigin(origin);
      if (destroyed || token !== generation) return;
      if (!shouldClose || !close()) publish();
    } catch (err) { if (!destroyed && token === generation) { running = false; status = 'error'; phase = 'final'; if (final?.timing === 'after') { try { const origin = originFor(selected); finalVisible = !evaluatedAfter && (!origin || origin.isValid()) && (!final.when || (origin && invocationContext ? (final.when as (answers: Answers, context: CommandContext<unknown, unknown>) => boolean)(answers, invocationContext) : !origin && final.when(answers))); } catch { finalVisible = false; } } report(err); publish(); } }
  }
  const back = () => {
    if (!allowed('back') || running || (!command && !path.length)) return;
    const selectedBehavior = behavior();
    if (selectedBehavior !== 'reset') forward.push({ path, command, frames, phase, answers: finalAnswers, tokens: finalTokens, status, result, error, finalVisible }); else forward = [];
    finalTokens = [];
    generation++; invocationContext = undefined; invocationCommand = undefined; clearTransient();
    if (phase === 'final' && command && frames.length) { if (selectedBehavior === 'reset') { const stored = saved.get(key(chain())); const last = currentFrame(); if (stored && last) for (const item of command.steps?.slice(last.step) ?? []) delete stored[item.id]; } phase = 'step'; finalAnswers = {}; finalTokens = []; load(); }
    else if (frames.length > 1 && command) {
      if (selectedBehavior === 'reset') { const stored = saved.get(key(chain())); for (const item of command.steps?.slice(currentFrame().step) ?? []) if (stored) delete stored[item.id]; }
      frames = frames.slice(0, -1); phase = 'step'; load();
    } else if (command) { if (selectedBehavior === 'reset') clearBranch(chain()); command = null; frames = []; phase = 'menu'; }
    else { const level = path[path.length - 1]; if (behavior() === 'reset') clearBranch(path.map(item => item.command)); path = path.slice(0, -1); if (level.frames.length) { command = level.command; frames = level.frames; phase = 'step'; load(); } }
    if (!command && !path.length && registry) rootRetired = true;
    publish(true);
  };
  const select = (index: number) => {
    if (!allowed('select') || loading || running || phase === 'final') return;
    const item = getItems()[index]; if (!item) return; forward = [];
    if (!command) {
      const selected = item as Command;
      if (registry && rootRetired && !path.length) {
        rootRetired = false; session = undefined; invocationContext = undefined; invocationCommand = undefined; cachedSource = undefined;
        if (menuNeedsContext() || needsContext(selected)) {
          const oldGeneration = generation, oldPath = path, oldQuery = query;
          if (!prepare(() => { if (generation === oldGeneration && path === oldPath && query === oldQuery && getItems()[index] === selected) select(index); }, originFor(selected))) { publish(); return; }
          cachedSource = undefined;
          if (getItems()[index] !== selected) { publish(); return; }
        }
      }
      if (registry && needsContext(selected) && session?.state !== 'ready') {
        const oldGeneration = generation, oldPath = path, oldQuery = query;
        if (!prepare(() => { if (generation === oldGeneration && path === oldPath && query === oldQuery && getItems()[index] === selected) select(index); }, originFor(selected))) { if (session?.state === 'preparing') publish(); return; }
      }
      try { ensureOrigin(originFor(selected)); command = selected; enter(selected, { ...path[path.length - 1]?.answers }, 0, [], capture(currentTokens())); }
      catch (err) { if (!registry) throw err; if (!destroyed && !closed) { command = null; report(err); publish(); } }
      return;
    }
    const step = currentStep(), frame = currentFrame(); if (!step || !frame) return;
    const selectedChain = chain(), currentKey = key(selectedChain), stored = saved.get(currentKey) ?? {}, option = item as Option;
    if (behavior() === 'smart' && stored[step.id] !== undefined && stored[step.id] !== option.value) { for (const later of command.steps?.slice(frame.step + 1) ?? []) delete stored[later.id]; for (const child of command.commands ?? []) clearBranch([...selectedChain, child]); }
    stored[step.id] = option.value; saved.set(currentKey, stored); try { enter(command, { ...frame.answers, [step.id]: option.value }, frame.step + 1, frames, capture(frame.tokens)); } catch (err) { if (!registry) throw err; if (!destroyed && !closed) { report(err); publish(); } }
  };
  const goForward = () => {
    if (!allowed('forward') || loading || running || error || !forward.length) return;
    const target = forward[forward.length - 1], step = currentStep(), frame = currentFrame();
    if (command && step && frame && phase === 'step') {
      const value = saved.get(key(chain()))?.[step.id]; if (value === undefined || !options.some(option => option.value === value)) return;
      const answers = { ...frame.answers, [step.id]: value }, next = command.steps?.findIndex((item, i) => i > frame.step && (!item.when || evaluate(item.when, answers, command!))) ?? -1;
      if (next !== -1) { const destination = target.frames[target.frames.length - 1]; if (target.command !== command || destination?.step !== next || JSON.stringify(destination.answers) !== JSON.stringify(answers)) return; }
      else if (target.phase === 'final' && target.command === command && JSON.stringify(target.answers) === JSON.stringify(answers)) { const final = finalConfig(); if (!final || (final.when && !evaluate(final.when, answers, command))) return; forward.pop(); phase = 'final'; finalAnswers = answers; finalTokens = target.tokens; clearTransient(); status = target.status; result = target.result; error = target.error; finalVisible = target.finalVisible; publish(true); return; }
      else { const destination = target.path[target.path.length - 1]; if (!command.commands || target.command || destination?.command !== command || JSON.stringify(destination.answers) !== JSON.stringify(answers)) return; }
      // Restore the tokens captured when this path was first walked.
      const restored = next !== -1 ? target.frames[target.frames.length - 1].tokens : target.path[target.path.length - 1].tokens;
      forward.pop(); clearTokens(); enter(command, answers, frame.step + 1, frames, restored); return;
    }
    if (!command) { const candidate = target.command ?? target.path[path.length]?.command; if (!candidate || !snapshot.items.includes(candidate)) return; const answers = { ...path[path.length - 1]?.answers }; if ((candidate.backBehavior ?? behavior()) === 'reset' || (!candidate.commands && !candidate.steps?.some(item => !item.when || evaluate(item.when, answers, candidate)))) return; const level = target.path.length > path.length && target.path[path.length].command === candidate ? target.path[path.length] : undefined; const restored = level?.tokens ?? (target.command === candidate ? target.frames[0]?.tokens : undefined); forward.pop(); rootRetired = false; command = candidate; if (restored) clearTokens(); enter(candidate, answers, 0, [], restored ?? capture(currentTokens())); }
  };
  const updateOptions: CommandEngine['setOptions'] = values => {
    if (destroyed) return;
    config = { ...config, ...values };
    if (values.commands && !provenance.has(path[0]?.command ?? command!)) {
      let candidates = values.commands;
      path = path.map(level => { const replacement = candidates.find(item => item.id === level.command.id) ?? level.command; candidates = replacement.commands ?? []; return replacement === level.command ? level : { ...level, command: replacement }; });
      if (command) { const replacement = candidates.find(item => item.id === command!.id); if (replacement) { command = replacement; const step = currentStep(); if (step && Array.isArray(step.options)) options = step.options; } }
    }
    if (query) refreshTokens();
    const next = makeSnapshot();
    const sameItems = next.items.length === snapshot.items.length && next.items.every((item, index) => { const old = snapshot.items[index]; return item.label === old.label && ('id' in item ? 'id' in old && item.id === old.id : 'value' in old && item.value === old.value); });
    const previousFinal = snapshot.finalStep, nextFinal = next.finalStep;
    const sameFinal = previousFinal === nextFinal || (!!previousFinal && !!nextFinal && previousFinal.timing === nextFinal.timing && previousFinal.closeOnComplete === nextFinal.closeOnComplete && previousFinal.render === nextFinal.render && JSON.stringify(previousFinal.fields) === JSON.stringify(nextFinal.fields));
    if ((values.commands && !command && !path.length) || !sameItems || !sameFinal || JSON.stringify(next.summary) !== JSON.stringify(snapshot.summary) || next.command?.label !== snapshot.command?.label || next.step?.label !== snapshot.step?.label || next.arrowNavigation !== snapshot.arrowNavigation || next.maxVisibleItems !== snapshot.maxVisibleItems || JSON.stringify(next.progress) !== JSON.stringify(snapshot.progress) || next.text !== snapshot.text || next.tokens.map(token => token.id).join() !== snapshot.tokens.map(token => token.id).join()) publish();
    if (values.tokens) {
      const resolverChanged = tokenResolve !== values.tokens.resolve, wasConfigured = tokenConfigured;
      tokenResolve = values.tokens.resolve; tokenConfigured = true;
      tokenTypes.reset(values.tokens.types ?? []); // no-op when the definitions are equivalent
      if (resolverChanged || !wasConfigured) { refreshTokens(); publish(); }
    }
  };
  const setOptions: CommandEngine['setOptions'] = values => {
    if (registry && 'commands' in values) throw new Error('Cannot set commands on a registry engine; use refreshRegistry()');
    updateOptions(values);
  };
  const engine: CommandEngine & { refreshRegistry: () => void } = { tokens: { register: tokenTypes.register, unregister: tokenTypes.unregister, setValues: tokenTypes.setValues, list: tokenTypes.list }, refreshRegistry: () => { if (!destroyed && !closed) { if (!command && !path.length) { generation++; session = undefined; loading = false; } updateOptions({ commands: readRegistry() }); if (!command && !path.length && menuNeedsContext() && session?.state !== 'ready') { prepare(); publish(); } } }, getSnapshot: () => snapshot, subscribe: listener => { if (destroyed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); }, setCommands: commands => setOptions({ commands }), setOptions, select, back, forward: () => { try { goForward(); } catch (err) { if (!registry) throw err; if (!destroyed && !closed) { report(err); publish(); } } }, setQuery: value => { if (!allowed('query') || query === value) return; query = value; active = 0; refreshTokens(); publish(); }, setActive: value => { if (!allowed('active')) return; const next = Math.max(0, Math.min(value, snapshot.items.length - 1)); if (next !== active) { active = next; publish(); } }, retry: () => { if (!allowed('retry')) return; if (session?.state === 'failed') { session = undefined; if (prepare()) publish(); } else if (phase === 'final') void execute(); else { load(); publish(); } }, execute, close, destroy: () => { if (destroyed) return; abortTokens(); generation++; session = undefined; invocationContext = undefined; invocationCommand = undefined; destroyed = true; let firstError: unknown; let failed = false; for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch (err) { if (!failed) firstError = err; failed = true; } } listeners.clear(); saved.clear(); if (failed) throw firstError; } };
  try { for (const plugin of config.plugins ?? []) { const cleanup = plugin.setup(engine); if (cleanup) cleanups.push(cleanup); } } catch (err) { try { engine.destroy(); } catch (cleanupError) { throw new Error(`Plugin setup failed (${String(err)}); cleanup also failed (${String(cleanupError)})`); } throw err; }
  if (menuNeedsContext()) { if (prepare()) publish(); }
  return engine as unknown as RegistryCommandEngine<never>;
}
