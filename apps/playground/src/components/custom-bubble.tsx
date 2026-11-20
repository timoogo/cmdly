import type { ReactNode } from 'react';
import { describeTokenIssue, type CommandBubbleTriggerProps, type CommandCombobox } from '@cmdly/react';
import { WorkflowProgressView } from './progress';

/** A custom trigger element: the bubble's props keep ARIA, keyboard and focus behaviour. */
export function PillTrigger(props: CommandBubbleTriggerProps) {
  return <button {...props} className="pill-trigger"><span aria-hidden="true">✦</span> Actions <kbd>⌘K</kbd></button>;
}

/** A custom content built from the headless state only; keyboard handling and announcements stay with the bubble. */
export function CompactContent({ command }: { command: CommandCombobox }) {
  const { state, actions, back, dismiss, inputProps, listboxProps, getOptionProps, visibleItems, listVisible, message, finalContext, tokens } = command;
  if (state.phase === 'final' && state.finalStep) {
    const confirmed = state.finalStep.timing === 'before' && state.status === 'success'; // kept open after success: a result
    return <div className="compact">
      {state.finalStep.render ? state.finalStep.render(finalContext) as ReactNode : <>
        <ul className="compact-summary">{state.summary.map(item => <li key={item.id}><span>{item.label}</span> {item.value}</li>)}</ul>
        {state.running && <p role="status">Working…</p>}
        {confirmed && <p role="status">Command completed.</p>}
        {message && <p role="alert">{message}</p>}
        <div className="compact-actions">
          {state.finalStep.timing === 'before' && !confirmed && <button type="button" onClick={() => void actions.execute()} aria-disabled={state.running || undefined}>{state.status === 'error' ? 'Retry' : 'Run'}</button>}
          <button type="button" onClick={dismiss}>Close</button>
        </div>
      </>}
      {state.progress && <WorkflowProgressView progress={state.progress} />}
    </div>;
  }
  return <div className="compact">
    <div className="compact-search">
      {state.canBack && <button type="button" onClick={back} aria-label="Back">←</button>}
      <input {...inputProps} aria-label={state.step?.label ?? 'Search actions'} placeholder={state.step?.label ?? 'Search actions…'} />
    </div>
    {tokens.bannerVisible && <div id={tokens.feedbackId} className="compact-feedback">{tokens.feedback.issues.map(token => <p key={token.id}>{describeTokenIssue(token)}</p>)}{tokens.feedback.pending.length > 0 && <p>Validating…</p>}</div>}
    {state.loading && <p role="status">Loading…</p>}
    {state.running && <p role="status">Working…</p>}
    {message && <p role="alert">{message} {state.loadFailed && <button type="button" onClick={actions.retry}>Retry</button>}</p>}
    {listVisible && <ul {...listboxProps} className="compact-list">
      {visibleItems.map(({ item, index }) => <li key={'id' in item ? item.id : item.value} {...getOptionProps(index)}>{item.label}</li>)}
    </ul>}
    {state.progress && <WorkflowProgressView progress={state.progress} />}
  </div>;
}
