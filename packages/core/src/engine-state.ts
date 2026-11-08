import type { Answers, Command, FinalStatus } from './types.js';

export type Frame = { step: number; answers: Answers };
export type Level = { command: Command; frames: Frame[]; answers: Answers };
export type Position = { path: Level[]; command: Command | null; frames: Frame[]; phase: 'menu' | 'step' | 'running' | 'final'; answers: Answers; status: FinalStatus; result: unknown; error: unknown; finalVisible: boolean };
