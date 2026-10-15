const MELBOURNE = 'Australia/Melbourne';

const formatter = new Intl.DateTimeFormat('en-AU', { timeZone: MELBOURNE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function localParts(date: Date): { readonly text: string; readonly offsetMinutes: number } {
  const part = Object.fromEntries(formatter.formatToParts(date).map((item) => [item.type, item.value]));
  const text = `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}`;
  const offsetMinutes = Math.round((Date.parse(`${text}Z`) - date.getTime()) / 60_000);
  return { text, offsetMinutes };
}

/** Melbourne local time with its offset, the form every tool argument and result uses. */
export function toMelbourneIso(instant: string | Date): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid instant');
  const { text, offsetMinutes } = localParts(date);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `${text}${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

/** The UTC instant the map contract expects, from any ISO 8601 time with an offset. */
export function toInstant(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid time');
  return date.toISOString();
}

export function melbourneDayOfWeek(date: Date): 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' {
  const name = new Intl.DateTimeFormat('en-AU', { timeZone: MELBOURNE, weekday: 'short' }).format(date).toLowerCase().slice(0, 3);
  return name as 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
}

/** The Melbourne calendar date, `2026-10-10`; the key a day's cached answers share. */
export function melbourneDate(date: Date): string {
  return localParts(date).text.slice(0, 10);
}
