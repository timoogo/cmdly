import type { Frame, Level, Position } from './engine-state.js';
import { key, clearSavedBranch, resolveSetting, resolveFinalConfig, summarizeAnswers, calculateProgress } from './workflow.js';
import { CommandUnavailableError } from './errors.js';
import type { Answers, Option, Step, ProgressMode, WorkflowProgress, BackBehavior, FinalStatus, SummaryField, SummaryItem, FinalContext, FinalStep, CommandSettings, CommandContext, ContextualStep, ContextualFinalStep, ContextualCommand, Command, StepView, CommandView, EngineSnapshot, EngineCallbacks, EngineStrategies, EnginePlugin, EngineOptions, RegistryRuntime, RequiredRuntime, RegistryEngineOptions, CommandEngine, RegistryCommandEngine, ResolvedCommand, CommandRegistry } from './types.js';
export type { Answers, Option, Step, ProgressMode, WorkflowProgress, BackBehavior, FinalStatus, SummaryField, SummaryItem, FinalContext, FinalStep, CommandSettings, CommandContext, ContextualStep, ContextualFinalStep, ContextualCommand, Command, StepView, CommandView, EngineSnapshot, EngineCallbacks, EngineStrategies, EnginePlugin, EngineOptions, RegistryRuntime, RequiredRuntime, RegistryEngineOptions, CommandEngine, RegistryCommandEngine, ResolvedCommand, CommandRegistry } from './types.js';
export { createCommandRegistry } from './registry.js';

export { CommandUnavailableError } from './errors.js';
/** Creates a framework-independent workflow store. Async operations are ignored after navigation or destruction. */
export function createCommandEngine<TShared, TRuntime, TRuntimeRequired extends boolean>(input: RegistryEngineOptions<TShared, TRuntime, TRuntimeRequired>): RegistryCommandEngine<TRuntime, TRuntimeRequired>;
export function createCommandEngine(input?: EngineOptions): CommandEngine;
export function createCommandEngine(inputValue: unknown = { commands: [] }): unknown {
  const input = inputValue as EngineOptions | RegistryEngineOptions<never, never>;
  if ('registry' in input && input.registry && 'commands' in input) throw new Error('Provide commands or registry, not both');
  const registry = 'registry' in input ? input.registry : undefined;
  const provenance = new WeakMap<Command, ResolvedCommand<never>>();
  const readRegistry = (): Command[] => {
    if (!registry) throw new Error('Engine has no registry');
    const resolved = registry.list().map(item => {
      const entry = registry.resolve(item.id);
      if (!entry || !entry.isValid()) throw new Error(`Registry changed while reading: ${item.id}`);
      return entry;
    });
    if (resolved.some(entry => !entry.isValid())) throw new Error('Registry changed while reading');
    for (const entry of resolved) provenance.set(entry.command as unknown as Command, entry);
    return resolved.map(entry => entry.command as unknown as Command);
  };
  let config: EngineOptions = { ...(input as unknown as EngineOptions), commands: registry ? readRegistry() : (input as EngineOptions).commands };

  let path: Level[] = [], command: Command | null = null, frames: Frame[] = [];
  let phase: Position['phase'] = 'menu', finalAnswers: Answers = {}, query = '', active = 0;
  let options: Option[] = [], loading = false, running = false, error: unknown = null, loadFailed = false;
  let status: FinalStatus = 'idle', result: unknown = undefined, closed = false, destroyed = false, generation = 0, finalVisible = false;
  let forward: Position[] = [];
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
    session.used = true; return { shared: origin.shared, runtime: session.runtime };
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
    return { shared: origin.shared, runtime: session.runtime };
  };
  const menuNeedsContext = () => !!registry && (path[path.length - 1]?.command.commands ?? config.commands).some(item => !!item.when);

  const saved = new Map<string, Answers>(), listeners = new Set<() => void>(), cleanups: (() => void)[] = [];
  const chain = () => [...path.map(level => level.command), ...(command ? [command] : [])];
  const currentFrame = () => frames[frames.length - 1];
  const currentStep = () => command && currentFrame() ? command.steps?.[currentFrame().step] : undefined;
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
    if (source === cachedSource && path === cachedPath && command === cachedCommand && query === cachedQuery && phase === cachedPhase) return cachedItems;
    const search = query.toLowerCase();
    cachedSource = source; cachedPath = path; cachedCommand = command; cachedQuery = query; cachedPhase = phase;
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
    return { context: capturedContext, phase, command, menuLabel: path[path.length - 1]?.command.label ?? 'Commands', step: currentStep(), answers: { ...currentAnswers() }, items, query, active: Math.min(active, Math.max(0, items.length - 1)), loading, running, error, loadFailed, progress: getProgress(), finalStep: final, summary: buildSummary(currentAnswers(), final), status, result, arrowNavigation: setting('arrowNavigation') ?? false, maxVisibleItems: typeof requested === 'number' && Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 50, canBack: !!command || path.length > 0, canForward: forward.length > 0, closed };
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
  const clearTransient = () => { reportedVisibilityErrors = new WeakMap(); query = ''; active = 0; error = null; loadFailed = false; loading = false; running = false; status = 'idle'; result = undefined; };
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
  const enter = (selected: Command, answers: Answers, start: number, history: Frame[]) => {
    const next = selected.steps?.findIndex((step, i) => i >= start && (!step.when || evaluate(step.when, answers, selected))) ?? -1;
    const selectedChain = [...path.map(level => level.command), selected];
    if (behavior() === 'smart') { const stored = saved.get(key(selectedChain)); for (const skipped of selected.steps?.slice(start, next === -1 ? undefined : next) ?? []) if (stored) delete stored[skipped.id]; }
    if (next !== -1) { command = selected; phase = 'step'; frames = [...history, { step: next, answers }]; clearTransient(); load(); publish(true); return; }
    if (selected.commands) { path = [...path, { command: selected, frames: history, answers }]; command = null; frames = []; phase = 'menu'; clearTransient(); publish(true); return; }
    command = selected; frames = history; finalAnswers = answers;
    const final = finalConfig();
    finalVisible = !!final && final.timing !== 'after' && (!final.when || evaluate(final.when, answers, selected));
    if (registry && finalVisible && final?.render) contextFor(selected);
    if (final && (final.timing === 'after' || finalVisible)) {
      phase = final.timing === 'after' ? 'running' : 'final'; clearTransient(); publish(true);
      if (final.timing === 'after') void execute();
    } else { phase = 'running'; clearTransient(); void execute(); }
  };
  const close = () => { if (!allowed('close')) return false; const closingContext = observedContext(); generation++; session = undefined; invocationContext = undefined; invocationCommand = undefined; rootRetired = false; path = []; command = null; frames = []; forward = []; saved.clear(); options = []; phase = 'menu'; finalAnswers = {}; clearTransient(); closed = true; publish(true); if (!destroyed) { if (registry) config.callbacks?.onClose?.(snapshot, closingContext); else config.callbacks?.onClose?.(snapshot); } return true; };
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
      invocationContext = origin ? { shared: origin.shared, runtime } : undefined;
      invocationCommand = selected;
      if (registry && invocationContext) { publish(); if (destroyed || token !== generation) return; ensureOrigin(origin); }
      if (registry) config.callbacks?.onExecute?.(selected, answers, invocationContext); else config.callbacks?.onExecute?.(selected, answers);
      if (destroyed || token !== generation) return;
      if (origin && !origin.isValid()) throw new CommandUnavailableError(origin.qualifiedId);
      const value = origin ? await (selected.run as unknown as (answers: Answers, context: { shared: unknown; runtime: unknown }) => unknown)(answers, { shared: origin.shared, runtime }) : await selected.run!(answers);
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
    if (selectedBehavior !== 'reset') forward.push({ path, command, frames, phase, answers: finalAnswers, status, result, error, finalVisible }); else forward = [];
    generation++; invocationContext = undefined; invocationCommand = undefined; clearTransient();
    if (phase === 'final' && command && frames.length) { if (selectedBehavior === 'reset') { const stored = saved.get(key(chain())); const last = currentFrame(); if (stored && last) for (const item of command.steps?.slice(last.step) ?? []) delete stored[item.id]; } phase = 'step'; finalAnswers = {}; load(); }
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
      try { ensureOrigin(originFor(selected)); command = selected; enter(selected, { ...path[path.length - 1]?.answers }, 0, []); }
      catch (err) { if (!registry) throw err; if (!destroyed && !closed) { command = null; report(err); publish(); } }
      return;
    }
    const step = currentStep(), frame = currentFrame(); if (!step || !frame) return;
    const selectedChain = chain(), currentKey = key(selectedChain), stored = saved.get(currentKey) ?? {}, option = item as Option;
    if (behavior() === 'smart' && stored[step.id] !== undefined && stored[step.id] !== option.value) { for (const later of command.steps?.slice(frame.step + 1) ?? []) delete stored[later.id]; for (const child of command.commands ?? []) clearBranch([...selectedChain, child]); }
    stored[step.id] = option.value; saved.set(currentKey, stored); try { enter(command, { ...frame.answers, [step.id]: option.value }, frame.step + 1, frames); } catch (err) { if (!registry) throw err; if (!destroyed && !closed) { report(err); publish(); } }
  };
  const goForward = () => {
    if (!allowed('forward') || loading || running || error || !forward.length) return;
    const target = forward[forward.length - 1], step = currentStep(), frame = currentFrame();
    if (command && step && frame && phase === 'step') {
      const value = saved.get(key(chain()))?.[step.id]; if (value === undefined || !options.some(option => option.value === value)) return;
      const answers = { ...frame.answers, [step.id]: value }, next = command.steps?.findIndex((item, i) => i > frame.step && (!item.when || evaluate(item.when, answers, command!))) ?? -1;
      if (next !== -1) { const destination = target.frames[target.frames.length - 1]; if (target.command !== command || destination?.step !== next || JSON.stringify(destination.answers) !== JSON.stringify(answers)) return; }
      else if (target.phase === 'final' && target.command === command && JSON.stringify(target.answers) === JSON.stringify(answers)) { const final = finalConfig(); if (!final || (final.when && !evaluate(final.when, answers, command))) return; forward.pop(); phase = 'final'; finalAnswers = answers; clearTransient(); status = target.status; result = target.result; error = target.error; finalVisible = target.finalVisible; publish(true); return; }
      else { const destination = target.path[target.path.length - 1]; if (!command.commands || target.command || destination?.command !== command || JSON.stringify(destination.answers) !== JSON.stringify(answers)) return; }
      forward.pop(); enter(command, answers, frame.step + 1, frames); return;
    }
    if (!command) { const candidate = target.command ?? target.path[path.length]?.command; if (!candidate || !snapshot.items.includes(candidate)) return; const answers = { ...path[path.length - 1]?.answers }; if ((candidate.backBehavior ?? behavior()) === 'reset' || (!candidate.commands && !candidate.steps?.some(item => !item.when || evaluate(item.when, answers, candidate)))) return; forward.pop(); rootRetired = false; command = candidate; enter(candidate, answers, 0, []); }
  };
  const updateOptions: CommandEngine['setOptions'] = values => {
    if (destroyed) return;
    config = { ...config, ...values };
    if (values.commands && !provenance.has(path[0]?.command ?? command!)) {
      let candidates = values.commands;
      path = path.map(level => { const replacement = candidates.find(item => item.id === level.command.id) ?? level.command; candidates = replacement.commands ?? []; return replacement === level.command ? level : { ...level, command: replacement }; });
      if (command) { const replacement = candidates.find(item => item.id === command!.id); if (replacement) { command = replacement; const step = currentStep(); if (step && Array.isArray(step.options)) options = step.options; } }
    }
    const next = makeSnapshot();
    const sameItems = next.items.length === snapshot.items.length && next.items.every((item, index) => { const old = snapshot.items[index]; return item.label === old.label && ('id' in item ? 'id' in old && item.id === old.id : 'value' in old && item.value === old.value); });
    const previousFinal = snapshot.finalStep, nextFinal = next.finalStep;
    const sameFinal = previousFinal === nextFinal || (!!previousFinal && !!nextFinal && previousFinal.timing === nextFinal.timing && previousFinal.closeOnComplete === nextFinal.closeOnComplete && previousFinal.render === nextFinal.render && JSON.stringify(previousFinal.fields) === JSON.stringify(nextFinal.fields));
    if ((values.commands && !command && !path.length) || !sameItems || !sameFinal || JSON.stringify(next.summary) !== JSON.stringify(snapshot.summary) || next.command?.label !== snapshot.command?.label || next.step?.label !== snapshot.step?.label || next.arrowNavigation !== snapshot.arrowNavigation || next.maxVisibleItems !== snapshot.maxVisibleItems || JSON.stringify(next.progress) !== JSON.stringify(snapshot.progress)) publish();
  };
  const setOptions: CommandEngine['setOptions'] = values => {
    if (registry && 'commands' in values) throw new Error('Cannot set commands on a registry engine; use refreshRegistry()');
    updateOptions(values);
  };
  const engine: CommandEngine & { refreshRegistry: () => void } = { refreshRegistry: () => { if (!destroyed && !closed) { if (!command && !path.length) { generation++; session = undefined; loading = false; } updateOptions({ commands: readRegistry() }); if (!command && !path.length && menuNeedsContext() && session?.state !== 'ready') { prepare(); publish(); } } }, getSnapshot: () => snapshot, subscribe: listener => { if (destroyed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); }, setCommands: commands => setOptions({ commands }), setOptions, select, back, forward: () => { try { goForward(); } catch (err) { if (!registry) throw err; if (!destroyed && !closed) { report(err); publish(); } } }, setQuery: value => { if (!allowed('query') || query === value) return; query = value; active = 0; publish(); }, setActive: value => { if (!allowed('active')) return; const next = Math.max(0, Math.min(value, snapshot.items.length - 1)); if (next !== active) { active = next; publish(); } }, retry: () => { if (!allowed('retry')) return; if (session?.state === 'failed') { session = undefined; if (prepare()) publish(); } else if (phase === 'final') void execute(); else { load(); publish(); } }, execute, close, destroy: () => { if (destroyed) return; generation++; session = undefined; invocationContext = undefined; invocationCommand = undefined; destroyed = true; let firstError: unknown; let failed = false; for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch (err) { if (!failed) firstError = err; failed = true; } } listeners.clear(); saved.clear(); if (failed) throw firstError; } };
  try { for (const plugin of config.plugins ?? []) { const cleanup = plugin.setup(engine); if (cleanup) cleanups.push(cleanup); } } catch (err) { try { engine.destroy(); } catch (cleanupError) { throw new Error(`Plugin setup failed (${String(err)}); cleanup also failed (${String(cleanupError)})`); } throw err; }
  if (menuNeedsContext()) { if (prepare()) publish(); }
  return engine as unknown as RegistryCommandEngine<never>;
}
