import type { LayerId, MapGeometry, MapItem } from '@melens/shared/contracts/map-contract';
import { z } from 'zod';

import type { GroundingModel } from '../agent/grounding.js';
import { toInstant } from '../agent/time.js';
import { centroid, compactFeature, haversineMeters, matchesKeywords, type CompactFeature } from '../features/compact.js';
import type { FeatureReader } from '../features/reader.js';
import { cardItemSchema, latLngSchema, timeWindowSchema, type LatLng } from '../protocol/schemas.js';
import { defineTool, toolError, type ToolSpec, type TurnRegistry } from './define.js';

/** The layers the agent can search: the point-feature layers of map contract v1 (tools.md, Shared types). */
export const toolLayerSchema = z.enum(['pedestrian', 'anomaly', 'disruption', 'event', 'news', 'planning']);
export type ToolLayer = z.infer<typeof toolLayerSchema>;
const DEFAULT_LAYERS: readonly ToolLayer[] = ['event', 'disruption', 'news', 'planning', 'pedestrian', 'anomaly'];

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
type Area = z.infer<typeof areaSchema>;

function metresToDegreesLat(metres: number): number { return metres / 111_320; }
function metresToDegreesLng(metres: number, lat: number): number { return metres / (111_320 * Math.cos(lat * Math.PI / 180)); }

function boxOf(area: Area): { readonly bbox: [number, number, number, number]; readonly centre: LatLng; readonly radius: number | null } {
  if (area.bbox !== undefined) {
    return { bbox: [area.bbox.west, area.bbox.south, area.bbox.east, area.bbox.north],
      centre: { lat: (area.bbox.north + area.bbox.south) / 2, lng: (area.bbox.east + area.bbox.west) / 2 }, radius: null };
  }
  const centre = area.center!;
  const radius = area.radius_m!;
  return { bbox: [centre.lng - metresToDegreesLng(radius, centre.lat), centre.lat - metresToDegreesLat(radius),
    centre.lng + metresToDegreesLng(radius, centre.lat), centre.lat + metresToDegreesLat(radius)], centre, radius };
}

const HOUR = 60 * 60 * 1_000;

function windowOf(time: { from?: string | undefined; to?: string | undefined } | undefined, now: Date, defaults: { readonly back: number; readonly ahead: number }) {
  const from = time?.from === undefined ? new Date(now.getTime() - defaults.back) : new Date(time.from);
  const to = time?.to === undefined ? new Date(now.getTime() + defaults.ahead) : new Date(time.to);
  if (!(from.getTime() < to.getTime())) return null;
  return { from: toInstant(from), to: toInstant(to) };
}

function overlaps(feature: CompactFeature, window: { from: string; to: string }): boolean {
  const from = feature.valid_from === null ? null : new Date(feature.valid_from).getTime();
  const to = feature.valid_to === null ? null : new Date(feature.valid_to).getTime();
  const start = new Date(window.from).getTime();
  const end = new Date(window.to).getTime();
  return (from === null || from < end) && (to === null || to > start);
}

export interface ToolDependencies {
  readonly features: FeatureReader;
  readonly grounding: GroundingModel | null;
}

interface SearchOutcome { readonly features: CompactFeature[]; readonly states: Record<string, string> }

async function searchArea(deps: ToolDependencies, turn: TurnRegistry, area: Area, layers: readonly ToolLayer[],
  window: { from: string; to: string }): Promise<SearchOutcome> {
  const { bbox, centre, radius } = boxOf(area);
  const results = await deps.features.search({ requestId: `${turn.turn.turnId}-${turn.trace.length}`, bbox, layers,
    window, mode: 'current', signal: turn.signal });
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

const searchFeatures = (deps: ToolDependencies) => defineTool({
  name: 'search_features',
  description: 'Find map features (events, transport disruptions, news, planning applications, pedestrian sensors, anomalies) in an area, '
    + 'optionally filtered by layer, time window and keywords. Use it before recommending or describing anything on the map, and cite the ids it returns.',
  status: 'Searching the map',
  readOnly: true,
  schema: z.strictObject({
    area: areaSchema,
    layers: z.array(toolLayerSchema).min(1).max(6).optional().describe('Defaults to the layers visible on the map'),
    time: timeWindowSchema.optional().describe('Keeps features valid at some point in the window; Melbourne local time with offset'),
    query: z.string().max(100).optional().describe('Keyword match on title and summary'),
    sort: z.enum(['distance', 'time']).optional().describe('Default distance from the area centre'),
    limit: z.number().int().min(1).max(50).optional().describe('1 to 50, default 20'),
  }),
  async run(args, turn) {
    const now = turn.now();
    const window = windowOf(args.time, now, { back: 24 * HOUR, ahead: 24 * HOUR });
    if (window === null) return toolError('invalid_arguments', 'time.from must be before time.to');
    const contextLayers = turn.turn.request.context.layers.filter((layer): layer is ToolLayer => toolLayerSchema.safeParse(layer).success);
    const layers = args.layers ?? (contextLayers.length > 0 ? contextLayers : DEFAULT_LAYERS);
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

const getFeature = defineTool({
  name: 'get_feature',
  description: "Get the full record of one map feature: an event's full description, a disruption's affected segments, a news item's full summary. "
    + 'Use it when a search result is not enough to answer. The feature must come from a search in this conversation.',
  status: 'Reading the details',
  readOnly: true,
  schema: z.strictObject({ id: z.string().min(1).max(256).describe('A feature id returned by search_features or nearby_context') }),
  async run(args, turn) {
    const item = turn.features.get(args.id);
    if (item === undefined) return toolError('not_found', 'No feature with this id was returned in this conversation; search first.');
    const full: MapItem = item.geometry === null ? item : { ...item, geometry: simplify(item.geometry) };
    return { item: full };
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
  async run(args, turn) {
    const window = windowOf(args.time, turn.now(), { back: 24 * HOUR, ahead: 6 * HOUR });
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
  status: null,
  readOnly: false,
  schema: z.strictObject({
    layers: z.array(toolLayerSchema).min(1).max(6),
    mode: z.enum(['only', 'add', 'remove']).optional().describe('Default add; only hides every other layer'),
    filter: z.strictObject({ categories: z.array(z.string().min(1).max(40)).max(10).optional(), time: timeWindowSchema.optional() }).optional(),
  }),
  async run(args, turn) {
    const current = new Set<string>(turn.turn.request.context.layers);
    const mode = args.mode ?? 'add';
    const visible = mode === 'only' ? new Set<string>(args.layers)
      : mode === 'remove' ? new Set([...current].filter((layer) => !args.layers.includes(layer as ToolLayer)))
        : new Set([...current, ...args.layers]);
    const action = { action: 'show_layers' as const, args: { layers: args.layers, mode, ...(args.filter === undefined ? {} : { filter: args.filter }) } };
    turn.uiActions.push(action);
    turn.sink.emit({ event: 'ui_action', ...action });
    return { ok: true, visible_layers: [...visible] };
  },
});

const focusMap = defineTool({
  name: 'focus_map',
  description: 'Move the map to a place, an area or a feature. Use it when the user asks to go somewhere or look at something, '
    + 'and before showing results that are off screen.',
  status: null,
  readOnly: false,
  schema: z.strictObject({
    target: z.strictObject({ point: latLngSchema.optional(), bbox: bboxSchema.optional(), feature_id: z.string().min(1).max(256).optional() })
      .refine((target) => [target.point, target.bbox, target.feature_id].filter((value) => value !== undefined).length === 1,
        'Give exactly one of point, bbox or feature_id'),
    zoom: z.number().int().min(10).max(20).optional().describe('The app picks one if omitted'),
  }),
  async run(args, turn) {
    let target: Record<string, unknown> = args.target;
    if (args.target.feature_id !== undefined) {
      const item = turn.features.get(args.target.feature_id);
      if (item === undefined || item.geometry === null) return toolError('not_found', 'No located feature with this id was returned in this conversation.');
      target = { feature_id: args.target.feature_id, point: centroid(item.geometry) };
    }
    const action = { action: 'focus_map' as const, args: { target, ...(args.zoom === undefined ? {} : { zoom: args.zoom }) } };
    turn.uiActions.push(action);
    turn.sink.emit({ event: 'ui_action', ...action });
    return { ok: true };
  },
});

const highlightFeatures = defineTool({
  name: 'highlight_features',
  description: 'Highlight features on the map, such as the places you are talking about. Pass feature ids only; places from Google Maps '
    + 'appear as pins in their card instead.',
  status: null,
  readOnly: false,
  schema: z.strictObject({
    ids: z.array(z.string().min(1).max(256)).min(1).max(30),
    clear_previous: z.boolean().optional().describe('Default true'),
  }),
  async run(args, turn) {
    const found = args.ids.filter((id) => turn.features.has(id));
    const missing = args.ids.filter((id) => !turn.features.has(id));
    const action = { action: 'highlight_features' as const, args: { ids: found, clear_previous: args.clear_previous ?? true, missing } };
    turn.uiActions.push(action);
    turn.sink.emit({ event: 'ui_action', ...action });
    return { ok: true, missing };
  },
});

const showCard = defineTool({
  name: 'show_card',
  description: 'Show the user a result card. Every specific recommendation (a place, an event, a stop on a walk, a historical fact about a place) '
    + 'goes in a card, not in plain text. Each item must cite a feature id or a URL that a tool returned in this turn.',
  status: null,
  readOnly: false,
  schema: z.strictObject({
    type: z.enum(['plan', 'history', 'list']).describe('plan lists stops in visiting order'),
    title: z.string().min(1).max(80),
    intro: z.string().max(300).optional(),
    items: z.array(cardItemSchema).min(1).max(13),
  }),
  async run(args, turn) {
    const failing = args.items.flatMap((item, index) => {
      const ok = 'feature_id' in item.source ? turn.featureIds.has(item.source.feature_id) : turn.urls.has(item.source.url);
      return ok ? [] : [index];
    });
    if (failing.length > 0) {
      return toolError('unverified_sources', 'These items cite sources no tool returned in this turn; drop them or search for sources first.', { items: failing });
    }
    const placeIds = args.items.flatMap((item) => item.place_id === undefined ? [] : [item.place_id]);
    const attribution = placeIds.length === 0 ? undefined
      : { google_maps: placeIds.map((placeId) => ({ place_id: placeId, maps_uri: turn.places.get(placeId)?.maps_uri ?? null })) };
    const card = { id: turn.nextCardId(), type: args.type, title: args.title, ...(args.intro === undefined ? {} : { intro: args.intro }),
      items: args.items, ...(attribution === undefined ? {} : { attribution }) };
    turn.cards.push(card);
    turn.sink.emit({ event: 'card', card });
    return { card_id: card.id };
  },
});

const askUser = defineTool({
  name: 'ask_user',
  description: 'Ask the user one question, only when the request is ambiguous in a way the request context cannot resolve (for example, '
    + 'which of several gardens or anomaly markers they mean), or when a required input has no sensible default. Do not ask about '
    + 'preferences you can assume, and do not ask for confirmation: act, state your assumption, and let the user adjust. Calling this ends your turn.',
  status: null,
  readOnly: false,
  schema: z.strictObject({
    question: z.string().min(1).max(200),
    options: z.array(z.string().min(1).max(40)).min(2).max(4),
    allow_free_text: z.boolean().optional().describe('Default true'),
  }),
  async run(args, turn) {
    const question = { id: turn.nextQuestionId(), text: args.question, options: args.options, allowFreeText: args.allow_free_text ?? true };
    turn.asked = question;
    turn.sink.emit({ event: 'question', question });
    return { question_id: question.id };
  },
});

function groundingTool(kind: 'maps' | 'search', deps: ToolDependencies): ToolSpec<z.ZodObject> {
  const maps = kind === 'maps';
  return defineTool({
    name: maps ? 'maps_grounding' : 'search_grounding',
    description: maps
      ? 'Ask Google Maps about places near a location: what is there, opening hours, ratings, what a place is like. Use it for places that '
        + 'are not on our map layers, such as cafés, bookstores and parks. Ask in English.'
      : 'Search the web for facts our data does not cover: opening details, what happened somewhere recently, background on an event, '
        + 'general questions about Melbourne. Cite the sources it returns.',
    status: maps ? 'Checking Google Maps' : 'Searching the web',
    readOnly: true,
    schema: maps
      ? z.strictObject({ question: z.string().min(1).max(300), location: latLngSchema.optional().describe("Defaults to the centre of the user's viewport") })
      : z.strictObject({ question: z.string().min(1).max(300) }),
    async run(args, turn) {
      if (deps.grounding === null) return toolError('upstream_unavailable', 'Grounding is not configured in this environment.');
      const viewport = turn.turn.request.context.viewport;
      const location = maps ? (args as { location?: LatLng }).location ?? { lat: (viewport.north + viewport.south) / 2, lng: (viewport.east + viewport.west) / 2 } : null;
      const startedAt = turn.now().getTime();
      const result = await deps.grounding.ground({ kind, question: (args as { question: string }).question, location, signal: turn.signal });
      const usage = turn.usage.record(result.usage, { agent: `grounding:${kind}`, model: result.model, durationMs: turn.now().getTime() - startedAt });
      turn.sink.emit({ event: 'usage', call: usage, turn: turn.usage.turn });
      for (const source of result.sources) turn.urls.add(source.url);
      for (const place of result.places) { turn.places.set(place.place_id, place); turn.urls.add(place.maps_uri); }
      return maps
        ? { answer: result.answer, places: result.places, attribution: { google_maps: true } }
        : { answer: result.answer, sources: result.sources, search_entry_point: result.searchEntryPoint };
    },
  });
}

/** The registry for one turn: every tool bound to the turn's registry and dependencies. */
export function toolSpecs(deps: ToolDependencies): ToolSpec<z.ZodObject>[] {
  return [searchFeatures(deps), getFeature, nearbyContext(deps), showLayers, focusMap, highlightFeatures, showCard, askUser,
    groundingTool('maps', deps), groundingTool('search', deps)];
}

export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['search_features', 'get_feature', 'nearby_context', 'maps_grounding', 'search_grounding']);
export type { LayerId };
