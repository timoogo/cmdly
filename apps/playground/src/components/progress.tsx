import * as ProgressPrimitive from '@radix-ui/react-progress';
import type { WorkflowProgress } from '@cmdly/react';

// Based on the shadcn/ui Progress component, styled by the playground.
export function Progress({ value }: { value: number | null }) {
  return <ProgressPrimitive.Root className="progress-track" value={value} aria-label="Workflow progress">
    <ProgressPrimitive.Indicator className="progress-indicator" style={value === null ? undefined : { transform: `translateX(-${100 - value}%)` }} />
  </ProgressPrimitive.Root>;
}

/** Text and bar for `state.progress`; used by the default view (`renderProgress`) and the custom bubble. */
export function WorkflowProgressView({ progress }: { progress: WorkflowProgress }) {
  return <div className="workflow-progress">
    <div>{progress.indeterminate ? `${progress.current} completed · More steps ahead` : `${progress.current} of ${progress.total} completed · ${progress.percentage}%`}</div>
    <Progress value={progress.percentage} />
  </div>;
}
