import type { ServerResponse } from 'node:http';

import { agentEventSchema, type AgentEvent, type AgentEventBody } from './schemas.js';

export interface EventSink {
  /** Validates, numbers and sends one event; returns the event as sent. */
  emit(body: AgentEventBody): AgentEvent;
  readonly sent: readonly AgentEvent[];
}

/**
 * A running turn's events, which any number of clients may follow: the request that started the turn, and a client
 * that lost its connection and resumes after the last `seq` it read (agent-protocol.md, Resuming a turn).
 */
export interface TurnStream extends EventSink {
  /** Sends the events after `afterSeq` to `response`, then each new one, until the turn ends or the client leaves. */
  attach(response: ServerResponse, afterSeq?: number): void;
  /** Called with the number of clients following the turn whenever one leaves or arrives. */
  onClientsChanged(listener: (clients: number) => void): void;
  readonly finished: boolean;
  /** Ends every client's response; a client attaching later gets the events and the end at once. */
  close(): void;
}

function writeEvent(response: ServerResponse, event: AgentEvent): void {
  if (!response.writableEnded && !response.destroyed) response.write(`event: ${event.event}\nid: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
}

/** Server-sent events with a per-turn `seq`, so the app can de-duplicate and order them and resume after a drop. */
export function createTurnStream(turnId: string, options: { readonly heartbeatMs?: number } = {}): TurnStream {
  const sent: AgentEvent[] = [];
  const clients = new Map<ServerResponse, NodeJS.Timeout>();
  const listeners: Array<(clients: number) => void> = [];
  let seq = 0;
  let finished = false;
  const changed = () => { for (const listener of listeners) listener(clients.size); };
  const detach = (response: ServerResponse) => {
    const heartbeat = clients.get(response);
    if (heartbeat === undefined) return;
    clearInterval(heartbeat);
    clients.delete(response);
    changed();
  };
  return {
    sent,
    get finished() { return finished; },
    emit(body) {
      const event = agentEventSchema.parse({ ...body, turnId, seq });
      seq += 1;
      sent.push(event);
      for (const response of clients.keys()) writeEvent(response, event);
      return event;
    },
    attach(response, afterSeq = -1) {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      for (const event of sent) if (event.seq > afterSeq) writeEvent(response, event);
      if (finished) { response.end(); return; }
      const heartbeat = setInterval(() => { if (!response.writableEnded) response.write(': keep-alive\n\n'); },
        options.heartbeatMs ?? 20_000);
      heartbeat.unref();
      clients.set(response, heartbeat);
      response.on('close', () => detach(response));
      changed();
    },
    onClientsChanged(listener) { listeners.push(listener); },
    close() {
      finished = true;
      for (const [response, heartbeat] of clients) {
        clearInterval(heartbeat);
        if (!response.writableEnded) response.end();
      }
      clients.clear();
    },
  };
}

/** One client's stream of a turn, for a turn that cannot be resumed. */
export function openSseStream(response: ServerResponse, turnId: string, options: { readonly heartbeatMs?: number } = {}): EventSink & { close(): void } {
  const stream = createTurnStream(turnId, options);
  stream.attach(response);
  return stream;
}

/** An in-memory sink for tests and for turns that run without a client (eval). */
export function collectingSink(turnId: string): EventSink {
  const sent: AgentEvent[] = [];
  let seq = 0;
  return { sent, emit(body) {
    const event = agentEventSchema.parse({ ...body, turnId, seq });
    seq += 1; sent.push(event); return event;
  } };
}
