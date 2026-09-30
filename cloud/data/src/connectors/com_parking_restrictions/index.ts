import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../core/opendatasoft.js';
import type { GeoRecord, GeoRecordSource, GeoRecordStatus, ParkingRule, SourceRecord, SourceRecordStatus } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'melbourne.parking.restrictions';
export const DATASET_ID = 'on-street-car-park-bay-restrictions';
export const LANDING_URL = `https://data.melbourne.vic.gov.au/explore/dataset/${DATASET_ID}/`;

const daySchema = z.union([
  z.number().int().min(0).max(6),
  z.string().regex(/^[0-6]$/).transform(Number),
]);

const rowSchema = z.object({
  bayid: z.union([
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/).transform(Number),
  ]),
  deviceid: z.union([z.number().int(), z.string()]).nullable().optional(),
}).catchall(z.unknown());

const slotSchema = z.object({
  fromDay: daySchema,
  toDay: daySchema,
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  typeDesc: z.string().trim().min(1),
  description: z.string().nullable(),
  duration: z.number().int().nonnegative().nullable(),
  disabilityExt: z.number().int().nonnegative().nullable().optional(),
  effectiveOnPublicHoliday: z.number().int().min(0).max(1).nullable().optional(),
  holidayApplicability: z.enum(['applies', 'does_not_apply']).nullable(),
  exemption: z.string().nullable(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});

export type RestrictionRow = z.infer<typeof rowSchema>;
export type ParsedSlot = z.infer<typeof slotSchema>;

export function parseNullableInt(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'boolean') return null;
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isSafeInteger(num) ? num : null;
}

export function parseNullableString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (str.length === 0 || /^(?:none|null|nil|n\/a)$/i.test(str)) return null;
  return str;
}

export function parseExemption(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (str.length === 0 || /^(?:none|null|nil|n\/a|unknown|no\s*exemption)$/i.test(str)) return null;
  return str;
}

export function parseHolidayApplicability(val: unknown): 'applies' | 'does_not_apply' | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'boolean') return val ? 'applies' : 'does_not_apply';
  const str = String(val).trim().toLowerCase();
  if (str === '1' || str === 'applies' || str === 'yes' || str === 'true') return 'applies';
  if (str === '0' || str === 'does_not_apply' || str === 'no' || str === 'false') return 'does_not_apply';
  return null;
}

export function parseIsoTimestamp(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null;
  const str = String(val).trim();
  const parsed = Date.parse(str.includes('T') ? str : `${str}T00:00:00Z`);
  if (!Number.isFinite(parsed)) {
    throw new RangeError(`Invalid timestamp: ${str}`);
  }
  return new Date(parsed).toISOString();
}

export function parseRecordStatus(val: unknown): {
  sourceRecordStatus: SourceRecordStatus;
  geoRecordStatus: GeoRecordStatus;
} {
  if (val === null || val === undefined || val === '') {
    return { sourceRecordStatus: 'active', geoRecordStatus: 'active' };
  }
  const str = String(val).trim().toLowerCase();
  if (str === 'active' || str === 'current' || str === 'operational') {
    return { sourceRecordStatus: 'active', geoRecordStatus: 'active' };
  }
  if (str === 'cancelled' || str === 'canceled' || str === 'inactive' || str === 'disabled') {
    return { sourceRecordStatus: 'cancelled', geoRecordStatus: 'cancelled' };
  }
  if (str === 'withdrawn' || str === 'removed' || str === 'deleted') {
    return { sourceRecordStatus: 'withdrawn', geoRecordStatus: 'withdrawn' };
  }
  if (str === 'corrected' || str === 'updated') {
    return { sourceRecordStatus: 'corrected', geoRecordStatus: 'active' };
  }
  if (str === 'planned' || str === 'pending' || str === 'proposed') {
    return { sourceRecordStatus: 'active', geoRecordStatus: 'planned' };
  }
  return { sourceRecordStatus: 'active', geoRecordStatus: 'active' };
}

export function parseRestrictionRow(unknownRow: unknown): RestrictionRow {
  return rowSchema.parse(unknownRow);
}

export function parseRestrictionSlot(slotNumber: number, row: Record<string, unknown>): ParsedSlot | null {
  const typeDescRaw = row[`typedesc${slotNumber}`];
  if (typeDescRaw == null) return null;
  const typeDesc = String(typeDescRaw).trim();
  if (typeDesc.length === 0) return null;

  const holidayApplicability = parseHolidayApplicability(row[`effectiveonph${slotNumber}`]);
  const effectiveOnPublicHoliday = holidayApplicability === 'applies' ? 1
    : holidayApplicability === 'does_not_apply' ? 0 : null;

  const validFromRaw = row[`validfrom${slotNumber}`] ?? row[`valid_from${slotNumber}`];
  const validToRaw = row[`validto${slotNumber}`] ?? row[`valid_to${slotNumber}`];
  const statusRaw = row[`status${slotNumber}`];

  const validFrom = parseIsoTimestamp(validFromRaw);
  const validTo = parseIsoTimestamp(validToRaw);
  if (validFrom !== null && validTo !== null && Date.parse(validTo) < Date.parse(validFrom)) {
    throw new RangeError(`valid_to (${validTo}) precedes valid_from (${validFrom})`);
  }

  const rawSlot = {
    fromDay: row[`fromday${slotNumber}`],
    toDay: row[`today${slotNumber}`],
    startTime: row[`starttime${slotNumber}`],
    endTime: row[`endtime${slotNumber}`],
    typeDesc,
    description: parseNullableString(row[`description${slotNumber}`]),
    duration: parseNullableInt(row[`duration${slotNumber}`]),
    disabilityExt: parseNullableInt(row[`disabilityext${slotNumber}`]),
    effectiveOnPublicHoliday,
    holidayApplicability,
    exemption: parseExemption(row[`exemption${slotNumber}`]),
    validFrom,
    validTo,
    status: parseNullableString(statusRaw),
  };

  return slotSchema.parse(rawSlot);
}

export function timeMinute(sourceTime: string | null | undefined): number | null {
  if (sourceTime == null || typeof sourceTime !== 'string') return null;
  const match = /(?:T|^)(\d{2}):(\d{2})(?::\d{2})?/.exec(sourceTime.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours === 24 && minutes === 0) return 1440;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function daysInInclusiveRange(from: number, to: number): number[] {
  if (from < 0 || from > 6 || to < 0 || to > 6) {
    throw new RangeError(`Invalid day range: from ${from} to ${to}`);
  }
  const days = [from];
  while (days.at(-1) !== to && days.length <= 7) {
    days.push(((days.at(-1) ?? 0) + 1) % 7);
  }
  // Upstream uses Monday=1 .. Saturday=6, Sunday=0. The shared model uses
  // Monday=1 .. Sunday=7 so SQL and TypeScript evaluate the same local day.
  return days.map(day => (day === 0 ? 7 : day));
}

export function inferVehicleClass(typeDesc: string, description: string | null): string | null {
  const combined = `${typeDesc} ${description ?? ''}`.toLowerCase();
  if (combined.includes('motorcycle') || combined.includes('motorbike')) return 'motorcycle';
  if (combined.includes('disabled') || combined.includes('disability')) return 'disability';
  if (combined.includes('loading')) return 'loading_vehicle';
  if (combined.includes('bus')) return 'bus';
  if (combined.includes('taxi')) return 'taxi';
  if (/(?:^\s*(?:\d+(?:\/\d+)?|\d+(?:\.\d+)?)\s*p\b|\bp\s*(?:\/\s*)?\d+|\bmeter\b|\bticket\b|\bno\s*(?:parking|stopping|park)\b|\bclearway\b)/i.test(combined)) {
    return 'all';
  }
  return null;
}

export function rulesOverlap(a: ParkingRule, b: ParkingRule): boolean {
  if (a.bay_id !== b.bay_id) return false;
  if (a.rule_id === b.rule_id) return false;
  if (a.valid_to !== null && b.valid_from !== null && a.valid_to <= b.valid_from) {
    return false;
  }
  if (b.valid_to !== null && a.valid_from !== null && b.valid_to <= a.valid_from) {
    return false;
  }
  const commonDay = a.days_of_week.some(d => b.days_of_week.includes(d));
  if (!commonDay) return false;
  if (a.start_minute_of_day === null || a.end_minute_of_day === null
    || b.start_minute_of_day === null || b.end_minute_of_day === null) {
    return false;
  }
  return a.start_minute_of_day < b.end_minute_of_day && b.start_minute_of_day < a.end_minute_of_day;
}

function failure(input: ConnectorInput, code: 'rate_limited' | 'upstream_unavailable' | 'schema_changed'
  | 'auth_failed' | 'incomplete_window' | 'validation_failed'): ConnectorResult {
  return {
    kind: 'failure',
    sourceId: SOURCE_ID,
    runId: input.runId,
    checkedAt: new Date().toISOString(),
    code,
    message: 'Parking restrictions snapshot could not be validated',
    retryAfterSeconds: null,
    completeness: {
      complete: false,
      expected_records: null,
      fetched_records: 0,
      expected_pages: null,
      fetched_pages: 0,
      evidence: 'All restriction rows and rule slots are required',
    },
    sourceLatestUpdateAt: null,
  };
}

export interface ParkingRestrictionsConnectorOptions {
  client?: OpenDataSoftClient;
}

export class ParkingRestrictionsConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  private readonly client: OpenDataSoftClient;

  constructor(options?: ParkingRestrictionsConnectorOptions | OpenDataSoftClient) {
    if (options instanceof OpenDataSoftClient) {
      this.client = options;
    } else {
      this.client = options?.client ?? new OpenDataSoftClient();
    }
  }

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) return failure(input, 'validation_failed');
    try {
      const response = await this.client.fetchRecords({
        portalUrl: 'https://data.melbourne.vic.gov.au',
        datasetId: DATASET_ID,
        orderBy: 'bayid ASC',
      });
      const sourceUpdatedAt = response.lastModified === null ? null
        : new Date(response.lastModified).toISOString();
      const sourceRecords: SourceRecord[] = [];
      const parkingRules: ParkingRule[] = [];
      const geoRecords: GeoRecord[] = [];
      const geoRecordSources: GeoRecordSource[] = [];
      const seen = new Set<number>();

      for (const unknownRow of response.records) {
        const row = parseRestrictionRow(unknownRow);
        if (seen.has(row.bayid)) return failure(input, 'validation_failed');
        seen.add(row.bayid);

        const rowValidFromRaw = row.valid_from ?? row.validfrom;
        const rowValidToRaw = row.valid_to ?? row.validto;
        const rowValidFrom = parseIsoTimestamp(rowValidFromRaw);
        const rowValidTo = parseIsoTimestamp(rowValidToRaw);
        if (rowValidFrom !== null && rowValidTo !== null && Date.parse(rowValidTo) < Date.parse(rowValidFrom)) {
          return failure(input, 'validation_failed');
        }

        const rowStatusInfo = parseRecordStatus(row.status ?? row.record_status);

        const recordId = sourceRecordId({
          sourceId: SOURCE_ID,
          nativeId: String(row.bayid),
          originalUrl: LANDING_URL,
          sourceTime: null,
        });
        const rowVersion = sourceVersionId(sourceUpdatedAt, row);

        sourceRecords.push({
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: response.fetchedAt,
          source_record_id: recordId,
          version_id: rowVersion,
          original_url: LANDING_URL,
          raw_uri: null,
          published_at: null,
          observed_at: null,
          first_accessible_at: null,
          time_missing_reason: 'No per-bay rule publication time',
          valid_from: rowValidFrom,
          valid_to: rowValidTo,
          source_updated_at: sourceUpdatedAt,
          source_version_ordinal: null,
          record_status: rowStatusInfo.sourceRecordStatus,
          assertion_kind: 'plan',
          rights_status: 'review_required',
        });

        for (let slotNumber = 1; slotNumber <= 6; slotNumber += 1) {
          const slot = parseRestrictionSlot(slotNumber, row);
          if (slot === null) continue;

          const ruleId = `${recordId}:slot${slotNumber}`;
          const versionId = sourceVersionId(sourceUpdatedAt, slot);
          const days = daysInInclusiveRange(slot.fromDay, slot.toDay);
          const startMin = timeMinute(slot.startTime);
          let endMin = timeMinute(slot.endTime);
          if (endMin === 0 && startMin !== null && startMin > 0) {
            endMin = 1440;
          }
          const vehicleClass = inferVehicleClass(slot.typeDesc, slot.description);
          const slotStatusInfo = parseRecordStatus(slot.status ?? row.status ?? row.record_status);
          const slotValidFrom = slot.validFrom ?? rowValidFrom;
          const slotValidTo = slot.validTo ?? rowValidTo;

          parkingRules.push({
            batch_id: input.runId,
            source_id: SOURCE_ID,
            schema_version: 1,
            fetched_at: response.fetchedAt,
            rule_id: ruleId,
            version_id: versionId,
            bay_id: `restriction_bay:${row.bayid}`,
            days_of_week: days,
            start_minute_of_day: startMin,
            end_minute_of_day: endMin,
            holiday_applicability: slot.holidayApplicability,
            vehicle_class: vehicleClass,
            restriction_type: slot.typeDesc,
            max_stay_minutes: slot.duration,
            exemption: slot.exemption,
            valid_from: slotValidFrom,
            valid_to: slotValidTo,
            source_record_id: recordId,
            source_updated_at: sourceUpdatedAt,
            source_version_ordinal: null,
          });

          geoRecords.push({
            batch_id: input.runId,
            source_id: SOURCE_ID,
            schema_version: 1,
            fetched_at: response.fetchedAt,
            geo_record_id: ruleId,
            version_id: versionId,
            topic: 'parking',
            assertion_kind: 'plan',
            title: slot.typeDesc,
            summary: slot.description,
            original_url: LANDING_URL,
            geometry_geojson: null,
            centroid_lat: null,
            centroid_lon: null,
            location_role: 'unknown',
            location_confidence: 'unverified',
            area_refs: [],
            published_at: null,
            observed_at: null,
            valid_from: slotValidFrom,
            valid_to: slotValidTo,
            source_updated_at: sourceUpdatedAt,
            source_version_ordinal: null,
            freshness_state: 'unknown',
            record_status: slotStatusInfo.geoRecordStatus,
            rights_status: 'review_required',
            public_query_allowed: false,
          });

          geoRecordSources.push({
            batch_id: input.runId,
            source_id: SOURCE_ID,
            schema_version: 1,
            fetched_at: response.fetchedAt,
            geo_record_id: ruleId,
            version_id: versionId,
            source_record_id: recordId,
            source_version_id: rowVersion,
            evidence_role: 'official_bay_restriction',
            original_url: LANDING_URL,
          });
        }
      }

      return {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: response.fetchedAt,
        sourceRevision: sourceUpdatedAt,
        sourceLatestUpdateAt: sourceUpdatedAt,
        checkpointAfter: input.window.kind === 'time' ? input.window.to : input.window.revision,
        completeness: {
          complete: true,
          method: 'pagination',
          expected_records: response.totalCount,
          fetched_records: response.records.length,
          expected_pages: response.pageCount,
          fetched_pages: response.pageCount,
          evidence: 'All source rows and numbered rule slots parsed',
        },
        inputCount: response.records.length,
        outputCount: parkingRules.length,
        rejectedCount: 0,
        sourceRecords,
        geoRecords,
        geoRecordSources,
        boundaries: [],
        areaIndicators: [],
        parkingBays: [],
        parkingObservations: [],
        parkingRules,
        sensorLocations: [],
        pedestrianObservations: [],
        retainableRawRecords: null,
      };
    } catch (error) {
      const code = error instanceof OdsIncompleteWindow ? 'incomplete_window'
        : error instanceof HttpFailure ? error.code
          : error instanceof z.ZodError ? 'schema_changed' : 'validation_failed';
      return failure(input, code);
    }
  }
}

export const connector: Connector = new ParkingRestrictionsConnector();
