import type { Frame, Level, Position } from './engine-state.js';
import type { Answers, Command, CommandSettings, FinalStep, SummaryField, SummaryItem, WorkflowProgress } from './types.js';

export const key = (items: Command[]) => JSON.stringify(items.map(item => item.id));

export function clearSavedBranch(saved: Map<string, Answers>, items: Command[]): void {
  const prefix = items.map(item => item.id);
  for (const storedKey of saved.keys()) {
    const parts = JSON.parse(storedKey) as string[];
    if (prefix.every((id, i) => parts[i] === id)) saved.delete(storedKey);
  }
}

export function resolveSetting<K extends keyof CommandSettings>(chain: Command[], name: K, initial: CommandSettings[K]): CommandSettings[K] {
  return chain.reduce<CommandSettings[K]>((value, item) => item[name] === undefined ? value : item[name], initial);
}

export function resolveFinalConfig(initial: FinalStep | false | undefined, chain: Command[]): FinalStep | null {
  let value = initial;
  for (const item of chain) {
    if (item.finalStep === false) value = false;
    else if (item.finalStep !== undefined) value = { ...(value || {}), ...item.finalStep };
  }
  return value ? { timing: 'before', ...value } : null;
}

export function summarizeAnswers(chain: Command[], answers: Answers, final: FinalStep | null): SummaryItem[] {
  const labels = new Map<string, string>();
  for (const item of chain) for (const step of item.steps ?? []) labels.set(step.id, step.label);
  const fields: SummaryField[] = final?.fields ?? Object.keys(answers).map(id => ({ id }));
  return fields.filter(field => Object.prototype.hasOwnProperty.call(answers, field.id)).map(field => ({ id: field.id, label: field.label ?? labels.get(field.id) ?? field.id, value: answers[field.id] }));
}

export function calculateProgress(mode: CommandSettings['progress'], path: Level[], command: Command | null, frames: Frame[], phase: Position['phase']): WorkflowProgress | null {
    if (!mode || (!command && !path.length)) return null;
    const ancestors = mode === 'global' ? path.reduce((sum, item) => sum + item.frames.length + 1, 0) : 0;
    const current = ancestors + (command ? (mode === 'global' ? 1 : 0) + (phase === 'final' ? frames.length : Math.max(0, frames.length - 1)) : 0);
    let total: number | null = phase === 'final' ? current : null;
    const frame = frames[frames.length - 1];
    if (phase === 'step' && command && frame && !command.commands) { const remaining = command.steps?.slice(frame.step + 1) ?? []; if (!remaining.some(item => item.when)) total = current + 1 + remaining.length; }
    return { mode, current, total, percentage: total === null ? null : total === 0 ? 100 : Math.round(current / total * 100), indeterminate: total === null };
}
