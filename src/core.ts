export { createCommandRegistry } from './registry.js';
export type { CommandRegistry } from './registry.js';

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
export type Command = CommandBase & ({ commands: Command[]; run?: (answers: Answers) => unknown | Promise<unknown> } | { commands?: never; run: (answers: Answers) => unknown | Promise<unknown> });
type Frame = { step: number; answers: Answers };
type Level = { command: Command; frames: Frame[]; answers: Answers };
type Position = { path: Level[]; command: Command | null; frames: Frame[]; phase: 'menu' | 'step' | 'running' | 'final'; answers: Answers; status: FinalStatus; result: unknown; error: unknown; finalVisible: boolean };
export type EngineSnapshot = { phase: 'menu' | 'step' | 'running' | 'final'; command: Command | null; menuLabel: string; step: Step | undefined; answers: Answers; items: (Command | Option)[]; query: string; active: number; loading: boolean; running: boolean; error: unknown; loadFailed: boolean; progress: WorkflowProgress | null; finalStep: FinalStep | null; summary: SummaryItem[]; status: FinalStatus; result: unknown; arrowNavigation: boolean; maxVisibleItems: number; canBack: boolean; canForward: boolean; closed: boolean };
export type EngineCallbacks = { onNavigate?: (snapshot: EngineSnapshot) => void; onExecute?: (command: Command, answers: Answers) => void; onError?: (error: unknown, snapshot: EngineSnapshot) => void; onClose?: (snapshot: EngineSnapshot) => void };
export type EngineStrategies = { allowTransition?: (from: EngineSnapshot, action: string) => boolean; closeOnComplete?: (command: Command, answers: Answers, finalStep: FinalStep | null) => boolean };
export type EnginePlugin = { setup: (engine: CommandEngine) => void | (() => void) };
export type EngineOptions = { commands: Command[]; defaults?: CommandSettings; callbacks?: EngineCallbacks; strategies?: EngineStrategies; plugins?: EnginePlugin[] };
export type CommandEngine = { getSnapshot: () => EngineSnapshot; subscribe: (listener: () => void) => () => void; setCommands: (commands: Command[]) => void; setOptions: (options: Partial<Pick<EngineOptions, 'commands' | 'defaults' | 'callbacks' | 'strategies'>>) => void; select: (index: number) => void; back: () => void; forward: () => void; setQuery: (query: string) => void; setActive: (index: number) => void; retry: () => void; execute: () => Promise<void>; close: () => void; destroy: () => void };

/** Creates a framework-independent workflow store. Async operations are ignored after navigation or destruction. */
export function createCommandEngine(config: EngineOptions): CommandEngine {
  let path: Level[] = [], command: Command | null = null, frames: Frame[] = [];
  let phase: Position['phase'] = 'menu', finalAnswers: Answers = {}, query = '', active = 0;
  let options: Option[] = [], loading = false, running = false, error: unknown = null, loadFailed = false;
  let status: FinalStatus = 'idle', result: unknown = undefined, closed = false, destroyed = false, generation = 0, finalVisible = false;
  let forward: Position[] = [];
  const saved = new Map<string, Answers>(), listeners = new Set<() => void>(), cleanups: (() => void)[] = [];
  const chain = () => [...path.map(level => level.command), ...(command ? [command] : [])];
  const key = (items: Command[]) => JSON.stringify(items.map(item => item.id));
  const currentFrame = () => frames[frames.length - 1];
  const currentStep = () => command && currentFrame() ? command.steps?.[currentFrame().step] : undefined;
  const currentAnswers = () => (phase === 'final' || phase === 'running') ? finalAnswers : currentFrame()?.answers ?? path[path.length - 1]?.answers ?? {};
  const setting = <K extends keyof CommandSettings>(name: K): CommandSettings[K] => chain().reduce<CommandSettings[K]>((value, item) => item[name] === undefined ? value : item[name], config.defaults?.[name]);
  const behavior = () => setting('backBehavior') ?? 'smart';
  const clearBranch = (items: Command[]) => { const prefix = items.map(item => item.id); for (const storedKey of saved.keys()) { const parts = JSON.parse(storedKey) as string[]; if (prefix.every((id, i) => parts[i] === id)) saved.delete(storedKey); } };
  const finalConfig = (): FinalStep | null => {
    let value: FinalStep | false | undefined = config.defaults?.finalStep;
    for (const item of chain()) {
      if (item.finalStep === false) value = false;
      else if (item.finalStep !== undefined) value = { ...(value || {}), ...item.finalStep };
    }
    return value ? { timing: 'before', ...value } : null;
  };
  const buildSummary = (answers: Answers, final: FinalStep | null): SummaryItem[] => {
    const labels = new Map<string, string>();
    for (const item of chain()) for (const step of item.steps ?? []) labels.set(step.id, step.label);
    const fields: SummaryField[] = final?.fields ?? Object.keys(answers).map(id => ({ id }));
    return fields.filter(field => Object.prototype.hasOwnProperty.call(answers, field.id)).map(field => ({ id: field.id, label: field.label ?? labels.get(field.id) ?? field.id, value: answers[field.id] }));
  };
  let cachedSource: (Command | Option)[] | undefined, cachedPath: Level[] | undefined, cachedCommand: Command | null | undefined, cachedQuery: string | undefined, cachedPhase: Position['phase'] | undefined, cachedItems: (Command | Option)[] = [];
  const getItems = (): (Command | Option)[] => {
    if (phase === 'final' || phase === 'running') return [];
    const source = command ? options : path[path.length - 1]?.command.commands ?? config.commands;
    if (source === cachedSource && path === cachedPath && command === cachedCommand && query === cachedQuery && phase === cachedPhase) return cachedItems;
    const search = query.toLowerCase();
    cachedSource = source; cachedPath = path; cachedCommand = command; cachedQuery = query; cachedPhase = phase;
    cachedItems = source.filter(item => (!search || item.label.toLowerCase().includes(search)) && (command || (!path.some(level => level.command === item) && (!(item as Command).when || (item as Command).when!(currentAnswers())))));
    return cachedItems;
  };
  const getProgress = (): WorkflowProgress | null => {
    const mode = setting('progress'); if (!mode || (!command && !path.length)) return null;
    const ancestors = mode === 'global' ? path.reduce((sum, item) => sum + item.frames.length + 1, 0) : 0;
    const current = ancestors + (command ? (mode === 'global' ? 1 : 0) + (phase === 'final' ? frames.length : Math.max(0, frames.length - 1)) : 0);
    let total: number | null = phase === 'final' ? current : null;
    const frame = currentFrame();
    if (phase === 'step' && command && frame && !command.commands) { const remaining = command.steps?.slice(frame.step + 1) ?? []; if (!remaining.some(item => item.when)) total = current + 1 + remaining.length; }
    return { mode, current, total, percentage: total === null ? null : total === 0 ? 100 : Math.round(current / total * 100), indeterminate: total === null };
  };
  const makeSnapshot = (): EngineSnapshot => {
    const items = getItems(), final = phase === 'final' && finalVisible ? finalConfig() : null;
    const requested = setting('maxVisibleItems');
    return { phase, command, menuLabel: path[path.length - 1]?.command.label ?? 'Commands', step: currentStep(), answers: { ...currentAnswers() }, items, query, active: Math.min(active, Math.max(0, items.length - 1)), loading, running, error, loadFailed, progress: getProgress(), finalStep: final, summary: buildSummary(currentAnswers(), final), status, result, arrowNavigation: setting('arrowNavigation') ?? false, maxVisibleItems: typeof requested === 'number' && Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 50, canBack: !!command || path.length > 0, canForward: forward.length > 0, closed };
  };
  let snapshot = makeSnapshot();
  const publish = (navigate = false) => { if (destroyed) return; if (navigate && phase === 'menu' && behavior() === 'smart') { const ancestors = path.map(item => item.command); for (const child of path[path.length - 1]?.command.commands ?? config.commands) if (child.when && !child.when(currentAnswers())) clearBranch([...ancestors, child]); } snapshot = makeSnapshot(); let failure: unknown; let failed = false; for (const listener of [...listeners]) { try { listener(); } catch (err) { if (!failed) failure = err; failed = true; } } if (navigate) { try { config.callbacks?.onNavigate?.(snapshot); } catch (err) { if (!failed) failure = err; failed = true; } } if (failed) throw failure; };
  const allowed = (action: string) => !destroyed && !closed && (config.strategies?.allowTransition?.(snapshot, action) ?? true);
  const report = (err: unknown) => { error = err; try { config.callbacks?.onError?.(err, snapshot); } catch (callbackError) { error = new Error(`Workflow failed (${String(err)}); onError also failed (${String(callbackError)})`); } };
  const clearTransient = () => { query = ''; active = 0; error = null; loadFailed = false; loading = false; running = false; status = 'idle'; result = undefined; };
  const load = () => {
    const step = currentStep(), frame = currentFrame(), selected = command; if (!step || !frame || !selected) return;
    const token = ++generation, selectedChain = chain(), currentKey = key(selectedChain), selectedBehavior = behavior();
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
    Promise.resolve().then(() => (step.options as (answers: Answers) => Promise<Option[]>)({ ...frame.answers })).then(items => { if (!destroyed && generation === token) { accept(items); publish(); } }, err => { if (!destroyed && generation === token) { loading = false; loadFailed = true; report(err); publish(); } });
  };
  const enter = (selected: Command, answers: Answers, start: number, history: Frame[]) => {
    const next = selected.steps?.findIndex((step, i) => i >= start && (!step.when || step.when(answers))) ?? -1;
    const selectedChain = [...path.map(level => level.command), selected];
    if (behavior() === 'smart') { const stored = saved.get(key(selectedChain)); for (const skipped of selected.steps?.slice(start, next === -1 ? undefined : next) ?? []) if (stored) delete stored[skipped.id]; }
    if (next !== -1) { command = selected; phase = 'step'; frames = [...history, { step: next, answers }]; clearTransient(); load(); publish(true); return; }
    if (selected.commands) { path = [...path, { command: selected, frames: history, answers }]; command = null; frames = []; phase = 'menu'; clearTransient(); publish(true); return; }
    command = selected; frames = history; finalAnswers = answers;
    const final = finalConfig();
    finalVisible = !!final && final.timing !== 'after' && (!final.when || final.when(answers));
    if (final && (final.timing === 'after' || finalVisible)) {
      phase = final.timing === 'after' ? 'running' : 'final'; clearTransient(); publish(true);
      if (final.timing === 'after') void execute();
    } else { phase = 'running'; clearTransient(); void execute(); }
  };
  const close = () => { if (!allowed('close')) return false; generation++; path = []; command = null; frames = []; forward = []; saved.clear(); options = []; phase = 'menu'; finalAnswers = {}; clearTransient(); closed = true; publish(true); config.callbacks?.onClose?.(snapshot); return true; };
  async function execute() {
    if (!allowed('execute') || running || !command || (phase !== 'final' && phase !== 'running')) return;
    const selected = command, answers = { ...finalAnswers }, final = finalConfig();
    const token = ++generation; running = true; status = 'loading'; error = null;
    try {
      publish();
      if (destroyed || token !== generation) return;
      const appliesBefore = !!final && final.timing !== 'after' && finalVisible;
      config.callbacks?.onExecute?.(selected, answers);
      if (destroyed || token !== generation) return;
      const value = await selected.run!(answers);
      if (destroyed || token !== generation) return;
      running = false; status = 'success'; result = value; phase = 'final';
      const appliesAfter = !!final && (final.timing === 'after' ? (!final.when || final.when(answers)) : appliesBefore);
      finalVisible = appliesAfter;
      const defaultClose = !appliesAfter || (final!.closeOnComplete ?? final!.timing === 'before');
      const shouldClose = config.strategies?.closeOnComplete?.(selected, answers, appliesAfter ? final : null) ?? defaultClose;
      if (!shouldClose || !close()) publish();
    } catch (err) { if (!destroyed && token === generation) { running = false; status = 'error'; phase = 'final'; if (final?.timing === 'after') { try { finalVisible = !final.when || final.when(answers); } catch { finalVisible = false; } } report(err); publish(); } }
  }
  const back = () => {
    if (!allowed('back') || running || (!command && !path.length)) return;
    const selectedBehavior = behavior();
    if (selectedBehavior !== 'reset') forward.push({ path, command, frames, phase, answers: finalAnswers, status, result, error, finalVisible }); else forward = [];
    generation++; clearTransient();
    if (phase === 'final' && command && frames.length) { if (selectedBehavior === 'reset') { const stored = saved.get(key(chain())); const last = currentFrame(); if (stored && last) for (const item of command.steps?.slice(last.step) ?? []) delete stored[item.id]; } phase = 'step'; finalAnswers = {}; load(); }
    else if (frames.length > 1 && command) {
      if (selectedBehavior === 'reset') { const stored = saved.get(key(chain())); for (const item of command.steps?.slice(currentFrame().step) ?? []) if (stored) delete stored[item.id]; }
      frames = frames.slice(0, -1); phase = 'step'; load();
    } else if (command) { if (selectedBehavior === 'reset') clearBranch(chain()); command = null; frames = []; phase = 'menu'; }
    else { const level = path[path.length - 1]; if (behavior() === 'reset') clearBranch(path.map(item => item.command)); path = path.slice(0, -1); if (level.frames.length) { command = level.command; frames = level.frames; phase = 'step'; load(); } }
    publish(true);
  };
  const select = (index: number) => {
    if (!allowed('select') || loading || running || phase === 'final') return;
    const item = getItems()[index]; if (!item) return; forward = [];
    if (!command) { const selected = item as Command; command = selected; enter(selected, { ...path[path.length - 1]?.answers }, 0, []); return; }
    const step = currentStep(), frame = currentFrame(); if (!step || !frame) return;
    const selectedChain = chain(), currentKey = key(selectedChain), stored = saved.get(currentKey) ?? {}, option = item as Option;
    if (behavior() === 'smart' && stored[step.id] !== undefined && stored[step.id] !== option.value) { for (const later of command.steps?.slice(frame.step + 1) ?? []) delete stored[later.id]; for (const child of command.commands ?? []) clearBranch([...selectedChain, child]); }
    stored[step.id] = option.value; saved.set(currentKey, stored); enter(command, { ...frame.answers, [step.id]: option.value }, frame.step + 1, frames);
  };
  const goForward = () => {
    if (!allowed('forward') || loading || running || error || !forward.length) return;
    const target = forward[forward.length - 1], step = currentStep(), frame = currentFrame();
    if (command && step && frame && phase === 'step') {
      const value = saved.get(key(chain()))?.[step.id]; if (value === undefined || !options.some(option => option.value === value)) return;
      const answers = { ...frame.answers, [step.id]: value }, next = command.steps?.findIndex((item, i) => i > frame.step && (!item.when || item.when(answers))) ?? -1;
      if (next !== -1) { const destination = target.frames[target.frames.length - 1]; if (target.command !== command || destination?.step !== next || JSON.stringify(destination.answers) !== JSON.stringify(answers)) return; }
      else if (target.phase === 'final' && target.command === command && JSON.stringify(target.answers) === JSON.stringify(answers)) { const final = finalConfig(); if (!final || (final.when && !final.when(answers))) return; forward.pop(); phase = 'final'; finalAnswers = answers; clearTransient(); status = target.status; result = target.result; error = target.error; finalVisible = target.finalVisible; publish(true); return; }
      else { const destination = target.path[target.path.length - 1]; if (!command.commands || target.command || destination?.command !== command || JSON.stringify(destination.answers) !== JSON.stringify(answers)) return; }
      forward.pop(); enter(command, answers, frame.step + 1, frames); return;
    }
    if (!command) { const candidate = target.command ?? target.path[path.length]?.command; if (!candidate || !snapshot.items.includes(candidate)) return; const answers = { ...path[path.length - 1]?.answers }; if ((candidate.backBehavior ?? behavior()) === 'reset' || (!candidate.commands && !candidate.steps?.some(item => !item.when || item.when(answers)))) return; forward.pop(); command = candidate; enter(candidate, answers, 0, []); }
  };
  const setOptions: CommandEngine['setOptions'] = values => {
    if (destroyed) return;
    config = { ...config, ...values };
    if (values.commands) {
      let candidates = values.commands;
      path = path.map(level => { const replacement = candidates.find(item => item.id === level.command.id) ?? level.command; candidates = replacement.commands ?? []; return replacement === level.command ? level : { ...level, command: replacement }; });
      if (command) { const replacement = candidates.find(item => item.id === command!.id); if (replacement) { command = replacement; const step = currentStep(); if (step && Array.isArray(step.options)) options = step.options; } }
    }
    const next = makeSnapshot();
    const sameItems = next.items.length === snapshot.items.length && next.items.every((item, index) => { const old = snapshot.items[index]; return item.label === old.label && ('id' in item ? 'id' in old && item.id === old.id : 'value' in old && item.value === old.value); });
    const previousFinal = snapshot.finalStep, nextFinal = next.finalStep;
    const sameFinal = previousFinal === nextFinal || (!!previousFinal && !!nextFinal && previousFinal.timing === nextFinal.timing && previousFinal.closeOnComplete === nextFinal.closeOnComplete && previousFinal.render === nextFinal.render && JSON.stringify(previousFinal.fields) === JSON.stringify(nextFinal.fields));
    if (!sameItems || !sameFinal || JSON.stringify(next.summary) !== JSON.stringify(snapshot.summary) || next.command?.label !== snapshot.command?.label || next.step?.label !== snapshot.step?.label || next.arrowNavigation !== snapshot.arrowNavigation || next.maxVisibleItems !== snapshot.maxVisibleItems || JSON.stringify(next.progress) !== JSON.stringify(snapshot.progress)) publish();
  };
  const engine: CommandEngine = { getSnapshot: () => snapshot, subscribe: listener => { if (destroyed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); }, setCommands: commands => setOptions({ commands }), setOptions, select, back, forward: goForward, setQuery: value => { if (!allowed('query') || query === value) return; query = value; active = 0; publish(); }, setActive: value => { if (!allowed('active')) return; const next = Math.max(0, Math.min(value, snapshot.items.length - 1)); if (next !== active) { active = next; publish(); } }, retry: () => { if (!allowed('retry')) return; if (phase === 'final') void execute(); else { load(); publish(); } }, execute, close, destroy: () => { if (destroyed) return; generation++; destroyed = true; let firstError: unknown; let failed = false; for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch (err) { if (!failed) firstError = err; failed = true; } } listeners.clear(); saved.clear(); if (failed) throw firstError; } };
  try { for (const plugin of config.plugins ?? []) { const cleanup = plugin.setup(engine); if (cleanup) cleanups.push(cleanup); } } catch (err) { try { engine.destroy(); } catch (cleanupError) { throw new Error(`Plugin setup failed (${String(err)}); cleanup also failed (${String(cleanupError)})`); } throw err; }
  return engine;
}
