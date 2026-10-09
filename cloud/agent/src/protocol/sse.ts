import type { ServerResponse } from 'node:http';

import { agentEventSchema, type AgentEvent, type AgentEventBody } from './schemas.js';

export interface EventSink {
  /** Validates, numbers and sends one event; returns the event as sent. */
  emit(body: AgentEventBody): AgentEvent;
  readonly sent: readonly AgentEvent[];
}

/** Server-sent events with a per-turn `seq`, so the app can de-duplicate and order them. */
export function openSseStream(response: ServerResponse, turnId: string, options: { readonly heartbeatMs?: number } = {}): EventSink & { close(): void } {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  const sent: AgentEvent[] = [];
  let seq = 0;
  const heartbeat = setInterval(() => { if (!response.writableEnded) response.write(': keep-alive\n\n'); },
    options.heartbeatMs ?? 20_000);
  heartbeat.unref();
  return {
    sent,
    emit(body) {
      const event = agentEventSchema.parse({ ...body, turnId, seq });
      seq += 1;
      sent.push(event);
      if (!response.writableEnded && !response.destroyed) {
        response.write(`event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      return event;
    },
    close() {
      clearInterval(heartbeat);
      if (!response.writableEnded) response.end();
    },
  };
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
