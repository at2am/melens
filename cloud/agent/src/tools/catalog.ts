import type { LayerId, MapGeometry, MapItem } from '@melens/shared/contracts/map-contract';
import { timeWindowSchema as queryTimeWindowSchema } from '@melens/shared/contracts/map-contract';
import { z } from 'zod';

import type { GroundingModel } from '../agent/grounding.js';
import type { StructuredModel } from '../agent/structured.js';
import { melbourneDate, toInstant, toMelbourneIso } from '../agent/time.js';
import { centroid, compactFeature, haversineMeters, matchesKeywords, type CompactFeature } from '../features/compact.js';
import type { FeatureReader } from '../features/reader.js';
import { readTurnFeatures, turnSearchTime } from '../features/turn-search.js';
import { RouteNotFoundError, type RoutesClient } from '../routes/routes-client.js';
import { QUESTION_LIMITS, latLngSchema, modelCardItemSchema, timeWindowSchema, travelModeSchema, type CardItem, type LatLng, type StopParking } from '../protocol/schemas.js';
import { cached, type ToolCache } from '../cache.js';
import { PLAN_PARKING_STOPS, analyseAnomalyTool, areaBriefTool, findParkingTool, planParkingTool } from '../workflows/workflows.js';
import { defineTool, isToolError, runTool, toolError, type ToolError, type ToolSpec, type TurnRegistry } from './define.js';

/** The layers the agent can search: the point-feature layers of map contract v1 (tools.md, Shared types). */
export const toolLayerSchema = z.enum(['pedestrian', 'anomaly', 'disruption', 'event', 'news', 'planning', 'parking']);
export type ToolLayer = z.infer<typeof toolLayerSchema>;
/**
 * Searched when neither the call nor the map names a layer. Parking (UC-15) is left out on purpose: a few
 * hundred sensors sit near any central point and would crowd every other result out of a nearest-first list.
 * The model asks for it by name for parking questions.
 */
const DEFAULT_LAYERS: readonly ToolLayer[] = ['event', 'disruption', 'news', 'planning', 'pedestrian', 'anomaly'];

/** How a layer reads in a step's argument summary. */
const LAYER_LABELS: Record<ToolLayer, string> = {
  pedestrian: 'pedestrian counts', anomaly: 'anomalies', disruption: 'disruptions', event: 'events', news: 'news', planning: 'planning',
  parking: 'parking sensors',
};
export function layerList(layers: readonly ToolLayer[]): string { return layers.map((layer) => LAYER_LABELS[layer]).join(', '); }
export function distanceLabel(metres: number): string { return metres >= 1_000 ? `${(metres / 1_000).toFixed(1).replace(/\.0$/, '')} km` : `${metres} m`; }
function pointLabel(point: LatLng): string { return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`; }
function featureLabel(turn: TurnRegistry, id: string): string { return turn.features.get(id)?.title ?? id; }

const bboxSchema = z.strictObject({
  north: z.number().min(-90).max(90), south: z.number().min(-90).max(90), east: z.number().min(-180).max(180), west: z.number().min(-180).max(180),
}).refine((box) => box.north > box.south && box.east > box.west, 'bbox needs north > south and east > west');

/** `Area`: a centre with a radius, or a bounding box at most 10 km per side. */
const areaSchema = z.strictObject({
  center: latLngSchema.optional().describe('Centre of a circular area'),
  radius_m: z.number().int().min(50).max(5_000).optional().describe('Radius in metres around center, 50 to 5000'),
  bbox: bboxSchema.optional().describe('A bounding box instead of center and radius; at most 10 km per side'),
}).refine((area) => (area.center !== undefined && area.radius_m !== undefined) !== (area.bbox !== undefined)
  && (area.bbox === undefined || (area.center === undefined && area.radius_m === undefined)),
  'Give either center with radius_m, or bbox').refine((area) => area.bbox === undefined
  || (haversineMeters({ lat: area.bbox.south, lng: area.bbox.west }, { lat: area.bbox.south, lng: area.bbox.east }) <= 10_000
    && haversineMeters({ lat: area.bbox.south, lng: area.bbox.west }, { lat: area.bbox.north, lng: area.bbox.west }) <= 10_000),
  'bbox is at most 10 km per side');
export type Area = z.infer<typeof areaSchema>;

function metresToDegreesLat(metres: number): number { return metres / 111_320; }
function metresToDegreesLng(metres: number, lat: number): number { return metres / (111_320 * Math.cos(lat * Math.PI / 180)); }

export function boxOf(area: Area): { readonly bbox: [number, number, number, number]; readonly centre: LatLng; readonly radius: number | null } {
  if (area.bbox !== undefined) {
    return { bbox: [area.bbox.west, area.bbox.south, area.bbox.east, area.bbox.north],
      centre: { lat: (area.bbox.north + area.bbox.south) / 2, lng: (area.bbox.east + area.bbox.west) / 2 }, radius: null };
  }
  const centre = area.center!;
  const radius = area.radius_m!;
  return { bbox: [centre.lng - metresToDegreesLng(radius, centre.lat), centre.lat - metresToDegreesLat(radius),
    centre.lng + metresToDegreesLng(radius, centre.lat), centre.lat + metresToDegreesLat(radius)], centre, radius };
}

export const HOUR = 60 * 60 * 1_000;

export function windowOf(time: { from?: string | undefined; to?: string | undefined } | undefined, now: Date, defaults: { readonly back: number; readonly ahead: number }) {
  const instantOf = (value: string | undefined, fallback: number): string => {
    if (value === undefined) return toInstant(new Date(fallback));
    const utc = toInstant(value);
    const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1];
    return fraction === undefined ? utc : utc.replace(/\.\d{3}Z$/, `.${fraction}Z`);
  };
  try {
    const parsed = queryTimeWindowSchema.safeParse({ from: instantOf(time?.from, now.getTime() - defaults.back),
      to: instantOf(time?.to, now.getTime() + defaults.ahead) });
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

function overlaps(feature: CompactFeature, window: { from: string; to: string }): boolean {
  const from = feature.valid_from === null ? null : new Date(feature.valid_from).getTime();
  const to = feature.valid_to === null ? null : new Date(feature.valid_to).getTime();
  const start = new Date(window.from).getTime();
  const end = new Date(window.to).getTime();
  return (from === null || from < end) && (to === null || to > start);
}

/** Without a configured value a grounding call may take this long before the tool gives up. */
export const DEFAULT_GROUNDING_TIMEOUT_MS = 40_000;

export interface ToolDependencies {
  readonly features: FeatureReader;
  readonly grounding: GroundingModel | null;
  /** The Routes API behind `draw_route`; without it the tool answers `upstream_unavailable`. */
  readonly routes?: RoutesClient | null;
  /** One-shot structured Gemini generation for the workflows; without it `area_brief` and `analyse_anomaly` answer `upstream_unavailable`. */
  readonly structured?: StructuredModel | null;
  /** Shared results across users and instances: grounded answers and workflow cards. */
  readonly cache?: ToolCache;
  /** A grounding call that takes longer returns `upstream_unavailable`, so the model answers from the map data instead of waiting. */
  readonly groundingTimeoutMs?: number;
}

interface SearchOutcome { readonly features: CompactFeature[]; readonly states: Record<string, string> }

export async function searchArea(deps: ToolDependencies, turn: TurnRegistry, area: Area, layers: readonly ToolLayer[],
  window: { from: string; to: string }): Promise<SearchOutcome> {
  const { bbox, centre, radius } = boxOf(area);
  const results = await readTurnFeatures(deps.features, turn, { requestId: `${turn.turn.turnId}-${turn.trace.length}`, bbox, layers,
    window, mode: 'current' });
  const states: Record<string, string> = {};
  const features: CompactFeature[] = [];
  for (const layer of results) {
    states[layer.layerId] = layer.state;
    turn.rememberFeatures(layer.items);
    for (const item of layer.items) {
      const compact = compactFeature(item, centre);
      if (compact === null) continue;
      if (radius !== null && compact.distance_m !== null && compact.distance_m > radius) continue;
      if (!overlaps(compact, window)) continue;
      features.push(compact);
    }
  }
  return { features, states };
}

/** The layers a search covers: the requested ones, else the layers visible on the map, else every layer. */
function searchLayers(requested: readonly ToolLayer[] | undefined, turn: TurnRegistry): readonly ToolLayer[] {
  if (requested !== undefined) return requested;
  const contextLayers = turn.turn.request.context.layers.filter((layer): layer is ToolLayer => toolLayerSchema.safeParse(layer).success);
  // A visible parking layer would crowd a general search; it is searched by name, or when it is all the map shows.
  const general = contextLayers.filter((layer) => layer !== 'parking');
  return general.length > 0 ? general : contextLayers.length > 0 ? contextLayers : DEFAULT_LAYERS;
}

const searchFeatures = (deps: ToolDependencies) => defineTool({
  name: 'search_features',
  description: 'Find map features (events, transport disruptions, news, planning applications, pedestrian sensors, anomalies, live parking bay sensors) in an area, '
    + 'optionally filtered by layer, time window and keywords. Use it before recommending or describing anything on the map, and cite the ids it returns. '
    + 'For parking, pass layers ["parking"] with a small radius (about 300 m): each result is one on-street bay sensor that reads Vacant, Occupied '
    + 'or No data. A vacant reading does not mean parking there is legal or allowed now; say so, and do not state rules, limits or prices from it.',
  status: 'Searching the map',
  readOnly: true,
  schema: z.strictObject({
    area: areaSchema,
    layers: z.array(toolLayerSchema).min(1).max(7).optional().describe('Defaults to the layers visible on the map'),
    time: timeWindowSchema.optional().describe('Keeps features valid at some point in the window; Melbourne local time with offset'),
    query: z.string().max(100).optional().describe('Keyword match on title and summary'),
    sort: z.enum(['distance', 'time']).optional().describe('Default distance from the area centre'),
    limit: z.number().int().min(1).max(50).optional().describe('1 to 50, default 20'),
  }),
  detail(args, turn) {
    const area = args.area.bbox !== undefined ? 'in an area' : `within ${distanceLabel(args.area.radius_m!)}`;
    return [layerList(searchLayers(args.layers, turn)), area, ...(args.query === undefined ? [] : [`"${args.query}"`])].join(' · ');
  },
  async run(args, turn) {
    const layers = searchLayers(args.layers, turn);
    const now = layers.includes('parking') ? turn.now() : turnSearchTime(turn);
    const window = windowOf(args.time, now, { back: 24 * HOUR, ahead: 24 * HOUR });
    if (window === null) return toolError('invalid_arguments', 'time.from must be before time.to');
    const { features, states } = await searchArea(deps, turn, args.area, layers, window);
    const filtered = args.query === undefined ? features : features.filter((feature) => matchesKeywords(feature, args.query!));
    filtered.sort(args.sort === 'time'
      ? (a, b) => (a.valid_from ?? '').localeCompare(b.valid_from ?? '') : (a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
    const limit = args.limit ?? 20;
    return { total: filtered.length, truncated: filtered.length > limit, items: filtered.slice(0, limit), layers: states };
  },
});

/** Geometry with at most this many positions reaches the model. */
const MAX_GEOMETRY_POINTS = 200;

function simplify(geometry: MapGeometry): MapGeometry {
  const decimate = (points: [number, number][]) => {
    if (points.length <= MAX_GEOMETRY_POINTS) return points;
    const step = Math.ceil(points.length / MAX_GEOMETRY_POINTS);
    const kept = points.filter((_point, index) => index % step === 0);
    return kept.at(-1) === points.at(-1) ? kept : [...kept, points.at(-1)!];
  };
  switch (geometry.type) {
    case 'Point': case 'MultiPoint': return geometry;
    case 'LineString': return { type: 'LineString', coordinates: decimate(geometry.coordinates) };
    case 'MultiLineString': return { type: 'MultiLineString', coordinates: geometry.coordinates.map(decimate) };
    case 'Polygon': return { type: 'Polygon', coordinates: geometry.coordinates.map(decimate) };
    case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((polygon) => polygon.map(decimate)) };
  }
}

/**
 * A feature by id: from this turn's searches, else from one search over the map the user is looking at. The
 * features a user can tap or select are in the request's viewport, so no lookup-by-id query surface is needed.
 */
export async function resolveFeature(deps: ToolDependencies, turn: TurnRegistry, id: string): Promise<MapItem | undefined> {
  const parking = id.startsWith('parking:');
  if (!parking) turn.signal.throwIfAborted();
  const known = turn.features.get(id);
  if (known !== undefined) return known;
  const v = turn.turn.request.context.viewport;
  const window = windowOf(undefined, parking ? turn.now() : turnSearchTime(turn), { back: 7 * 24 * HOUR, ahead: 7 * 24 * HOUR });
  if (window === null) return undefined;
  const layers = toolLayerSchema.options.filter((layer) => id.startsWith(`${layer}:`));
  const results = await readTurnFeatures(deps.features, turn, { requestId: `${turn.turn.turnId}-resolve-${turn.trace.length}`, bbox: [v.west, v.south, v.east, v.north],
    layers: layers.length > 0 ? layers : DEFAULT_LAYERS, window, mode: 'current' });
  for (const layer of results) turn.rememberFeatures(parking ? layer.items.filter((item) => item.id === id) : layer.items);
  return turn.features.get(id);
}

const getFeature = (deps: ToolDependencies) => defineTool({
  name: 'get_feature',
  description: "Get the full record of one map feature: an event's full description, a disruption's affected segments, a news item's full summary. "
    + 'Use it when a search result is not enough to answer, or to read the feature the user selected on the map.',
  status: 'Reading the details',
  readOnly: true,
  schema: z.strictObject({ id: z.string().min(1).max(256).describe('A feature id returned by search_features or nearby_context, or the selected feature in the map context') }),
  detail(args, turn) { return featureLabel(turn, args.id); },
  async run(args, turn) {
    const item = await resolveFeature(deps, turn, args.id);
    if (item === undefined) return toolError('not_found', 'No feature with this id is on the map the user is looking at; search first.');
    const full: MapItem = item.geometry === null ? item : { ...item, geometry: simplify(item.geometry) };
    return { item: full };
  },
});

const getAnomaly = (deps: ToolDependencies) => defineTool({
  name: 'get_anomaly',
  description: 'Get the numbers behind a pedestrian anomaly marker: the observed count, the usual count and the size of the difference. Use it when '
    + 'the user asks about a specific "?" marker. To explain the anomaly, prefer analyse_anomaly.',
  status: 'Reading the pedestrian anomaly',
  readOnly: true,
  schema: z.strictObject({ feature_id: z.string().min(1).max(256).describe('The id of a feature in the anomaly layer') }),
  detail(args, turn) { return featureLabel(turn, args.feature_id); },
  async run(args, turn) {
    const item = await resolveFeature(deps, turn, args.feature_id);
    if (item === undefined) return toolError('not_found', 'No feature with this id is on the map the user is looking at.');
    if (item.kind !== 'anomaly') return toolError('not_an_anomaly', 'This feature is not a pedestrian anomaly; use pedestrian counts from search_features instead.');
    const d = item.details;
    const changePct = d.observedValue === null || d.baselineValue === null || d.baselineValue === 0 ? null
      : Math.round((d.observedValue - d.baselineValue) / d.baselineValue * 100);
    return { feature_id: item.id, sensor: { id: d.sensorId, name: item.title, ...(item.geometry === null ? {} : centroid(item.geometry)) },
      window: { from: toMelbourneIso(d.window.from), to: toMelbourneIso(d.window.to) }, observed: d.observedValue, baseline: d.baselineValue,
      delta: d.delta, change_pct: changePct, direction: d.direction, classification: d.classification, method: d.baselineDefinitionId };
  },
});

const nearbyContext = (deps: ToolDependencies) => defineTool({
  name: 'nearby_context',
  description: 'What else is going on around a place: recent news, events and transport disruptions. Use it to explain crowds, '
    + 'or to check a plan against disruptions before recommending it.',
  status: 'Checking nearby news, events and disruptions',
  readOnly: true,
  schema: z.strictObject({
    point: latLngSchema,
    radius_m: z.number().int().min(100).max(3_000).optional().describe('Default 1000'),
    time: timeWindowSchema.optional().describe('Defaults to the past 24 hours through the next 6 hours'),
  }),
  detail(args) { return `within ${distanceLabel(args.radius_m ?? 1_000)} of ${pointLabel(args.point)}`; },
  async run(args, turn) {
    const window = windowOf(args.time, turnSearchTime(turn), { back: 24 * HOUR, ahead: 6 * HOUR });
    if (window === null) return toolError('invalid_arguments', 'time.from must be before time.to');
    const area: Area = { center: args.point, radius_m: args.radius_m ?? 1_000 };
    const { features } = await searchArea(deps, turn, area, ['news', 'event', 'disruption'], window);
    const pick = (layer: ToolLayer) => features.filter((feature) => feature.layer === layer)
      .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
    const news = pick('news'); const events = pick('event'); const disruptions = pick('disruption');
    return { totals: { news: news.length, events: events.length, disruptions: disruptions.length },
      news: news.slice(0, 10), events: events.slice(0, 10), disruptions: disruptions.slice(0, 10) };
  },
});

const showLayers = defineTool({
  name: 'show_layers',
  description: 'Change which layers are visible on the map, optionally filtered by category or time. Use it when the user asks to see or hide '
    + 'something, such as "only show live music tonight".',
  status: 'Updating the map layers',
  readOnly: false,
  schema: z.strictObject({
    layers: z.array(toolLayerSchema).min(1).max(7),
    mode: z.enum(['only', 'add', 'remove']).optional().describe('Default add; only hides every other layer'),
    filter: z.strictObject({ categories: z.array(z.string().min(1).max(40)).max(10).optional(), time: timeWindowSchema.optional() }).optional(),
  }),
  detail(args) {
    const verb = args.mode === 'only' ? 'only' : args.mode === 'remove' ? 'hide' : 'show';
    return `${verb} ${layerList(args.layers)}`;
  },
  async run(args, turn, step) {
    const current = new Set<string>(turn.turn.request.context.layers);
    const mode = args.mode ?? 'add';
    const visible = mode === 'only' ? new Set<string>(args.layers)
      : mode === 'remove' ? new Set([...current].filter((layer) => !args.layers.includes(layer as ToolLayer)))
        : new Set([...current, ...args.layers]);
    const action = { action: 'show_layers' as const, args: { layers: args.layers, mode, ...(args.filter === undefined ? {} : { filter: args.filter }) } };
    turn.uiActions.push(action);
    turn.sink.emit({ event: 'ui_action', stepId: step.id, ...action });
    return { ok: true, visible_layers: [...visible] };
  },
});

const focusMap = (deps: ToolDependencies) => defineTool({
  name: 'focus_map',
  description: 'Move the map to a place, an area or a feature. Use it when the user asks to go somewhere or look at something, '
    + 'and before showing results that are off screen.',
  status: 'Moving the map',
  readOnly: false,
  schema: z.strictObject({
    target: z.strictObject({ point: latLngSchema.optional(), bbox: bboxSchema.optional(), feature_id: z.string().min(1).max(256).optional() })
      .refine((target) => [target.point, target.bbox, target.feature_id].filter((value) => value !== undefined).length === 1,
        'Give exactly one of point, bbox or feature_id'),
    zoom: z.number().int().min(10).max(20).optional().describe('The app picks one if omitted'),
  }),
  detail(args, turn) {
    if (args.target.feature_id !== undefined) return `to ${featureLabel(turn, args.target.feature_id)}`;
    return args.target.point !== undefined ? `to ${pointLabel(args.target.point)}` : 'to an area';
  },
  async run(args, turn, step) {
    let target: Record<string, unknown> = args.target;
    if (args.target.feature_id !== undefined) {
      const item = await resolveFeature(deps, turn, args.target.feature_id);
      if (item === undefined || item.geometry === null) return toolError('not_found', 'No located feature with this id is on the map the user is looking at.');
      target = { feature_id: args.target.feature_id, point: centroid(item.geometry) };
    }
    const action = { action: 'focus_map' as const, args: { target, ...(args.zoom === undefined ? {} : { zoom: args.zoom }) } };
    turn.uiActions.push(action);
    turn.sink.emit({ event: 'ui_action', stepId: step.id, ...action });
    return { ok: true };
  },
});

const highlightFeatures = (deps: ToolDependencies) => defineTool({
  name: 'highlight_features',
  description: 'Highlight features on the map, such as the places you are talking about. Pass feature ids only; places from Google Maps '
    + 'appear as pins in their card instead.',
  status: 'Highlighting features',
  readOnly: false,
  schema: z.strictObject({
    ids: z.array(z.string().min(1).max(256)).min(1).max(30),
    clear_previous: z.boolean().optional().describe('Default true'),
  }),
  detail(args, turn) {
    const titles = args.ids.map((id) => featureLabel(turn, id));
    return titles.length <= 3 ? titles.join(', ') : `${titles.slice(0, 3).join(', ')} and ${titles.length - 3} more`;
  },
  async run(args, turn, step) {
    const resolved = await Promise.all(args.ids.map(async (id) => (await resolveFeature(deps, turn, id)) !== undefined));
    const found = args.ids.filter((_id, index) => resolved[index]);
    const missing = args.ids.filter((_id, index) => !resolved[index]);
    const action = { action: 'highlight_features' as const, args: { ids: found, clear_previous: args.clear_previous ?? true, missing } };
    turn.uiActions.push(action);
    turn.sink.emit({ event: 'ui_action', stepId: step.id, ...action });
    return { ok: true, missing };
  },
});

/** Where a plan stop is: the point the model gave, else the feature it cites, when this turn has it. */
function stopPoint(turn: TurnRegistry, item: CardItem): LatLng | undefined {
  if (item.location !== undefined) return item.location;
  const feature = 'feature_id' in item.source ? turn.features.get(item.source.feature_id) : undefined;
  return feature?.geometry == null ? undefined : centroid(feature.geometry);
}

const showCard = (deps: ToolDependencies) => defineTool({
  name: 'show_card',
  description: 'Show the user a result card. Every specific recommendation (a place, an event, a stop on a walk, a historical fact about a place) '
    + 'goes in a card, not in plain text. Each item must cite a feature id or a URL that a tool returned in this turn. Keep getting_there under 80 '
    + 'characters and give times as full ISO 8601 with an offset, or leave time out. A plan gives each stop its location and says how the user '
    + 'travels in travel_mode; with "drive" the card adds the live parking near each stop by itself.',
  status: 'Preparing a card',
  readOnly: false,
  schema: z.strictObject({
    type: z.enum(['plan', 'history', 'list']).describe('plan lists stops in visiting order'),
    title: z.string().min(1).max(80),
    intro: z.string().max(300).optional(),
    travel_mode: travelModeSchema.optional().describe('Plans only: walk, transit, drive or cycle. drive adds live parking at each located stop'),
    items: z.array(modelCardItemSchema).min(1).max(13),
  }),
  detail(args) {
    return `"${args.title}" · ${args.items.length} ${args.items.length === 1 ? 'item' : 'items'}${args.type === 'plan' && args.travel_mode === 'drive' ? ' · with parking' : ''}`;
  },
  async run(args, turn, step) {
    const failing = args.items.flatMap((item, index) => {
      const ok = 'feature_id' in item.source ? turn.featureIds.has(item.source.feature_id) : turn.urls.has(item.source.url);
      return ok ? [] : [index];
    });
    if (failing.length > 0) {
      return toolError('unverified_sources', 'These items cite sources no tool returned in this turn; drop them or search for sources first.', { items: failing });
    }
    const plan = args.type === 'plan';
    const items: CardItem[] = args.items.map((item) => ({ ...item }));
    // A plan the user drives to carries the live parking at each stop it can place: its own step, read now.
    let parking: { stop: string; vacant: number; nearest_vacant_m: number | null }[] | undefined;
    if (plan && args.travel_mode === 'drive') {
      const stops = items.flatMap((item, index) => {
        const point = stopPoint(turn, item);
        return point === undefined ? [] : [{ index, point, name: item.title }];
      }).slice(0, PLAN_PARKING_STOPS);
      if (stops.length > 0) {
        const outcome = await runTool(planParkingTool(deps), turn, { stops });
        if (!isToolError(outcome)) {
          for (const { index, parking: stopParking } of (outcome as { stops: { index: number; parking: StopParking }[] }).stops) {
            items[index] = { ...items[index]!, location: stops.find((stop) => stop.index === index)!.point, stop_parking: stopParking };
          }
          parking = items.flatMap((item) => item.stop_parking === undefined ? []
            : [{ stop: item.title, vacant: item.stop_parking.vacant, nearest_vacant_m: item.stop_parking.bays[0]?.distance_m ?? null }]);
        }
      }
    }
    const placeIds = items.flatMap((item) => item.place_id === undefined ? [] : [item.place_id]);
    const attribution = placeIds.length === 0 ? undefined
      : { google_maps: placeIds.map((placeId) => ({ place_id: placeId, maps_uri: turn.places.get(placeId)?.maps_uri ?? null })) };
    const card = { id: turn.nextCardId(), type: args.type, title: args.title, ...(args.intro === undefined ? {} : { intro: args.intro }),
      ...(plan && args.travel_mode !== undefined ? { travel_mode: args.travel_mode } : {}),
      items, ...(attribution === undefined ? {} : { attribution }) };
    turn.cards.push(card);
    turn.sink.emit({ event: 'card', stepId: step.id, card });
    return { card_id: card.id, ...(parking === undefined ? {} : { parking,
      note: 'The card shows each stop\'s nearest free bays and the area rules; mention parking in one sentence at most, and that a vacant sensor is not permission to park.' }) };
  },
});

const routeWaypointSchema = z.union([latLngSchema, z.strictObject({ feature_id: z.string().min(1).max(256) })]);

const drawRoute = (deps: ToolDependencies) => defineTool({
  name: 'draw_route',
  description: 'Compute a walking or public transport route through stops, and draw it on the map unless draw is false. Use draw false to check '
    + "a candidate route's duration before committing to a plan. Waypoints are coordinates or feature ids from a search in this turn; the first is "
    + 'the start and the last the end. Transit takes exactly two waypoints.',
  status: 'Working out the route',
  readOnly: false,
  schema: z.strictObject({
    waypoints: z.array(routeWaypointSchema).min(2).max(13),
    mode: z.enum(['walk', 'transit']),
    draw: z.boolean().optional().describe('Default true'),
  }),
  detail(args) { return `${args.mode === 'walk' ? 'walking' : 'public transport'} · ${args.waypoints.length} stops`; },
  async run(args, turn, step) {
    if (args.mode === 'transit' && args.waypoints.length !== 2) return toolError('invalid_arguments', 'transit takes exactly 2 waypoints');
    const points: { lat: number; lng: number; label?: string }[] = [];
    for (const waypoint of args.waypoints) {
      if (!('feature_id' in waypoint)) { points.push({ lat: waypoint.lat, lng: waypoint.lng }); continue; }
      const item = turn.features.get(waypoint.feature_id);
      if (item === undefined || item.geometry === null) {
        return toolError('not_found', `No located feature ${waypoint.feature_id} was returned in this turn; search first or pass coordinates.`);
      }
      points.push({ ...centroid(item.geometry), label: item.title });
    }
    if (deps.routes === undefined || deps.routes === null) return toolError('upstream_unavailable', 'Routing is not configured in this environment.');
    let route;
    try {
      route = await deps.routes.compute({ waypoints: points, mode: args.mode, signal: turn.signal });
    } catch (error) {
      if (error instanceof RouteNotFoundError) return toolError('route_not_found', 'No route between these waypoints; use fewer waypoints or another mode.');
      throw error;
    }
    const draw = args.draw ?? true;
    if (draw) {
      const action = { action: 'draw_route' as const, args: { polyline: route.polyline, mode: args.mode, distance_m: route.distance_m,
        duration_min: route.duration_min, waypoints: points } };
      turn.uiActions.push(action);
      turn.sink.emit({ event: 'ui_action', stepId: step.id, ...action });
    }
    return { distance_m: route.distance_m, duration_min: route.duration_min, legs: route.legs.map(({ from, to, duration_min }) => ({ from, to, duration_min })), drawn: draw };
  },
});

const askUser = defineTool({
  name: 'ask_user',
  description: 'Ask the user one question, only when the request is ambiguous in a way the request context cannot resolve (for example, '
    + 'which of several gardens or anomaly markers they mean), or when a required input has no sensible default. Do not ask about '
    + 'preferences you can assume, and do not ask for confirmation: act, state your assumption, and let the user adjust. After you showed a plan '
    + 'card in this turn you may ask up to three questions about it (when they leave, how long they have, how they travel), all in the same '
    + 'response. Calling this ends your turn.',
  status: 'Asking you a question',
  readOnly: false,
  schema: z.strictObject({
    question: z.string().min(1).max(200),
    options: z.array(z.string().min(1).max(40)).min(2).max(4),
    allow_free_text: z.boolean().optional().describe('Default true'),
  }),
  detail(args) { return args.question; },
  async run(args, turn, step) {
    // Questions after a plan are about that plan: their answers come back with the whole card (agent-protocol.md, Questions about a plan).
    const plan = turn.cards.findLast((card) => card.type === 'plan');
    const limit = plan === undefined ? QUESTION_LIMITS.perTurn : QUESTION_LIMITS.perPlanTurn;
    if (turn.questions.length >= limit) {
      return toolError('invalid_arguments', plan === undefined ? 'Ask one question per turn.' : `Ask at most ${limit} questions about a plan.`);
    }
    const question = { id: turn.nextQuestionId(), text: args.question, options: args.options, allowFreeText: args.allow_free_text ?? true,
      ...(plan === undefined ? {} : { planCardId: plan.id }) };
    turn.questions.push(question);
    turn.sink.emit({ event: 'question', stepId: step.id, question });
    return { question_id: question.id };
  },
});

export interface GroundedAnswer {
  readonly answer: string;
  readonly sources: readonly { readonly title: string; readonly url: string }[];
  readonly places: readonly { readonly title: string; readonly place_id: string; readonly maps_uri: string }[];
  readonly searchEntryPoint: string | null;
}

const GROUNDING_TTL_MS: Record<'maps' | 'search', number> = { maps: 12 * HOUR, search: 6 * HOUR };

function groundingKey(kind: 'maps' | 'search', question: string, location: LatLng | null, now: Date): string {
  const cell = location === null ? '-' : `${location.lat.toFixed(2)},${location.lng.toFixed(2)}`;
  return `ground:${kind}:${question.trim().toLowerCase().replace(/\s+/g, ' ')}:${cell}:${melbourneDate(now)}`;
}

/**
 * One grounded Gemini call, shared by the two grounding tools and the workflows. Answers are cached across users by
 * tool, normalised question, place cell and date, because grounding is billed per call; a call that outlasts the
 * grounding timeout returns `upstream_unavailable`. Whatever the answer cites is registered as a source for this turn.
 */
export async function grounded(deps: ToolDependencies, turn: TurnRegistry, kind: 'maps' | 'search', question: string,
  location: LatLng | null, options: { readonly timeoutMs?: number } = {}): Promise<GroundedAnswer | ToolError> {
  if (deps.grounding === null) return toolError('upstream_unavailable', 'Grounding is not configured in this environment.');
  const maps = kind === 'maps';
  const timeoutMs = options.timeoutMs ?? deps.groundingTimeoutMs ?? DEFAULT_GROUNDING_TIMEOUT_MS;
  const outcome = await cached<GroundedAnswer | ToolError>(deps.cache, groundingKey(kind, question, maps ? location : null, turn.now()), GROUNDING_TTL_MS[kind], async () => {
    const startedAt = turn.now().getTime();
    // The call gives up after the configured time, so a slow grounding service costs the turn one tool error, not minutes.
    const timeout = AbortSignal.timeout(timeoutMs);
    let result;
    try {
      result = await deps.grounding!.ground({ kind, question, location, signal: AbortSignal.any([turn.signal, timeout]) });
    } catch (error) {
      if (!timeout.aborted || turn.signal.aborted) throw error;
      turn.turn.log?.({ severity: 'WARNING', event: 'groundingTimedOut', turnId: turn.turn.turnId, tool: maps ? 'maps_grounding' : 'search_grounding', timeoutMs });
      return toolError('upstream_unavailable', `Google ${maps ? 'Maps' : 'Search'} grounding did not answer within ${Math.round(timeoutMs / 1000)} seconds; `
        + 'answer with the map data you have and say what is missing.', { timeoutMs });
    }
    const usage = turn.usage.record(result.usage, { agent: `grounding:${kind}`, model: result.model, durationMs: turn.now().getTime() - startedAt });
    turn.sink.emit({ event: 'usage', call: usage, turn: turn.usage.turn });
    return { answer: result.answer, sources: result.sources, places: result.places, searchEntryPoint: result.searchEntryPoint };
  }, (value) => !isToolError(value));
  const value = outcome.value;
  if (isToolError(value)) return value;
  for (const source of value.sources) turn.urls.add(source.url);
  for (const place of value.places) { turn.places.set(place.place_id, place); turn.urls.add(place.maps_uri); }
  return value;
}

function groundingTool(kind: 'maps' | 'search', deps: ToolDependencies): ToolSpec<z.ZodObject> {
  const maps = kind === 'maps';
  return defineTool({
    name: maps ? 'maps_grounding' : 'search_grounding',
    description: maps
      ? 'Ask Google Maps for the details of one specific place: its opening hours, rating, what it is like, where exactly it is. Slow, often a '
        + 'minute: use it only when the user asks about a specific place our map layers do not carry (a café, a shop, a park), after search_features. '
        + 'Not for finding venues, events or things to do: the layers and search_grounding cover those. Ask in English.'
      : 'Search the web for facts our data does not cover: opening details, parking rules, weather, what happened somewhere recently, background '
        + 'on an event, general questions about Melbourne. Use it only when no map tool can answer or their results leave a gap; try search_features '
        + 'or nearby_context first. Prefer it over maps_grounding for anything that is not one place\'s details. Cite the sources it returns.',
    status: maps ? 'Checking Google Maps' : 'Searching the web',
    readOnly: true,
    schema: maps
      ? z.strictObject({ question: z.string().min(1).max(300), location: latLngSchema.optional().describe("Defaults to the centre of the user's viewport") })
      : z.strictObject({ question: z.string().min(1).max(300) }),
    detail(args) { return (args as { question: string }).question; },
    async run(args, turn) {
      const viewport = turn.turn.request.context.viewport;
      const location = maps ? (args as { location?: LatLng }).location ?? { lat: (viewport.north + viewport.south) / 2, lng: (viewport.east + viewport.west) / 2 } : null;
      const result = await grounded(deps, turn, kind, (args as { question: string }).question, location);
      if (isToolError(result)) return result;
      return maps
        ? { answer: result.answer, places: result.places, attribution: { google_maps: true } }
        : { answer: result.answer, sources: result.sources, search_entry_point: result.searchEntryPoint };
    },
  });
}

/** The registry for one turn: every tool bound to the turn's registry and dependencies. */
export function toolSpecs(deps: ToolDependencies): ToolSpec<z.ZodObject>[] {
  return [searchFeatures(deps), getFeature(deps), getAnomaly(deps), nearbyContext(deps), showLayers, focusMap(deps), drawRoute(deps), highlightFeatures(deps), showCard(deps), askUser,
    areaBriefTool(deps), analyseAnomalyTool(deps), findParkingTool(deps), groundingTool('maps', deps), groundingTool('search', deps)];
}

export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['search_features', 'get_feature', 'get_anomaly', 'nearby_context', 'maps_grounding', 'search_grounding']);
export type { LayerId };
