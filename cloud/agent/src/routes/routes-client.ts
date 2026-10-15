import type { LatLng } from '../protocol/schemas.js';

export type RouteMode = 'walk' | 'transit';

export interface RouteLeg { readonly from: number; readonly to: number; readonly duration_min: number; readonly distance_m: number }

export interface ComputedRoute {
  readonly distance_m: number;
  readonly duration_min: number;
  readonly legs: readonly RouteLeg[];
  /** Google encoded polyline, precision 5. */
  readonly polyline: string;
}

/** Thrown when Google found no route between the waypoints; any other failure is an ordinary upstream error. */
export class RouteNotFoundError extends Error {
  constructor(message = 'No route between the waypoints') { super(message); this.name = 'RouteNotFoundError'; }
}

/** The Routes API behind one call, so tools and tests never see HTTP. */
export interface RoutesClient {
  compute(request: { readonly waypoints: readonly LatLng[]; readonly mode: RouteMode; readonly signal: AbortSignal }): Promise<ComputedRoute>;
}

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration';

interface RawLeg { readonly distanceMeters?: number; readonly duration?: string }
interface RawRoute { readonly distanceMeters?: number; readonly duration?: string; readonly polyline?: { readonly encodedPolyline?: string }; readonly legs?: readonly RawLeg[] }

/** Routes API durations arrive as seconds with an `s` suffix, for example `"1260s"`. */
export function secondsOf(duration: string | undefined): number {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration ?? '');
  return match === null ? 0 : Number(match[1]);
}

function location(point: LatLng) { return { location: { latLng: { latitude: point.lat, longitude: point.lng } } }; }

export function parseRoute(raw: RawRoute | undefined): ComputedRoute {
  const polyline = raw?.polyline?.encodedPolyline;
  if (raw === undefined || polyline === undefined || polyline === '') throw new RouteNotFoundError();
  const legs = (raw.legs ?? []).map((leg, index): RouteLeg => ({ from: index, to: index + 1,
    duration_min: Math.max(1, Math.round(secondsOf(leg.duration) / 60)), distance_m: Math.round(leg.distanceMeters ?? 0) }));
  return { distance_m: Math.round(raw.distanceMeters ?? 0), duration_min: Math.max(1, Math.round(secondsOf(raw.duration) / 60)), legs, polyline };
}

export interface RoutesClientOptions {
  /** Only for local development with user credentials, which the Routes API refuses without a quota project; a service identity needs none. */
  readonly quotaProject?: string;
  /** Returns an OAuth access token for the service identity; injected in tests. */
  readonly accessToken?: () => Promise<string>;
  readonly fetch?: typeof fetch;
}

/**
 * The Routes API with the service identity's OAuth token: no Maps Platform key is stored or sent, and the call is billed to
 * the identity's own project, so the identity needs no serviceusage role.
 * Transit supports an origin and a destination only; walking takes up to 11 intermediate stops.
 */
export function createRoutesClient(options: RoutesClientOptions): RoutesClient {
  const doFetch = options.fetch ?? fetch;
  let auth: Promise<import('google-auth-library').GoogleAuth> | null = null;
  const token = options.accessToken ?? (async () => {
    auth ??= import('google-auth-library').then(({ GoogleAuth }) => new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }));
    const value = await (await auth).getAccessToken();
    if (value === null || value === undefined || value === '') throw new Error('No access token for the Routes API');
    return value;
  });
  return {
    async compute({ waypoints, mode, signal }) {
      const first = waypoints[0]!;
      const last = waypoints.at(-1)!;
      const body = { origin: location(first), destination: location(last), travelMode: mode === 'walk' ? 'WALK' : 'TRANSIT',
        ...(waypoints.length > 2 ? { intermediates: waypoints.slice(1, -1).map(location) } : {}),
        languageCode: 'en-AU', units: 'METRIC' };
      const response = await doFetch(ENDPOINT, { method: 'POST', signal, body: JSON.stringify(body), headers: {
        'content-type': 'application/json', authorization: `Bearer ${await token()}`, 'x-goog-fieldmask': FIELD_MASK,
        ...(options.quotaProject === undefined ? {} : { 'x-goog-user-project': options.quotaProject }) } });
      if (response.status === 404) throw new RouteNotFoundError();
      if (!response.ok) throw new Error(`Routes API answered ${response.status}`);
      const payload = await response.json() as { routes?: readonly RawRoute[] };
      return parseRoute(payload.routes?.[0]);
    },
  };
}
