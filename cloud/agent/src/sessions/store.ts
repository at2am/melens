import { randomBytes } from 'node:crypto';

import type { Question, SessionSummary, StoredTurn } from '../protocol/schemas.js';

export const SESSION_LIMITS = {
  sessionsPerUser: 50,
  turnsPerSession: 200,
  ttlMs: 30 * 24 * 60 * 60 * 1_000,
  /** A turn lease outlives the Cloud Run request timeout by a margin, so a crashed turn frees the session. */
  leaseMs: 330_000,
  /** The prompt carries this many recent turns; older turns stay stored for the app. */
  promptTurns: 20,
} as const;

export interface SessionRecord extends SessionSummary {
  readonly uid: string;
  readonly pendingQuestion: Question | null;
  readonly activeTurn: { readonly turnId: string; readonly expiresAt: string } | null;
  readonly expiresAt: string;
}

export type LeaseResult = 'acquired' | 'busy' | 'missing';

/** Per-user chat sessions and their turns. Only the agent service reaches the store. */
export interface SessionStore {
  create(uid: string, now: Date): Promise<SessionRecord>;
  list(uid: string): Promise<SessionSummary[]>;
  get(uid: string, sessionId: string): Promise<SessionRecord | null>;
  delete(uid: string, sessionId: string): Promise<boolean>;
  /** Turns in `seq` order; `limit` keeps the most recent ones. */
  listTurns(uid: string, sessionId: string, limit?: number): Promise<StoredTurn[]>;
  /** One turn at a time per session: a second concurrent turn is rejected, an expired lease is taken over. */
  acquireTurn(uid: string, sessionId: string, turnId: string, now: Date): Promise<LeaseResult>;
  /** Stores the finished turn, advances the session and clears the lease. */
  completeTurn(uid: string, sessionId: string, turn: StoredTurn, now: Date): Promise<void>;
  /** Clears the lease of a turn that produced nothing to store. */
  releaseTurn(uid: string, sessionId: string, turnId: string): Promise<void>;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export function sessionTitle(firstMessage: string): string {
  const trimmed = firstMessage.replace(/\s+/g, ' ').trim();
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 79)}…`;
}

export function summaryOf(record: SessionRecord): SessionSummary {
  return { id: record.id, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt, turnCount: record.turnCount };
}

/** Development and test store; a Cloud Run instance never uses it for real users. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Map<string, { record: SessionRecord; turns: StoredTurn[] }>>();

  private user(uid: string) {
    let sessions = this.sessions.get(uid);
    if (sessions === undefined) { sessions = new Map(); this.sessions.set(uid, sessions); }
    return sessions;
  }

  async create(uid: string, now: Date): Promise<SessionRecord> {
    const sessions = this.user(uid);
    const stamp = now.toISOString();
    const record: SessionRecord = { id: newId('s'), uid, title: '', createdAt: stamp, updatedAt: stamp, turnCount: 0,
      pendingQuestion: null, activeTurn: null, expiresAt: new Date(now.getTime() + SESSION_LIMITS.ttlMs).toISOString() };
    sessions.set(record.id, { record, turns: [] });
    // Oldest sessions go first once a user exceeds the limit.
    const ordered = [...sessions.values()].sort((a, b) => a.record.updatedAt.localeCompare(b.record.updatedAt) || a.record.createdAt.localeCompare(b.record.createdAt));
    while (ordered.length > SESSION_LIMITS.sessionsPerUser) sessions.delete(ordered.shift()!.record.id);
    return record;
  }

  async list(uid: string): Promise<SessionSummary[]> {
    return [...this.user(uid).values()].map((entry) => summaryOf(entry.record))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
  }

  async get(uid: string, sessionId: string): Promise<SessionRecord | null> {
    return this.user(uid).get(sessionId)?.record ?? null;
  }

  async delete(uid: string, sessionId: string): Promise<boolean> {
    return this.user(uid).delete(sessionId);
  }

  async listTurns(uid: string, sessionId: string, limit?: number): Promise<StoredTurn[]> {
    const turns = this.user(uid).get(sessionId)?.turns ?? [];
    return limit === undefined ? [...turns] : turns.slice(Math.max(0, turns.length - limit));
  }

  async acquireTurn(uid: string, sessionId: string, turnId: string, now: Date): Promise<LeaseResult> {
    const entry = this.user(uid).get(sessionId);
    if (entry === undefined) return 'missing';
    const active = entry.record.activeTurn;
    if (active !== null && active.expiresAt > now.toISOString()) return 'busy';
    entry.record = { ...entry.record, activeTurn: { turnId, expiresAt: new Date(now.getTime() + SESSION_LIMITS.leaseMs).toISOString() } };
    return 'acquired';
  }

  async completeTurn(uid: string, sessionId: string, turn: StoredTurn, now: Date): Promise<void> {
    const entry = this.user(uid).get(sessionId);
    if (entry === undefined) return;
    entry.turns.push(turn);
    while (entry.turns.length > SESSION_LIMITS.turnsPerSession) entry.turns.shift();
    const stamp = now.toISOString();
    entry.record = { ...entry.record,
      title: entry.record.title === '' && turn.input.kind === 'text' ? sessionTitle(turn.input.text) : entry.record.title,
      turnCount: entry.record.turnCount + 1, updatedAt: stamp, pendingQuestion: turn.question, activeTurn: null,
      expiresAt: new Date(now.getTime() + SESSION_LIMITS.ttlMs).toISOString() };
  }

  async releaseTurn(uid: string, sessionId: string, turnId: string): Promise<void> {
    const entry = this.user(uid).get(sessionId);
    if (entry === undefined || entry.record.activeTurn?.turnId !== turnId) return;
    entry.record = { ...entry.record, activeTurn: null };
  }
}
