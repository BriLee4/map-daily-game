// Wire protocol between browsers and the Party Durable Object.
import type { Position } from "./geo";

export type Phase = "lobby" | "question" | "heatmap" | "reveal" | "final";

export interface GameSettings {
  mode: "random" | "custom";
  /** ISO-ish country ids (Natural Earth ADM0_A3), one per round, in order */
  countryIds: string[];
  timerSeconds: number;
}

export const LIMITS = {
  minRounds: 1,
  maxRounds: 30,
  minTimer: 10,
  maxTimer: 180,
  maxPlayers: 60,
  maxNameLength: 20,
} as const;

export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  /** true once the player has a guess for the current round (question phase only) */
  answered: boolean;
  locked: boolean;
}

export interface RoundResult {
  playerId: string;
  name: string;
  guess: Position;
  km: number;
  score: number;
}

export interface PublicState {
  code: string;
  phase: Phase;
  locked: boolean;
  roundIndex: number; // 0-based; -1 in lobby
  totalRounds: number;
  timerSeconds: number;
  /** epoch ms when the current question closes (question phase) */
  endsAt: number | null;
  serverNow: number;
  /** only the name is sent before reveal so the answer id is not exposed early */
  country: { name: string } | null;
  players: PublicPlayer[];
  /** anonymous guess points, sent from heatmap phase on */
  heat: Position[] | null;
  /**
   * Sent on reveal. The client already has every country's shape (countries.json), so only the id
   * is sent. Per-player results are only sent to the host (students just see their own result).
   */
  reveal: {
    countryId: string;
    results: RoundResult[];
  } | null;
}

export interface YouState {
  id: string;
  name: string;
  score: number;
  guess: Position | null;
  locked: boolean;
  last: { km: number; score: number; nearest: Position } | null;
  rank: number;
}

// ---- client -> server ----
export type ClientMessage =
  | { t: "join"; name: string }
  | { t: "guess"; lng: number; lat: number }
  | { t: "lock" }
  // host only
  | { t: "start" }
  | { t: "endRound" }
  | { t: "reveal" }
  | { t: "next" }
  | { t: "kick"; playerId: string }
  | { t: "setLocked"; locked: boolean }
  | { t: "finish" };

// ---- server -> client ----
export type ServerMessage =
  | { t: "state"; state: PublicState; you: YouState | null; role: "host" | "player" }
  | { t: "needName" }
  | { t: "error"; message: string }
  /** connection refused for good (room locked, game over); the client should stop reconnecting */
  | { t: "rejected"; message: string }
  | { t: "kicked" };
