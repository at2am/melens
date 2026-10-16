import type { MapItem } from '@melens/shared/contracts/map-contract';
import { z } from 'zod';

import { melbourneDate, melbourneHourLabel, toMelbourneIso } from '../agent/time.js';
import { cached } from '../cache.js';
import { centroid, compactFeature, type CompactFeature } from '../features/compact.js';
import { turnSearchTime } from '../features/turn-search.js';
import { latLngSchema, type Card, type CardItem, type LatLng } from '../protocol/schemas.js';
import { grounded, searchArea, resolveFeature, distanceLabel, windowOf, HOUR, type Area, type ToolDependencies } from '../tools/catalog.js';
import { defineTool, isToolError, toolError, type ToolSpec, type TurnRegistry } from '../tools/define.js';

/** Workflow grounding may take longer than a chat tool call: nobody waits on it step by step, and the card is cached for everyone. */
const WORKFLOW_GROUNDING_TIMEOUT_MS = 75_000;

const SYSTEM = 'You write short, factual map cards for Melbourne, Australia, in English. Use only the numbered sources you are given: '
  + 'cite one source reference per item exactly as written, never invent places, times or references, and never state a cause as fact.';

/** One model generation for a workflow, reported like every other call. */
async function generate<S extends z.ZodType>(deps: ToolDependencies, turn: TurnRegistry, agent: string, prompt: string, schema: S): Promise<z.output<S>> {
  const startedAt = turn.now().getTime();
  const result = await deps.structured!.generate({ system: SYSTEM, prompt, schema, signal: turn.signal });
  const usage = turn.usage.record(result.usage, { agent, model: result.model, durationMs: turn.now().getTime() - startedAt });
  turn.sink.emit({ event: 'usage', call: usage, turn: turn.usage.turn });
  return result.value;
}

const WALK_METRES_PER_MINUTE = 80;
function walkLabel(metres: number | null): string | undefined {
  if (metres === null) return undefined;
  const minutes = Math.max(1, Math.round(metres / WALK_METRES_PER_MINUTE));
  return `${minutes} min walk`;
}
function clip(text: string, limit: number): string { return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`; }

/** The numbered sources a generation may cite: feature ids and the URLs a grounded answer returned. */
class SourceBook {
  private readonly entries: { readonly ref: string; readonly source: CardItem['source']; readonly label: string; readonly feature: CompactFeature | null }[] = [];
  addFeature(feature: CompactFeature): string {
    const ref = `F${this.entries.length + 1}`;
    this.entries.push({ ref, source: { feature_id: feature.id }, label: feature.title, feature });
    return ref;
  }
  addUrl(url: string, title: string): string {
    const ref = `W${this.entries.length + 1}`;
    this.entries.push({ ref, source: { url, title: clip(title, 200) }, label: title, feature: null });
    return ref;
  }
  get(ref: string) { return this.entries.find((entry) => entry.ref === ref); }
  get size(): number { return this.entries.length; }
}

function featureLine(ref: string, feature: CompactFeature): string {
  const when = feature.valid_from === null ? '' : ` | ${feature.valid_from}${feature.valid_to === null ? '' : ` to ${feature.valid_to}`}`;
  const away = feature.distance_m === null ? '' : ` | ${distanceLabel(feature.distance_m)} away`;
  return `${ref} [${feature.layer}] ${feature.title}${away}${when}${feature.summary === null ? '' : ` | ${clip(feature.summary, 160)}`}`;
}

const PREDICTION_NOTE = 'Items marked is_prediction are predictions; say so.';

interface WorkflowSummary { readonly card_id: string | null; readonly summary: string }

/** Re-emits a cached workflow card as this turn's own, with a fresh card id and every source registered. */
function replayCard(turn: TurnRegistry, step: { id: string }, cardless: Omit<Card, 'id'>, ids: readonly string[], urls: readonly string[]): string {
  for (const id of ids) turn.featureIds.add(id);
  for (const url of urls) turn.urls.add(url);
  const card: Card = { id: turn.nextCardId(), ...cardless };
  turn.cards.push(card);
  turn.sink.emit({ event: 'card', stepId: step.id, card });
  return card.id;
}

interface CachedWorkflow { readonly card: Omit<Card, 'id'>; readonly summary: string; readonly featureIds: readonly string[]; readonly urls: readonly string[] }

function sourceIds(items: readonly CardItem[]): { ids: string[]; urls: string[] } {
  return { ids: items.flatMap((item) => 'feature_id' in item.source ? [item.source.feature_id] : []),
    urls: items.flatMap((item) => 'url' in item.source ? [item.source.url] : []) };
}

// ---------------------------------------------------------------------------------------------------------------
// area_brief (UC-02)

const AREA_CELL_DEGREES = 0.004;
const areaBriefOutput = z.strictObject({
  character: z.string().max(300).describe('One or two sentences on what this neighbourhood is like, from the sources only'),
  places: z.array(z.strictObject({ ref: z.string(), name: z.string().max(80), reason: z.string().max(200) })).max(5)
    .describe('Recommended places: venues, sites or points of interest from the sources'),
  activities: z.array(z.strictObject({ ref: z.string(), name: z.string().max(80), reason: z.string().max(200) })).max(5)
    .describe('Upcoming or ongoing activities and events from the sources'),
});

export const areaBriefTool = (deps: ToolDependencies): ToolSpec<z.ZodObject> => defineTool({
  name: 'area_brief',
  description: 'Build the standard area card for a point: neighbourhood character, recommended places and upcoming activities. Use it when the user '
    + 'asks what an area is like or what is around them. It shows the card to the user, so do not repeat the card\'s content in text.',
  status: 'Looking around this area',
  readOnly: false,
  schema: z.strictObject({ point: latLngSchema, radius_m: z.number().int().min(200).max(1_500).optional().describe('Default 600') }),
  detail(args) { return `within ${distanceLabel(args.radius_m ?? 600)} of ${args.point.lat.toFixed(4)}, ${args.point.lng.toFixed(4)}`; },
  async run(args, turn, step): Promise<WorkflowSummary | ReturnType<typeof toolError>> {
    if (deps.structured === undefined || deps.structured === null) return toolError('upstream_unavailable', 'The workflow model is not configured in this environment.');
    const radius = args.radius_m ?? 600;
    const key = `area_brief:${Math.round(args.point.lat / AREA_CELL_DEGREES)}:${Math.round(args.point.lng / AREA_CELL_DEGREES)}:${radius}:${melbourneDate(turn.now())}`;
    // A card written while Search grounding failed is shown but not shared with other users' turns.
    let complete = true;
    const outcome = await cached<CachedWorkflow | WorkflowSummary>(deps.cache, key, 3 * HOUR, async () => {
      const now = turn.now();
      const area: Area = { center: args.point, radius_m: radius };
      const window = windowOf(undefined, turnSearchTime(turn), { back: 12 * HOUR, ahead: 7 * 24 * HOUR })!;
      // Fetch in parallel: layer features, and a Search-grounded answer for places the layers do not carry.
      const [found, grounding] = await Promise.all([
        searchArea(deps, turn, area, ['event', 'disruption', 'news', 'planning'], window),
        grounded(deps, turn, 'search', `What is the character of the Melbourne area around latitude ${args.point.lat.toFixed(4)}, longitude ${args.point.lng.toFixed(4)}, `
          + 'and which notable places, cafés, galleries or landmarks are within a short walk?', null, { timeoutMs: WORKFLOW_GROUNDING_TIMEOUT_MS }).catch(() => null),
      ]);
      const book = new SourceBook();
      const lines: string[] = [];
      for (const feature of found.features.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0)).slice(0, 40)) lines.push(featureLine(book.addFeature(feature), feature));
      let groundingText = '';
      if (grounding !== null && !isToolError(grounding)) {
        groundingText = grounding.answer;
        for (const source of grounding.sources.slice(0, 6)) lines.push(`${book.addUrl(source.url, source.title)} [web] ${source.title}`);
      } else { complete = false; }
      if (book.size === 0) return { card_id: null, summary: 'Nothing on the Melens map or from search near this point.' };
      const output = await generate(deps, turn, 'area_brief', [
        `Area: ${radius} m around ${args.point.lat.toFixed(5)}, ${args.point.lng.toFixed(5)}. Local time ${toMelbourneIso(now)}.`,
        PREDICTION_NOTE, 'Sources (cite the reference in "ref"):', ...lines,
        ...(groundingText === '' ? [] : ['', `Search answer about the area (background only; cite W references, not this text): ${clip(groundingText, 900)}`]),
      ].join('\n'), areaBriefOutput);
      const items: CardItem[] = [];
      for (const [section, picks] of [['place', output.places], ['activity', output.activities]] as const) {
        for (const pick of picks) {
          const entry = book.get(pick.ref);
          if (entry === undefined) continue; // an item without a source from this turn is dropped
          const feature = entry.feature;
          if (section === 'activity' && (feature === null || feature.valid_from === null)) continue;
          const time = feature?.valid_from == null ? undefined : { from: feature.valid_from, ...(feature.valid_to === null ? {} : { to: feature.valid_to }) };
          const walk = walkLabel(feature?.distance_m ?? null);
          items.push({ title: clip(pick.name, 80), summary: clip(pick.reason, 240), source: entry.source,
            ...(feature === null ? {} : { location: { lat: feature.lat, lng: feature.lng } }),
            ...(time === undefined ? {} : { time }), ...(walk === undefined ? {} : { getting_there: walk }) });
        }
      }
      if (items.length === 0) return { card_id: null, summary: 'Nothing with a source to recommend near this point.' };
      const card: Omit<Card, 'id'> = { type: 'area_brief', title: 'Around here', intro: clip(output.character, 300), items: items.slice(0, 13) };
      const { ids, urls } = sourceIds(card.items);
      return { card, summary: `${output.character} ${items.map((item) => `${item.title} (${'feature_id' in item.source ? item.source.feature_id : item.source.url})`).join('; ')}`.slice(0, 500),
        featureIds: ids, urls };
    }, (value) => complete && 'card' in value);
    const value = outcome.value;
    if (!('card' in value)) return value as WorkflowSummary;
    // Whether fresh or cached, every cited source must be known to this turn before the card goes out.
    for (const id of value.featureIds) turn.featureIds.add(id);
    const cardId = replayCard(turn, step, value.card, value.featureIds, value.urls);
    return { card_id: cardId, summary: value.summary };
  },
});

// ---------------------------------------------------------------------------------------------------------------
// analyse_anomaly (UC-04)

const analysisOutput = z.strictObject({
  headline: z.string().max(300).describe('One sentence: how much higher or lower than usual, and where'),
  causes: z.array(z.strictObject({
    ref: z.string(), cause: z.string().max(80), confidence: z.enum(['low', 'medium', 'high']), reason: z.string().max(200),
  })).max(5).describe('Possible causes, most likely first; never stated as fact'),
});

function describeAnomaly(item: Extract<MapItem, { kind: 'anomaly' }>): string {
  const d = item.details;
  const change = d.observedValue !== null && d.baselineValue !== null && d.baselineValue !== 0
    ? `${Math.round(Math.abs(d.observedValue - d.baselineValue) / d.baselineValue * 100)}% ${d.direction}` : d.direction;
  return `${item.title}: ${d.observedValue ?? '?'} people counted against a usual ${d.baselineValue ?? '?'} (${change}), `
    + `${melbourneHourLabel(new Date(d.window.from), new Date(d.window.to))}`;
}

export const analyseAnomalyTool = (deps: ToolDependencies): ToolSpec<z.ZodObject> => defineTool({
  name: 'analyse_anomaly',
  description: 'Explain a pedestrian anomaly: possible causes with a confidence level and sources, from nearby news, events and disruptions. '
    + 'Use it for "why is it so busy here" when there is an anomaly marker nearby. It shows the card to the user.',
  status: 'Analysing the pedestrian anomaly',
  readOnly: false,
  schema: z.strictObject({ feature_id: z.string().min(1).max(256).describe('The id of a feature in the anomaly layer') }),
  detail(args, turn) { return turn.features.get(args.feature_id)?.title ?? args.feature_id; },
  async run(args, turn, step) {
    if (deps.structured === undefined || deps.structured === null) return toolError('upstream_unavailable', 'The workflow model is not configured in this environment.');
    const anomaly = await resolveFeature(deps, turn, args.feature_id);
    if (anomaly === undefined) return toolError('not_found', 'No feature with this id is on the map the user is looking at.');
    if (anomaly.kind !== 'anomaly') return toolError('not_an_anomaly', 'This feature is not a pedestrian anomaly; use nearby_context or search_features instead.');
    turn.rememberFeatures([anomaly]);
    if (anomaly.geometry === null) return toolError('not_found', 'This anomaly has no location.');
    const here: LatLng = centroid(anomaly.geometry);
    // An anomaly does not change, so one analysis serves every user (unless Search grounding failed while it was written).
    let complete = true;
    const outcome = await cached<CachedWorkflow>(deps.cache, `analyse_anomaly:${anomaly.id}:${anomaly.versionId}`, 24 * HOUR, async () => {
      const from = new Date(anomaly.details.window.from).getTime();
      const to = new Date(anomaly.details.window.to).getTime();
      const window = windowOf({ from: toMelbourneIso(new Date(from - 12 * HOUR)), to: toMelbourneIso(new Date(Math.max(to, from) + 6 * HOUR)) }, turn.now(), { back: 0, ahead: 0 })!;
      const area: Area = { center: here, radius_m: 1_500 };
      const place = anomaly.title;
      const [found, grounding] = await Promise.all([
        searchArea(deps, turn, area, ['news', 'event', 'disruption'], window),
        grounded(deps, turn, 'search', `What events, road or tram disruptions, closures or news around ${place}, Melbourne on `
          + `${melbourneDate(new Date(from))} could explain ${anomaly.details.direction === 'lower' ? 'unusually low' : 'unusually high'} foot traffic?`, null, { timeoutMs: WORKFLOW_GROUNDING_TIMEOUT_MS }).catch(() => null),
      ]);
      const book = new SourceBook();
      const lines: string[] = [];
      for (const feature of found.features.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0)).slice(0, 30)) lines.push(featureLine(book.addFeature(feature), feature));
      let groundingText = '';
      if (grounding !== null && !isToolError(grounding)) {
        groundingText = grounding.answer;
        for (const source of grounding.sources.slice(0, 6)) lines.push(`${book.addUrl(source.url, source.title)} [web] ${source.title}`);
      } else { complete = false; }
      const anomalyRef = book.addFeature(compactFeature(anomaly, here)!);
      const headlineFacts = describeAnomaly(anomaly);
      let output: z.output<typeof analysisOutput> = { headline: clip(headlineFacts, 300), causes: [] };
      if (book.size > 1) {
        output = await generate(deps, turn, 'analyse_anomaly', [
          `Anomaly (${anomalyRef}): ${headlineFacts}.`, 'Possible causes may only come from these nearby sources (cite the reference in "ref"). '
          + 'If none plausibly explains the change, return no causes.', ...lines,
          ...(groundingText === '' ? [] : ['', `Search answer (background only; cite W references, not this text): ${clip(groundingText, 900)}`]),
        ].join('\n'), analysisOutput);
      }
      const items: CardItem[] = [];
      for (const cause of output.causes) {
        const entry = book.get(cause.ref);
        if (entry === undefined || cause.ref === anomalyRef) continue; // no source from this turn, no cause
        items.push({ title: clip(cause.cause, 80), summary: clip(`Confidence ${cause.confidence}. ${cause.reason}`, 240), source: entry.source,
          ...(entry.feature === null ? {} : { location: { lat: entry.feature.lat, lng: entry.feature.lng } }) });
      }
      if (items.length === 0) {
        items.push(complete
          ? { title: 'No clear cause found', summary: 'Confidence low. No nearby news, events or disruptions in the data explain this change.',
            source: { feature_id: anomaly.id }, location: here }
          : { title: 'Analysis incomplete', summary: 'Confidence low. The web search for nearby events did not answer in time, so no cause was checked. Try again.',
            source: { feature_id: anomaly.id }, location: here });
      }
      const card: Omit<Card, 'id'> = { type: 'anomaly_analysis', title: 'Why is it unusual here?', intro: clip(output.headline, 300), items };
      const { ids, urls } = sourceIds(items);
      return { card, summary: `${output.headline} Possible causes: ${items.map((item) => `${item.title} (${item.summary?.split('.')[0]?.toLowerCase() ?? ''})`).join('; ')}`.slice(0, 500),
        featureIds: [...ids, anomaly.id], urls };
    }, () => complete);
    const cardId = replayCard(turn, step, outcome.value.card, outcome.value.featureIds, outcome.value.urls);
    return { card_id: cardId, summary: outcome.value.summary };
  },
});
