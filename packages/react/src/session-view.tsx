import type { ReactNode } from 'react';
import type { CommandView, ResolvedTagDefinition, TagDefinition, WorkflowProgress } from '@cmdly/core';
import type { CommandCombobox } from './combobox.js';
import { describeTokenIssue } from './token-feedback.js';

export type CommandSessionViewProps = {
  combobox: CommandCombobox;
  renderProgress?: (progress: WorkflowProgress) => ReactNode;
  renderTag?: (tag: string, definition: ResolvedTagDefinition, command: CommandView) => ReactNode;
};

const visuallyHidden = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 } as const;

/** Internal. Default, unstyled rendering of a session: search/step combobox, final phase, token feedback and progress. */
export function CommandSessionView({ combobox, renderProgress, renderTag }: CommandSessionViewProps) {
  const { state, actions, back, dismiss, inputProps, listboxProps, getOptionProps, listVisible, visibleItems, message, finalContext, tokens } = combobox;
  const CustomFeedback = typeof tokens.mode === 'function' ? tokens.mode : undefined;
  const tokenView = <>
    {tokens.builtIn && tokens.showFeedback && <span data-cmdly-token-announcer role="status" aria-live="polite" style={visuallyHidden}>{tokens.announcement}</span>}
    {tokens.bannerVisible && <div id={tokens.feedbackId} data-cmdly-token-feedback="banner" data-status={tokens.feedback.status}>
      {tokens.feedback.issues.map(token => <p key={token.id} data-status={token.status}>{describeTokenIssue(token)}</p>)}
      {tokens.feedback.pending.length > 0 && <p data-status="pending">Validating…</p>}
    </div>}
    {tokens.busy && <div data-cmdly-token-feedback="loader" data-status="pending">Validating…</div>}
    {CustomFeedback && tokens.showFeedback && <CustomFeedback feedback={tokens.feedback} tokens={state.tokens} />}
  </>;
  return <>
    {state.phase === 'final' && state.finalStep ? <>
      {state.finalStep.render ? state.finalStep.render(finalContext) as ReactNode : <>
        <dl>{state.summary.map(item => <div key={item.id}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
        {state.status === 'loading' && <p role="status">Running command…</p>}
        {message && <div role="alert">{message}</div>}
        {state.canBack && <button type="button" onClick={back} aria-disabled={state.running || undefined}>Back</button>}
        {state.finalStep.timing === 'before' && <button type="button" onClick={() => void actions.execute()} aria-disabled={state.running || undefined}>{state.status === 'error' ? 'Retry' : 'Confirm'}</button>}
        {state.finalStep.timing === 'after' && state.status === 'error' && <button type="button" onClick={() => void actions.execute()}>Retry</button>}
        <button type="button" onClick={dismiss}>Cancel</button>
      </>}
    </> : <>
      <label>{state.step?.label ?? (state.canBack ? state.menuLabel : 'Search commands')}<input {...inputProps} /></label>
      {state.canBack && <button type="button" onClick={back} aria-disabled={state.running || undefined}>Back</button>}
      <button type="button" onClick={dismiss}>Cancel</button>
      {state.loading && <p role="status">Loading options…</p>}
      {state.running && <p role="status">Running command…</p>}
      {message && <div role="alert">{message}{(state.loadFailed || (state.phase === "final" && state.status === "error")) && <button type="button" onClick={actions.retry}>Retry</button>}</div>}
      {listVisible && <ul {...listboxProps}>{visibleItems.map(({ item, index }) => <li key={'id' in item ? item.id : item.value} {...getOptionProps(index)}>{item.label}{renderTag && 'id' in item && (item as CommandView).tags?.map(tag => { const def: ResolvedTagDefinition = { key: tag, ...((item as CommandView & { tagOverrides?: Record<string, Partial<TagDefinition>> }).tagOverrides?.[tag] ?? {}) }; return <span key={tag}>{renderTag(tag, def, item as CommandView)}</span>; })}</li>)}</ul>}
    </>}
    {tokenView}
    {state.progress && renderProgress?.(state.progress)}
  </>;
}
