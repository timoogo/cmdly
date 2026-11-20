import { useSyncExternalStore } from 'react';
import type { CommandEngine, CommandView, EngineSnapshot, RegistryCommandEngine, RegistryRuntime } from '@cmdly/core';

/** Subscribe to a headless engine from React. The caller owns the engine's lifetime. */
export function useCommandEngine<TRuntime, TRuntimeRequired extends boolean>(engine: RegistryCommandEngine<TRuntime, TRuntimeRequired>): { state: EngineSnapshot<CommandView, RegistryRuntime<TRuntime>>; actions: RegistryCommandEngine<TRuntime, TRuntimeRequired> };
export function useCommandEngine(engine: CommandEngine): { state: EngineSnapshot; actions: CommandEngine };
export function useCommandEngine(input: unknown): unknown {
  const engine = input as CommandEngine<CommandView>;
  return { state: useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot), actions: engine };
}
