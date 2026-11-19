import type { Answers, Command, FinalStatus, Token } from './types.js';

/**
 * Live state of one recognized token. `token` is replaced (never mutated) when validation settles.
 * `done` resolves once the token is no longer pending (settled or aborted).
 */
export type TokenCell = { key: string; source: unknown; token: Token; controller: AbortController; done: Promise<void>; settle: () => void; captured: boolean; dead: boolean };

export type Frame = { step: number; answers: Answers; tokens: TokenCell[] };
export type Level = { command: Command; frames: Frame[]; answers: Answers; tokens: TokenCell[] };
export type Position = { path: Level[]; command: Command | null; frames: Frame[]; phase: 'menu' | 'step' | 'running' | 'final'; answers: Answers; tokens: TokenCell[]; status: FinalStatus; result: unknown; error: unknown; finalVisible: boolean };
