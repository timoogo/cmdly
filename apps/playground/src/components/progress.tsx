import * as ProgressPrimitive from '@radix-ui/react-progress';

// Based on the shadcn/ui Progress component, styled by the playground.
export function Progress({ value }: { value: number | null }) {
  return <ProgressPrimitive.Root className="progress-track" value={value} aria-label="Workflow progress">
    <ProgressPrimitive.Indicator className="progress-indicator" style={value === null ? undefined : { transform: `translateX(-${100 - value}%)` }} />
  </ProgressPrimitive.Root>;
}
