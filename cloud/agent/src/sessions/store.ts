import { randomBytes } from 'node:crypto';

import type { TurnImage } from '../protocol/attachments.js';
import type { Question, SessionSummary, StoredTurn } from '../protocol/schemas.js';

export const SESSION_LIMITS = {
  sessionsPerUser: 50,
  turnsPerSession: 200,
  ttlMs: 30 * 24 * 60 * 60 * 1_000,
  /** A turn lease outlives the Cloud Run request timeout by a margin, so a crashed turn frees the session. */
  leaseMs: 330_000,
  /** The prompt carries this many recent turns; older turns stay stored for the app. */
  promptTurns: 20,
  /** The photos of this many most recent turns go back to the model; older photos are only named. */
  promptImageTurns: 3,
} as const;

/** The running turn's lease; `cancelRequested` asks it to stop (the stop button, or a newer message). */
export interface ActiveTurn {
  readonly turnId: string;
  readonly expiresAt: string;
  readonly cancelRequested?: boolean;
}

export interface SessionRecord extends SessionSummary {
  readonly uid: string;
  readonly pendingQuestion: Question | null;
  readonly activeTurn: ActiveTurn | null;
  readonly expiresAt: string;
}

export type LeaseResult = 'acquired' | 'busy' | 'missing';

export function leaseHeld(active: ActiveTurn | null, now: Date): active is ActiveTurn {
  return active !== null && active.expiresAt > now.toISOString();
}

/** Per-user chat sessions and their turns. Only the agent service reaches the store. */
export interface SessionStore {
  create(uid: string, now: Date): Promise<SessionRecord>;
  list(uid: string): Promise<SessionSummary[]>;
  get(uid: string, sessionId: string): Promise<SessionRecord | null>;
  delete(uid: string, sessionId: string): Promise<boolean>;
  /** Turns in `seq` order; `limit` keeps the most recent ones. */
  listTurns(uid: string, sessionId: string, limit?: number): Promise<StoredTurn[]>;
  /** One stored turn, or null when it or its session is gone. */
  getTurn(uid: string, sessionId: string, turnId: string): Promise<StoredTurn | null>;
  /**
   * One turn at a time per session: a held lease answers `busy`, an expired one is taken over. `takeOverFrom`
   * also takes the lease from that turn, for a new message that asked it to stop and waited long enough.
   */
  acquireTurn(uid: string, sessionId: string, turnId: string, now: Date, takeOverFrom?: string): Promise<LeaseResult>;
  /** Asks the running turn to stop; returns its id, or null when no turn runs (or the session is missing). */
  requestCancel(uid: string, sessionId: string, now: Date): Promise<string | null>;
  /**
   * Calls `listener` with the session (null once deleted) whenever it changes, starting with its current
   * state; a running turn watches its lease this way. Returns the function that stops watching.
   */
  watchSession(uid: string, sessionId: string, listener: (record: SessionRecord | null) => void): () => void;
  /**
   * Stores the finished turn with its photos and advances the session; the store numbers the turn. A turn that
   * still holds the lease clears it and sets the pending question; one that was taken over leaves both to the
   * newer turn.
   */
  completeTurn(uid: string, sessionId: string, turn: StoredTurn, now: Date, images?: readonly TurnImage[]): Promise<void>;
  /** Clears the lease of a turn that produced nothing to store. */
  releaseTurn(uid: string, sessionId: string, turnId: string): Promise<void>;
  /** A stored photo of the session, or null. */
  getAttachment(uid: string, sessionId: string, attachmentId: string): Promise<TurnImage | null>;
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
interface MemorySession { record: SessionRecord; turns: StoredTurn[]; readonly attachments: Map<string, TurnImage> }

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Map<string, MemorySession>>();
  private readonly watchers = new Map<string, Set<(record: SessionRecord | null) => void>>();

  /** Watchers hear about a change after the change, never inside it, as Firestore listeners do. */
  private notify(uid: string, sessionId: string): void {
    const listeners = this.watchers.get(`${uid}/${sessionId}`);
    if (listeners === undefined) return;
    const record = this.user(uid).get(sessionId)?.record ?? null;
    for (const listener of listeners) queueMicrotask(() => { if (listeners.has(listener)) listener(record); });
  }

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
    sessions.set(record.id, { record, turns: [], attachments: new Map() });
    // Oldest sessions go first once a user exceeds the limit.
    const ordered = [...sessions.values()].sort((a, b) => a.record.updatedAt.localeCompare(b.record.updatedAt) || a.record.createdAt.localeCompare(b.record.createdAt));
    while (ordered.length > SESSION_LIMITS.sessionsPerUser) {
      const oldest = ordered.shift()!.record.id;
      sessions.delete(oldest);
      this.notify(uid, oldest);
    }
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
    const deleted = this.user(uid).delete(sessionId);
    if (deleted) this.notify(uid, sessionId);
    return deleted;
  }

  async listTurns(uid: string, sessionId: string, limit?: number): Promise<StoredTurn[]> {
    const turns = this.user(uid).get(sessionId)?.turns ?? [];
    return limit === undefined ? [...turns] : turns.slice(Math.max(0, turns.length - limit));
  }

  async getTurn(uid: string, sessionId: string, turnId: string): Promise<StoredTurn | null> {
    return this.user(uid).get(sessionId)?.turns.find((turn) => turn.id === turnId) ?? null;
  }

  async acquireTurn(uid: string, sessionId: string, turnId: string, now: Date, takeOverFrom?: string): Promise<LeaseResult> {
    const entry = this.user(uid).get(sessionId);
    if (entry === undefined) return 'missing';
    const active = entry.record.activeTurn;
    if (leaseHeld(active, now) && active.turnId !== takeOverFrom) return 'busy';
    entry.record = { ...entry.record, activeTurn: { turnId, expiresAt: new Date(now.getTime() + SESSION_LIMITS.leaseMs).toISOString() } };
    this.notify(uid, sessionId);
    return 'acquired';
  }

  async requestCancel(uid: string, sessionId: string, now: Date): Promise<string | null> {
    const entry = this.user(uid).get(sessionId);
    const active = entry?.record.activeTurn ?? null;
    if (entry === undefined || !leaseHeld(active, now)) return null;
    if (active.cancelRequested !== true) {
      entry.record = { ...entry.record, activeTurn: { ...active, cancelRequested: true } };
      this.notify(uid, sessionId);
    }
    return active.turnId;
  }

  watchSession(uid: string, sessionId: string, listener: (record: SessionRecord | null) => void): () => void {
    const key = `${uid}/${sessionId}`;
    let listeners = this.watchers.get(key);
    if (listeners === undefined) { listeners = new Set(); this.watchers.set(key, listeners); }
    listeners.add(listener);
    const record = this.user(uid).get(sessionId)?.record ?? null;
    queueMicrotask(() => { if (listeners.has(listener)) listener(record); });
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.watchers.delete(key);
    };
  }

  async completeTurn(uid: string, sessionId: string, turn: StoredTurn, now: Date, images: readonly TurnImage[] = []): Promise<void> {
    const entry = this.user(uid).get(sessionId);
    if (entry === undefined) return;
    entry.turns.push({ ...turn, seq: entry.record.turnCount + 1 });
    for (const image of images) entry.attachments.set(image.id, image);
    while (entry.turns.length > SESSION_LIMITS.turnsPerSession) {
      for (const attachment of entry.turns.shift()!.attachments) entry.attachments.delete(attachment.id);
    }
    const stamp = now.toISOString();
    const active = entry.record.activeTurn;
    const holds = active?.turnId === turn.id;
    entry.record = { ...entry.record,
      title: entry.record.title === '' && turn.input.kind === 'text' ? sessionTitle(turn.input.text) : entry.record.title,
      turnCount: entry.record.turnCount + 1, updatedAt: stamp,
      pendingQuestion: holds ? turn.question : entry.record.pendingQuestion, activeTurn: holds ? null : active,
      expiresAt: new Date(now.getTime() + SESSION_LIMITS.ttlMs).toISOString() };
    this.notify(uid, sessionId);
  }

  async releaseTurn(uid: string, sessionId: string, turnId: string): Promise<void> {
    const entry = this.user(uid).get(sessionId);
    if (entry === undefined || entry.record.activeTurn?.turnId !== turnId) return;
    entry.record = { ...entry.record, activeTurn: null };
    this.notify(uid, sessionId);
  }

  async getAttachment(uid: string, sessionId: string, attachmentId: string): Promise<TurnImage | null> {
    return this.user(uid).get(sessionId)?.attachments.get(attachmentId) ?? null;
  }
}
