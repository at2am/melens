import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MAP_SCHEMA_VERSION = 1;
export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_PAGE_ITEMS = 1_000;
export const SNAPSHOT_TTL_MS = 5 * 60 * 1_000;
export const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;
export const SERVICE_BBOX = [144, -39, 146.5, -37] satisfies [number, number, number, number];

const nonemptyString = z.string().min(1).max(4_096).refine((value) => value.trim().length > 0, 'String must not be blank');
/** Opaque ids on the wire: source ids, record ids, versions, request ids. */
export const identifierSchema = z.string().min(1).max(256).regex(/^\S+$/);
const identifier = identifierSchema;
const count = z.number().int().nonnegative();
const instant = z.iso.datetime({ offset: false }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/).refine(
  (value) => value.endsWith('Z') && Number.isFinite(Date.parse(value)),
  'Expected a valid UTC instant ending in Z',
);

function instantParts(value: string): { wholeMilliseconds: number; fraction: string } {
  const fraction = /\.(\d+)Z$/.exec(value)?.[1] ?? '';
  return { wholeMilliseconds: Date.parse(value.replace(/\.\d+Z$/, 'Z')), fraction };
}

function compareFractions(left: string, right: string): number {
  const length = Math.max(left.length, right.length);
  const paddedLeft = left.padEnd(length, '0');
  const paddedRight = right.padEnd(length, '0');
  return paddedLeft === paddedRight ? 0 : paddedLeft < paddedRight ? -1 : 1;
}

/** Compare validated UTC instants without losing BigQuery microseconds. */
export function compareInstants(left: string, right: string): number {
  const a = instantParts(left);
  const b = instantParts(right);
  return Math.sign(a.wholeMilliseconds - b.wholeMilliseconds) || compareFractions(a.fraction, b.fraction);
}

function durationExceeds(window: TimeWindow, maximumMilliseconds: number): boolean {
  const start = instantParts(window.from);
  const end = instantParts(window.to);
  const wholeDuration = end.wholeMilliseconds - start.wholeMilliseconds;
  return wholeDuration > maximumMilliseconds
    || (wholeDuration === maximumMilliseconds && compareFractions(end.fraction, start.fraction) > 0);
}

/** Canonical text for one instant: no trailing fraction zeros, so equal instants compare as equal strings. */
export function normalizedInstant(value: string): string {
  const parts = instantParts(value);
  const seconds = new Date(parts.wholeMilliseconds).toISOString().replace(/\.000Z$/, '');
  const fraction = parts.fraction.replace(/0+$/, '');
  return `${seconds}${fraction === '' ? '' : `.${fraction}`}Z`;
}

export const timeWindowSchema = z.object({ from: instant, to: instant }).superRefine(
  (window, context) => {
    if (compareInstants(window.from, window.to) >= 0) context.addIssue({ code: 'custom', message: 'Window must have from < to' });
  },
);
export type TimeWindow = z.infer<typeof timeWindowSchema>;
const requestTimeWindowSchema = z.strictObject({ from: instant, to: instant }).refine(
  (window) => compareInstants(window.from, window.to) < 0, 'Window must have from < to',
);

export const bboxSchema = z.tuple([
  z.number().min(-180).max(180), z.number().min(-90).max(90),
  z.number().min(-180).max(180), z.number().min(-90).max(90),
]).superRefine(([west, south, east, north], context) => {
  if (west >= east || south >= north) {
    context.addIssue({ code: 'custom', message: 'Bbox must have west < east and south < north' });
  }
  if (west < SERVICE_BBOX[0] || south < SERVICE_BBOX[1]
    || east > SERVICE_BBOX[2] || north > SERVICE_BBOX[3]) {
    context.addIssue({ code: 'custom', message: 'Bbox is outside the Melbourne service envelope' });
  }
});
export type Bbox = z.infer<typeof bboxSchema>;

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const line = z.array(position).min(2);
const ring = z.array(position).min(4).refine((points) => {
  const first = points.at(0);
  const last = points.at(-1);
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
}, 'Polygon rings must close');
const polygon = z.array(ring).min(1);

export const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }),
  z.object({ type: z.literal('MultiPoint'), coordinates: z.array(position).min(1) }),
  z.object({ type: z.literal('LineString'), coordinates: line }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(line).min(1) }),
  z.object({ type: z.literal('Polygon'), coordinates: polygon }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon).min(1) }),
]);
export type MapGeometry = z.infer<typeof geometrySchema>;

/** Ten registered layers. `parking` (UC-15) was added on 2026-10-15 and is a v1 layer; do not remove it. */
export const REGISTERED_LAYER_COUNT = 10;
export const layerIdSchema = z.enum([
  'pedestrian', 'anomaly', 'disruption', 'event', 'planning', 'boundary', 'news', 'rent', 'census', 'parking',
]);
export type LayerId = z.infer<typeof layerIdSchema>;
export const modeSchema = z.enum(['current', 'historical']);
const layerIds = z.array(layerIdSchema).min(1).max(REGISTERED_LAYER_COUNT).refine(
  (layers) => new Set(layers).size === layers.length,
  'Layer ids must be distinct',
);

export const areaFilterSchema = z.strictObject({
  indicatorId: identifier,
  periodId: identifier,
  propertyType: nonemptyString.nullable(),
  boundaryVintage: identifier,
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
}).refine((filter) => filter.periodStart < filter.periodEnd, 'Statistical period must have periodStart < periodEnd');
export const boundaryLevelSchema = z.enum(['GCCSA', 'LGA', 'SA2', 'STE', 'CLUE_BLOCK', 'MUNICIPAL']);
export type BoundaryLevel = z.infer<typeof boundaryLevelSchema>;
export const boundaryFilterSchema = z.strictObject({
  level: boundaryLevelSchema,
  vintage: identifier,
});

export const viewportQuerySchema = z.strictObject({
  requestId: identifier,
  bbox: bboxSchema,
  zoom: z.number().min(0).max(22),
  layers: layerIds,
  mode: modeSchema,
  window: requestTimeWindowSchema,
  areaFilter: areaFilterSchema.nullable().optional(),
  boundaryFilter: boundaryFilterSchema.nullable().optional(),
  pageSize: count.min(1).max(MAX_PAGE_ITEMS).optional(),
  cursor: identifier.optional(),
  snapshotId: identifier.optional(),
}).superRefine((query, context) => {
  const [west, south, east, north] = query.bbox;
  if (west < SERVICE_BBOX[0] || south < SERVICE_BBOX[1]
    || east > SERVICE_BBOX[2] || north > SERVICE_BBOX[3]) {
    context.addIssue({ code: 'custom', path: ['bbox'], message: 'Bbox is outside the Melbourne service envelope' });
  }
  if (durationExceeds(query.window, MAX_WINDOW_MS)) {
    context.addIssue({ code: 'custom', path: ['window'], message: 'Request window exceeds 31 days' });
  }
  if ((query.layers.includes('rent') || query.layers.includes('census')) && query.areaFilter == null) {
    context.addIssue({ code: 'custom', path: ['areaFilter'], message: 'Statistical layers require areaFilter' });
  }
  if (query.layers.includes('boundary') && query.boundaryFilter == null) {
    context.addIssue({ code: 'custom', path: ['boundaryFilter'], message: 'Boundary layer requires boundaryFilter' });
  }
  if ((query.cursor === undefined) !== (query.snapshotId === undefined)) {
    context.addIssue({ code: 'custom', path: ['cursor'], message: 'Continuation requires cursor and snapshotId together' });
  }
  if (query.cursor !== undefined && query.layers.length !== 1) {
    context.addIssue({ code: 'custom', path: ['layers'], message: 'Continuation is bound to exactly one layer' });
  }
});
export type ViewportQuery = z.infer<typeof viewportQuerySchema>;

export function parseViewportQuery(value: unknown): ViewportQuery {
  assertWithinBytes(value, MAX_REQUEST_BYTES);
  return viewportQuerySchema.parse(value);
}

export function parseViewportQueryJson(body: string | Uint8Array): ViewportQuery {
  if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new RangeError('Request body exceeds 256 KiB');
  const text = typeof body === 'string' ? body : new TextDecoder('utf8', { fatal: true }).decode(body);
  const value: unknown = JSON.parse(text);
  return parseViewportQuery(value);
}

export function normalizedViewportIdentity(query: ViewportQuery): string {
  const context = {
    bbox: query.bbox,
    zoom: query.zoom,
    mode: query.mode,
    window: { from: normalizedInstant(query.window.from), to: normalizedInstant(query.window.to) },
    areaFilter: query.areaFilter == null ? null : {
      indicatorId: query.areaFilter.indicatorId,
      periodId: query.areaFilter.periodId,
      propertyType: query.areaFilter.propertyType,
      boundaryVintage: query.areaFilter.boundaryVintage,
      periodStart: query.areaFilter.periodStart,
      periodEnd: query.areaFilter.periodEnd,
    },
    boundaryFilter: query.boundaryFilter == null ? null : {
      level: query.boundaryFilter.level,
      vintage: query.boundaryFilter.vintage,
    },
    pageSize: query.pageSize ?? MAX_PAGE_ITEMS,
  };
  return createHash('sha256').update(`viewport:v1:${JSON.stringify(context)}`).digest('hex');
}

export const snapshotBindingSchema = z.strictObject({
  id: nonemptyString,
  queryFamily: z.enum(['viewport', 'unlocated', 'aggregateMembers']),
  queryIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  selectedLayers: layerIds,
  sourceVersionWatermark: nonemptyString,
  publicSourceIds: z.array(nonemptyString).min(1),
  createdAt: instant,
  expiresAt: instant,
}).superRefine((snapshot, context) => {
  if (compareInstants(snapshot.createdAt, snapshot.expiresAt) >= 0
    || durationExceeds({ from: snapshot.createdAt, to: snapshot.expiresAt }, SNAPSHOT_TTL_MS)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Snapshot lifetime must be within five minutes' });
  }
});
export type SnapshotBinding = z.infer<typeof snapshotBindingSchema>;

export const cursorBindingSchema = z.strictObject({
  id: nonemptyString,
  queryFamily: z.enum(['viewport', 'unlocated', 'aggregateMembers']),
  snapshotId: nonemptyString,
  queryIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  layerId: layerIdSchema,
  sourceVersionWatermark: nonemptyString,
  after: z.strictObject({ id: nonemptyString, versionId: nonemptyString }),
});
export type CursorBinding = z.infer<typeof cursorBindingSchema>;

export class MapContractError extends Error {
  constructor(readonly code: 'cursorMismatch' | 'snapshotExpired' | 'notAvailable', message: string) {
    super(message);
    this.name = 'MapContractError';
  }
}

export interface SnapshotCursorResolvers {
  resolveSnapshot(id: string): Promise<SnapshotBinding | null>;
  resolveCursor(id: string): Promise<CursorBinding | null>;
  isStillPublic(binding: SnapshotBinding): Promise<boolean>;
}

export async function validateSnapshotCursor(args: {
  request: ViewportQuery;
  resolvers: SnapshotCursorResolvers;
  now: Date;
}): Promise<{ snapshot: SnapshotBinding; cursor: CursorBinding } | null> {
  const { request, resolvers, now } = args;
  if (request.cursor === undefined || request.snapshotId === undefined) return null;
  if (!Number.isFinite(now.getTime())) throw new TypeError('now must be a valid Date');
  const snapshot = await resolvers.resolveSnapshot(request.snapshotId);
  if (snapshot === null || snapshot.id !== request.snapshotId) {
    throw new MapContractError('snapshotExpired', 'Snapshot is absent or expired');
  }
  snapshotBindingSchema.parse(snapshot);
  if (snapshot.queryFamily !== 'viewport') {
    throw new MapContractError('cursorMismatch', 'Snapshot belongs to another query family');
  }
  if (compareInstants(now.toISOString(), snapshot.createdAt) < 0
    || compareInstants(now.toISOString(), snapshot.expiresAt) >= 0) {
    throw new MapContractError('snapshotExpired', 'Snapshot is absent or expired');
  }
  if (snapshot.queryIdentity !== normalizedViewportIdentity(request)) {
    throw new MapContractError('cursorMismatch', 'Viewport filters changed');
  }
  const cursor = await resolvers.resolveCursor(request.cursor);
  if (cursor === null || cursor.id !== request.cursor) throw new MapContractError('cursorMismatch', 'Unknown cursor');
  cursorBindingSchema.parse(cursor);
  if (cursor.queryFamily !== 'viewport' || cursor.snapshotId !== snapshot.id || cursor.queryIdentity !== snapshot.queryIdentity
    || cursor.sourceVersionWatermark !== snapshot.sourceVersionWatermark
    || request.layers.length !== 1 || request.layers[0] !== cursor.layerId
    || !snapshot.selectedLayers.includes(cursor.layerId)) {
    throw new MapContractError('cursorMismatch', 'Cursor does not belong to this layer and snapshot');
  }
  if (!await resolvers.isStillPublic(snapshot)) {
    throw new MapContractError('notAvailable', 'Snapshot source access was retracted');
  }
  return { snapshot, cursor };
}

const distinctIds = z.array(identifier).refine((values) => new Set(values).size === values.length, 'Ids must be distinct');
export const coverageSchema = z.object({
  state: z.enum(['verified', 'notCovered', 'unknown']),
  areaRefs: distinctIds,
  window: timeWindowSchema.nullable(),
  evidenceSourceIds: distinctIds,
}).superRefine((coverage, context) => {
  if (coverage.state === 'verified' && (coverage.areaRefs.length === 0 || coverage.evidenceSourceIds.length === 0)) {
    context.addIssue({ code: 'custom', message: 'Verified coverage needs area references and public evidence' });
  }
});
export type Coverage = z.infer<typeof coverageSchema>;
const publicUrl = z.url({ protocol: /^https?$/ });
export const sourceReferenceSchema = z.object({
  sourceId: identifier, url: publicUrl.nullable(), attribution: nonemptyString, versionRef: identifier.nullable(),
});
const locationSchema = z.object({
  precision: z.enum(['point', 'line', 'area', 'unlocated']),
  role: z.enum(['eventSite', 'sensor', 'affectedExtent', 'statisticalArea', 'areaAssociation', 'mention', 'unknown']),
  evidence: nonemptyString.nullable(),
});
const itemTimeSchema = z.object({
  observedAt: instant.nullable(), reportedAt: instant.nullable(),
  validFrom: instant.nullable(), validTo: instant.nullable(), periodLabel: nonemptyString.nullable(),
  fetchedAt: instant.nullable(), sourceTimeText: nonemptyString.nullable(), sourceTimezone: nonemptyString.nullable(),
}).refine((time) => time.validFrom === null || time.validTo === null
  || compareInstants(time.validFrom, time.validTo) < 0, 'Effective interval must have validFrom < validTo');
const geometryPresentationSchema = z.object({
  simplified: z.boolean(), originalPrecision: z.enum(['point', 'line', 'area']),
  toleranceMeters: z.number().nonnegative().nullable(),
}).refine((presentation) => !presentation.simplified || presentation.toleranceMeters !== null,
  'Simplified geometry needs its tolerance');
const pedestrianDetailsSchema = z.object({
  sensorId: identifier,
  totalCount: count.nullable(), directionACount: count.nullable(), directionBCount: count.nullable(),
  granularity: z.enum(['minute', 'hour']), window: timeWindowSchema,
  locationValidFrom: instant.nullable(), locationValidTo: instant.nullable(),
  locationStatus: z.enum(['located', 'unlocated', 'ambiguous', 'inactive']),
}).superRefine((details, context) => {
  if (details.totalCount !== null && details.directionACount !== null && details.directionBCount !== null
    && details.totalCount !== details.directionACount + details.directionBCount) {
    context.addIssue({ code: 'custom', path: ['totalCount'], message: 'Known direction counts must sum to totalCount' });
  }
  if (details.locationValidFrom !== null && details.locationValidTo !== null
    && compareInstants(details.locationValidFrom, details.locationValidTo) >= 0) {
    context.addIssue({ code: 'custom', message: 'Location validity interval is reversed or empty' });
  }
});
/**
 * A live on-street parking sensor (UC-15). `state` is all a map may draw: it is `occupied` or
 * `vacant` only while the sensor's own last report is current or late, otherwise `noData` with the
 * reason, never a guess. The feed proves a car is or is not on the bay; it never proves that
 * parking there is legal (no sensor-to-restriction crosswalk is admitted), so `legalParking` is
 * always `unknown`, and construction can leave a blocked bay looking vacant (`mayBeObstructed`).
 */
const parkingDetailsSchema = z.object({
  sensorId: identifier,
  state: z.enum(['occupied', 'vacant', 'noData']),
  noDataReason: z.enum(['notReporting', 'publicHoliday', 'holidayUnknown', 'noStatus']).nullable(),
  reading: z.enum(['current', 'late', 'stale', 'unknown']),
  lastReportedAt: instant.nullable(), statusChangedAt: instant.nullable(),
  zoneNumber: count.nullable(),
  legalParking: z.literal('unknown'),
  mayBeObstructed: z.boolean(),
}).superRefine((details, context) => {
  if ((details.state === 'noData') !== (details.noDataReason !== null)) {
    context.addIssue({ code: 'custom', path: ['noDataReason'], message: 'noData needs its reason, and only noData has one' });
  }
  if (details.state !== 'noData' && details.reading !== 'current' && details.reading !== 'late') {
    context.addIssue({ code: 'custom', path: ['state'], message: 'Occupancy cannot be drawn from a stale or unknown reading' });
  }
});
const anomalyDetailsSchema = z.object({
  resultId: identifier, sensorId: identifier, observationId: identifier.nullable(), window: timeWindowSchema,
  baselineDefinitionId: identifier.nullable(), baselineValue: z.number().nullable(),
  observedValue: z.number().nullable(), delta: z.number().nullable(),
  direction: z.enum(['higher', 'lower', 'none', 'unknown']),
  eligibility: z.enum(['eligible', 'ineligible', 'unknown']),
  classification: z.enum(['anomalous', 'notAnomalous', 'unclassified']),
}).superRefine((details, context) => {
  if (details.classification !== 'unclassified'
    && (details.eligibility !== 'eligible' || details.baselineDefinitionId === null
      || details.baselineValue === null || details.observedValue === null || details.delta === null)) {
    context.addIssue({ code: 'custom', message: 'Classification requires an eligible producer result and baseline' });
  }
});
const disruptionDetailsSchema = z.object({
  summary: nonemptyString.nullable(), impact: nonemptyString.nullable(), serviceNames: z.array(nonemptyString),
  status: z.enum(['active', 'planned', 'cancelled', 'resolved', 'unknown']),
  extentKind: z.enum(['roadSegment', 'route', 'stop', 'area', 'unknown']),
});
const eventDetailsSchema = z.object({
  summary: nonemptyString.nullable(), venueName: nonemptyString.nullable(), category: nonemptyString.nullable(),
  startAt: instant.nullable(), endAt: instant.nullable(),
  status: z.enum(['active', 'planned', 'cancelled', 'resolved', 'unknown']),
}).refine((details) => details.startAt === null || details.endAt === null
  || compareInstants(details.startAt, details.endAt) < 0, 'Event interval must have startAt < endAt');
const planningDetailsSchema = z.object({
  summary: nonemptyString.nullable(), projectStatus: nonemptyString.nullable(), permitId: identifier.nullable(),
});
const boundaryDetailsSchema = z.object({
  boundaryId: identifier, boundaryLevel: boundaryLevelSchema, vintage: identifier, name: nonemptyString,
});
const articleReferenceSchema = z.object({
  articleId: identifier, url: publicUrl.nullable(), title: nonemptyString, reportedAt: instant.nullable(),
});
const newsDetailsSchema = z.object({
  eventId: identifier, summary: nonemptyString.nullable(), articleRefs: z.array(articleReferenceSchema).min(1),
  localizationEvidence: nonemptyString.nullable(),
  dedupStatus: z.enum(['confirmedDistinct', 'confirmedDuplicate', 'unconfirmed']),
});
const areaIndicatorDetailsSchema = z.object({
  indicatorId: identifier, value: z.number().nullable(), valueState: z.enum(['observed', 'missing', 'suppressed']),
  unit: nonemptyString, periodId: identifier, periodLabel: nonemptyString, propertyType: nonemptyString.nullable(),
  boundaryId: identifier.nullable(), boundaryVintage: identifier.nullable(),
  mappingState: z.enum(['matched', 'missing', 'ambiguous']), definition: nonemptyString,
}).superRefine((details, context) => {
  if ((details.valueState === 'observed') !== (details.value !== null)) {
    context.addIssue({ code: 'custom', message: 'Observed values need a value; missing/suppressed values must be null' });
  }
  if (details.mappingState === 'matched' && (details.boundaryId === null || details.boundaryVintage === null)) {
    context.addIssue({ code: 'custom', message: 'Matched boundaries need their id and vintage' });
  }
});
const resultRangeSchema = z.object({
  scope: z.enum(['viewport', 'areaAssociation', 'sourceJurisdiction']),
  returnedCount: count, totalMatching: count.nullable(),
}).refine((range) => range.totalMatching === null || range.totalMatching >= range.returnedCount,
  'Exact total cannot be less than returnedCount');
const gridDetailsSchema = z.object({
  cellId: identifier, resolution: count.max(15), validSensorCount: count, observedSensorCount: count,
  classifiedSensorCount: count, unclassifiedSensorCount: count, anomalousSensorCount: count,
  baselineDefinitionId: identifier.nullable(), anomalyRatio: z.number().min(0).max(1).nullable(),
}).superRefine((grid, context) => {
  if (grid.observedSensorCount > grid.validSensorCount
    || grid.classifiedSensorCount > grid.observedSensorCount
    || grid.classifiedSensorCount + grid.unclassifiedSensorCount > grid.validSensorCount
    || grid.anomalousSensorCount > grid.classifiedSensorCount) {
    context.addIssue({ code: 'custom', message: 'Grid sensor counts have inconsistent denominators' });
  }
  if (grid.classifiedSensorCount === 0 && grid.anomalyRatio !== null) {
    context.addIssue({ code: 'custom', message: 'No classified sensors requires null anomalyRatio' });
  }
  if (grid.classifiedSensorCount > 0 && (grid.baselineDefinitionId === null || grid.anomalyRatio === null
    || Math.abs(grid.anomalyRatio - grid.anomalousSensorCount / grid.classifiedSensorCount) > 1e-12)) {
    context.addIssue({ code: 'custom', message: 'Anomaly ratio requires one baseline and the classified denominator' });
  }
});
const aggregateDetailsSchema = z.object({
  representation: z.enum(['cluster', 'coverageGrid']), memberIds: distinctIds, memberCursor: identifier.nullable(),
  resultRange: resultRangeSchema,
  metric: z.object({ id: identifier, label: nonemptyString, unit: nonemptyString, value: z.number().nullable(), definition: nonemptyString }),
  window: timeWindowSchema.nullable(), coverage: coverageSchema, bounds: bboxSchema, grid: gridDetailsSchema.nullable(),
}).superRefine((aggregate, context) => {
  if ((aggregate.representation === 'coverageGrid') !== (aggregate.grid !== null)) {
    context.addIssue({ code: 'custom', message: 'coverageGrid requires grid details; cluster cannot have grid details' });
  }
  if (aggregate.resultRange.returnedCount !== aggregate.memberIds.length) {
    context.addIssue({ code: 'custom', message: 'returnedCount must equal explicit member ids' });
  }
  if (aggregate.memberIds.length === 0 && aggregate.memberCursor === null) {
    context.addIssue({ code: 'custom', message: 'Aggregate needs real member ids or a member cursor' });
  }
});

const itemCommon = {
  id: identifier, versionId: identifier, layerId: layerIdSchema, title: nonemptyString,
  geometry: geometrySchema.nullable(), location: locationSchema,
  assertionKind: z.enum(['observation', 'report', 'plan', 'prediction']),
  lifecycle: z.enum(['active', 'planned', 'cancelled', 'resolved', 'withdrawn']),
  time: itemTimeSchema, sources: z.array(sourceReferenceSchema).min(1),
  geometryPresentation: geometryPresentationSchema.optional(),
};

export const mapItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...itemCommon, kind: z.literal('pedestrian'), details: pedestrianDetailsSchema }),
  z.object({ ...itemCommon, kind: z.literal('anomaly'), details: anomalyDetailsSchema }),
  z.object({ ...itemCommon, kind: z.literal('disruption'), details: disruptionDetailsSchema }),
  z.object({ ...itemCommon, kind: z.literal('event'), details: eventDetailsSchema }),
  z.object({ ...itemCommon, kind: z.literal('planning'), details: planningDetailsSchema }),
  z.object({ ...itemCommon, kind: z.literal('parking'), details: parkingDetailsSchema }),
  z.object({ ...itemCommon, kind: z.literal('boundary'), details: boundaryDetailsSchema }),
  z.object({ ...itemCommon, kind: z.literal('news'), details: newsDetailsSchema }),
  z.object({ ...itemCommon, kind: z.literal('areaIndicator'), details: areaIndicatorDetailsSchema }),
  z.object({ ...itemCommon, kind: z.literal('aggregate'), details: aggregateDetailsSchema }),
]).superRefine((item, context) => {
  if (item.geometry === null && item.location.precision !== 'unlocated') {
    context.addIssue({ code: 'custom', message: 'Null geometry must remain unlocated' });
  }
  if (item.geometry !== null) {
    const expectedPrecision = item.geometry.type === 'Point' || item.geometry.type === 'MultiPoint' ? 'point'
      : item.geometry.type === 'LineString' || item.geometry.type === 'MultiLineString' ? 'line' : 'area';
    if (item.location.precision !== expectedPrecision) {
      context.addIssue({ code: 'custom', message: 'Location precision must describe the geometry' });
    }
    if (item.geometryPresentation !== undefined && item.geometryPresentation.originalPrecision !== expectedPrecision) {
      context.addIssue({ code: 'custom', message: 'Simplification cannot change the original dimensional class' });
    }
  }
  const expectedLayer = item.kind === 'areaIndicator' ? null : item.kind === 'aggregate' ? null : item.kind;
  if (expectedLayer !== null && item.layerId !== expectedLayer) {
    context.addIssue({ code: 'custom', message: 'Item kind does not belong to its layer' });
  }
  if (item.kind === 'areaIndicator') {
    if (item.layerId !== 'rent' && item.layerId !== 'census') {
      context.addIssue({ code: 'custom', message: 'Area indicators belong to rent or census' });
    }
    if (item.geometry !== null && (item.details.mappingState !== 'matched'
      || item.location.role !== 'statisticalArea'
      || (item.geometry.type !== 'Polygon' && item.geometry.type !== 'MultiPolygon'))) {
      context.addIssue({ code: 'custom', message: 'Drawable indicators require matched statistical area polygons' });
    }
  }
  if (item.kind === 'news' && item.location.role === 'mention' && item.geometry !== null) {
    context.addIssue({ code: 'custom', message: 'A news mention cannot become an event geometry' });
  }
  if (item.kind === 'parking' && (item.geometry === null || item.geometry.type !== 'Point' || item.location.role !== 'sensor')) {
    context.addIssue({ code: 'custom', message: 'A parking sensor is drawn only at its own sensor point' });
  }
  if (item.kind === 'pedestrian') {
    if ((item.details.locationStatus === 'located') !== (item.geometry !== null)) {
      context.addIssue({ code: 'custom', message: 'Only an effective located sensor can have geometry' });
    }
    if (item.geometry !== null && (item.geometry.type !== 'Point' || item.location.role !== 'sensor')) {
      context.addIssue({ code: 'custom', message: 'A located pedestrian observation must use its sensor point' });
    }
    if (item.geometry !== null && (item.details.locationValidFrom === null
      || compareInstants(item.details.locationValidFrom, item.details.window.from) > 0
      || (item.details.locationValidTo !== null && compareInstants(item.details.locationValidTo, item.details.window.to) < 0))) {
      context.addIssue({ code: 'custom', message: 'Sensor location must be effective throughout the observation window' });
    }
  }
});
export type MapItem = z.infer<typeof mapItemSchema>;

function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

/** The stable row order every page, snapshot and adapter uses: layerId, id, versionId. */
export function compareMapItems(left: Pick<MapItem, 'layerId' | 'id' | 'versionId'>,
  right: Pick<MapItem, 'layerId' | 'id' | 'versionId'>): number {
  return compareStrings(left.layerId, right.layerId) || compareStrings(left.id, right.id)
    || compareStrings(left.versionId, right.versionId);
}

function itemsAreOrdered(items: readonly MapItem[]): boolean {
  return items.every((item, index) => index === 0 || compareMapItems(items[index - 1]!, item) < 0);
}

const freshnessSchema = z.enum(['current', 'late', 'stale', 'versioned', 'unknown']);
const completenessSchema = z.enum(['complete', 'partial']);
export const layerResultSchema = z.object({
  layerId: layerIdSchema, state: z.enum(['available', 'noMatching', 'notCovered', 'unavailable', 'unknown']),
  freshness: freshnessSchema, completeness: completenessSchema, sourceIds: distinctIds,
  coverage: coverageSchema, observedWindow: timeWindowSchema.nullable(), updatedAt: instant.nullable(),
  items: z.array(mapItemSchema).max(MAX_PAGE_ITEMS), unresolvedCount: count.nullable(),
  nextCursor: identifier.nullable(), totalMatching: count.nullable(),
}).superRefine((layer, context) => {
  if (layer.items.some((item) => item.layerId !== layer.layerId)) {
    context.addIssue({ code: 'custom', message: 'Items must belong to the enclosing layer' });
  }
  if (!itemsAreOrdered(layer.items)) {
    context.addIssue({ code: 'custom', message: 'Items must be distinct and ordered by layerId/id/versionId' });
  }
  if (layer.state === 'noMatching' && (layer.coverage.state !== 'verified' || layer.coverage.window === null
    || layer.completeness !== 'complete' || layer.items.length !== 0 || layer.totalMatching !== 0
    || layer.unresolvedCount !== 0 || layer.nextCursor !== null)) {
    context.addIssue({ code: 'custom', message: 'noMatching requires complete verified area/time coverage and exact empty results' });
  }
  if (layer.state === 'notCovered' && layer.coverage.state !== 'notCovered') {
    context.addIssue({ code: 'custom', message: 'notCovered requires explicit notCovered coverage' });
  }
  if (layer.state === 'available' && layer.items.length === 0) {
    context.addIssue({ code: 'custom', message: 'available requires at least one returned item' });
  }
  if (layer.nextCursor !== null && layer.completeness !== 'partial') {
    context.addIssue({ code: 'custom', message: 'A continuation cursor requires partial completeness' });
  }
  if (layer.state !== 'available' && layer.state !== 'noMatching'
    && (layer.items.length !== 0 || layer.totalMatching !== null)) {
    context.addIssue({ code: 'custom', message: 'Unavailable/unknown/uncovered layers cannot claim current items or an exact total' });
  }
  const drawableCount = layer.items.filter((item) => item.geometry !== null).length;
  if (layer.totalMatching !== null && layer.totalMatching < drawableCount) {
    context.addIssue({ code: 'custom', message: 'Geographic total cannot be less than the returned located items' });
  }
  if (layer.items.some((item) => item.geometry === null)) {
    context.addIssue({ code: 'custom', message: 'Viewport items must be located; unlocated facts use the scoped list' });
  }
});
export type LayerResult = z.infer<typeof layerResultSchema>;

const responseCommon = {
  schemaVersion: z.literal(MAP_SCHEMA_VERSION), requestId: identifier, snapshotId: identifier,
  generatedAt: instant, mode: modeSchema, dataMode: z.enum(['live', 'sample']),
};
export const viewportResponseSchema = z.object({
  ...responseCommon, layers: z.array(layerResultSchema).min(1).max(REGISTERED_LAYER_COUNT),
}).superRefine((response, context) => {
  if (new Set(response.layers.map((layer) => layer.layerId)).size !== response.layers.length) {
    context.addIssue({ code: 'custom', message: 'Layer results must be distinct' });
  }
  if (response.layers.reduce((total, layer) => total + layer.items.length, 0) > MAX_PAGE_ITEMS) {
    context.addIssue({ code: 'custom', message: 'Viewport page exceeds 1,000 total items' });
  }
});
export type ViewportResponse = z.infer<typeof viewportResponseSchema>;

function enforceProductionMode(response: { dataMode: 'live' | 'sample' }, production: boolean | undefined): void {
  if (production && response.dataMode !== 'live') throw new TypeError('Production service cannot return sample data');
}

export function parseViewportResponse(value: unknown, options: {
  production?: boolean;
  expectedRequest?: ViewportQuery;
} = {}): ViewportResponse {
  assertWithinBytes(value, MAX_RESPONSE_BYTES);
  const response = viewportResponseSchema.parse(value);
  enforceProductionMode(response, options.production);
  if (options.expectedRequest !== undefined) {
    const request = options.expectedRequest;
    if (response.requestId !== request.requestId || response.mode !== request.mode
      || (request.snapshotId !== undefined && response.snapshotId !== request.snapshotId)
      || response.layers.length !== request.layers.length
      || response.layers.some((layer) => !request.layers.includes(layer.layerId))) {
      throw new TypeError('Response does not match the requested identity, snapshot, mode and layers');
    }
    for (const layer of response.layers) {
      if (layer.state === 'noMatching' && (layer.coverage.window === null
        || compareInstants(layer.coverage.window.from, request.window.from) > 0
        || compareInstants(layer.coverage.window.to, request.window.to) < 0)) {
        throw new TypeError('noMatching coverage must contain the requested window');
      }
      for (const item of layer.items) {
        if (item.kind === 'boundary' && request.boundaryFilter != null
          && (item.details.boundaryLevel !== request.boundaryFilter.level || item.details.vintage !== request.boundaryFilter.vintage)) {
          throw new TypeError('Boundary level/vintage does not match the requested geography');
        }
        if (item.kind === 'areaIndicator' && request.areaFilter != null
          && (item.details.boundaryVintage !== request.areaFilter.boundaryVintage
            || item.details.indicatorId !== request.areaFilter.indicatorId || item.details.periodId !== request.areaFilter.periodId
            || item.details.propertyType !== request.areaFilter.propertyType)) {
          throw new TypeError('Area indicator does not match the requested statistical context');
        }
      }
    }
  }
  return response;
}

export const layerDescriptorSchema = z.object({
  id: layerIdSchema, titleKey: identifier, topic: z.enum(['cityActivity', 'nearbyNews', 'areaComparison', 'context']),
  defaultEnabled: z.boolean(), supportedModes: z.array(modeSchema).min(1).refine((modes) => new Set(modes).size === modes.length),
  sourceIds: distinctIds, availability: z.enum(['available', 'notCovered', 'unavailable', 'unknown']),
  freshness: freshnessSchema, coverage: coverageSchema,
  timeSemantics: z.enum(['observationWindow', 'effectiveInterval', 'reportedAt', 'statisticalPeriod', 'boundaryVintage']),
  updatedAt: instant.nullable(),
});
export const mapLayerCatalogSchema = z.object({
  schemaVersion: z.literal(MAP_SCHEMA_VERSION), generatedAt: instant, dataMode: z.enum(['live', 'sample']),
  serviceBounds: bboxSchema, layers: z.array(layerDescriptorSchema).length(REGISTERED_LAYER_COUNT),
}).refine((catalog) => new Set(catalog.layers.map((layer) => layer.id)).size === REGISTERED_LAYER_COUNT,
  'Catalog must contain each registered layer once');
export type MapLayerCatalog = z.infer<typeof mapLayerCatalogSchema>;
export const mapItemResponseSchema = z.object({ ...responseCommon, item: mapItemSchema });
export type MapItemResponse = z.infer<typeof mapItemResponseSchema>;
const pageScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unlocated'), areaRefs: distinctIds, sourceJurisdiction: nonemptyString.nullable() }),
  z.object({ kind: z.literal('aggregateMembers'), aggregateId: identifier, bounds: bboxSchema, window: timeWindowSchema.nullable(), unit: nonemptyString }),
]);
export const mapItemPageSchema = z.object({
  ...responseCommon, items: z.array(mapItemSchema).max(MAX_PAGE_ITEMS), completeness: completenessSchema,
  nextCursor: identifier.nullable(), totalMatching: count.nullable(), scope: pageScopeSchema,
}).superRefine((page, context) => {
  if (!itemsAreOrdered(page.items)) {
    context.addIssue({ code: 'custom', message: 'Items must be distinct and ordered by layerId/id/versionId' });
  }
  if (page.nextCursor !== null && page.completeness !== 'partial') {
    context.addIssue({ code: 'custom', message: 'Continuation requires partial completeness' });
  }
  if (page.totalMatching !== null && page.totalMatching < page.items.length) {
    context.addIssue({ code: 'custom', message: 'Exact total cannot be less than returned items' });
  }
  if (page.scope.kind === 'unlocated') {
    if (page.scope.areaRefs.length === 0 && page.scope.sourceJurisdiction === null) {
      context.addIssue({ code: 'custom', message: 'Unlocated list requires verified area associations or source jurisdiction' });
    }
    if (page.items.some((item) => item.geometry !== null)) {
      context.addIssue({ code: 'custom', message: 'Unlocated list cannot contain located geometry' });
    }
  }
});
export type MapItemPage = z.infer<typeof mapItemPageSchema>;

export const mapReadContextSchema = z.strictObject({
  requestId: identifier, snapshotId: identifier, cursor: identifier.optional(),
  pageSize: count.min(1).max(MAX_PAGE_ITEMS).optional(),
});
export type MapReadContext = z.infer<typeof mapReadContextSchema>;
export const unlocatedQuerySchema = z.strictObject({
  requestId: identifier, layers: layerIds, mode: modeSchema, window: requestTimeWindowSchema,
  scope: z.union([
    z.strictObject({ areaRefs: distinctIds.refine((refs) => refs.length > 0) }),
    z.strictObject({ sourceJurisdiction: nonemptyString }),
  ]),
  areaFilter: areaFilterSchema.nullable().optional(), boundaryFilter: boundaryFilterSchema.nullable().optional(),
  pageSize: count.min(1).max(MAX_PAGE_ITEMS).optional(), cursor: identifier.optional(), snapshotId: identifier.optional(),
}).superRefine((query, context) => {
  if (durationExceeds(query.window, MAX_WINDOW_MS)) {
    context.addIssue({ code: 'custom', message: 'Request window exceeds 31 days' });
  }
  if ((query.layers.includes('rent') || query.layers.includes('census')) && query.areaFilter == null) {
    context.addIssue({ code: 'custom', message: 'Statistical layers require areaFilter' });
  }
  if (query.layers.includes('boundary') && query.boundaryFilter == null) {
    context.addIssue({ code: 'custom', message: 'Boundary layer requires boundaryFilter' });
  }
  if ((query.cursor === undefined) !== (query.snapshotId === undefined)
    || (query.cursor !== undefined && query.layers.length !== 1)) {
    context.addIssue({ code: 'custom', message: 'Continuation requires cursor+snapshotId and exactly one layer' });
  }
});
export type UnlocatedQuery = z.infer<typeof unlocatedQuerySchema>;
export const errorResponseSchema = z.object({
  schemaVersion: z.literal(MAP_SCHEMA_VERSION),
  error: z.object({
    code: z.enum(['invalidRequest', 'cursorMismatch', 'notFound', 'notAvailable', 'snapshotExpired', 'rateLimited', 'budgetExceeded', 'queryTimeout', 'serviceUnavailable']),
    messageKey: identifier, requestId: identifier.nullable(), retryable: z.boolean(),
  }),
});

export function parseMapItem(value: unknown): MapItem {
  assertWithinBytes(value, MAX_RESPONSE_BYTES);
  return mapItemSchema.parse(value);
}
export function parseMapReadContext(value: unknown): MapReadContext {
  assertWithinBytes(value, MAX_REQUEST_BYTES);
  return mapReadContextSchema.parse(value);
}
export function parseUnlocatedQuery(value: unknown): UnlocatedQuery {
  assertWithinBytes(value, MAX_REQUEST_BYTES);
  return unlocatedQuerySchema.parse(value);
}
export function parseMapLayerCatalog(value: unknown, options: { production?: boolean } = {}): MapLayerCatalog {
  assertWithinBytes(value, MAX_RESPONSE_BYTES);
  const response = mapLayerCatalogSchema.parse(value);
  enforceProductionMode(response, options.production);
  return response;
}
export function parseMapItemResponse(value: unknown, options: { production?: boolean } = {}): MapItemResponse {
  assertWithinBytes(value, MAX_RESPONSE_BYTES);
  const response = mapItemResponseSchema.parse(value);
  enforceProductionMode(response, options.production);
  return response;
}
export function parseMapItemPage(value: unknown, options: { production?: boolean } = {}): MapItemPage {
  assertWithinBytes(value, MAX_RESPONSE_BYTES);
  const response = mapItemPageSchema.parse(value);
  enforceProductionMode(response, options.production);
  return response;
}

function byteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Expected JSON data');
  return Buffer.byteLength(serialized, 'utf8');
}

function assertWithinBytes(value: unknown, maximum: number): void {
  if (byteLength(value) > maximum) throw new RangeError(`JSON exceeds ${maximum} uncompressed bytes`);
}
