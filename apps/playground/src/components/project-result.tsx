import type { FinalContext } from '@cmdly/react';

/**
 * Custom final step for "Open a project": a success title, the chosen values with readable labels
 * (answers only hold option values) and a Close button that receives focus when the step appears.
 */
export function ProjectResult({ context, rows }: { context: FinalContext; rows: { label: string; value: string }[] }) {
  return <section className="final-result" data-status={context.status}>
    {context.status === 'loading' && <p role="status">Opening project…</p>}
    {context.status === 'success' && <h2><span aria-hidden="true">✓</span> Project opened</h2>}
    {context.status === 'error' && <p role="alert">{context.error instanceof Error ? context.error.message : 'The project could not be opened.'}</p>}
    <dl>{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    <div className="final-actions">
      {context.status === 'error' && <button type="button" onClick={() => void context.execute()}>Retry</button>}
      <button type="button" className="primary" onClick={context.close}>Close</button>
    </div>
  </section>;
}
