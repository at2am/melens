/** Per-uid turn starts in a sliding hour. In-memory per instance; the Firestore-backed counter is a later task. */
export interface RateLimiter {
  allow(uid: string, now: Date): boolean;
}

export function createRateLimiter(turnsPerHour: number): RateLimiter {
  const windowMs = 60 * 60 * 1_000;
  const starts = new Map<string, number[]>();
  return {
    allow(uid, now) {
      const cutoff = now.getTime() - windowMs;
      const recent = (starts.get(uid) ?? []).filter((at) => at > cutoff);
      if (recent.length >= turnsPerHour) { starts.set(uid, recent); return false; }
      recent.push(now.getTime());
      starts.set(uid, recent);
      if (starts.size > 10_000) for (const [key, value] of starts) if (value.every((at) => at <= cutoff)) starts.delete(key);
      return true;
    },
  };
}
