import type { GdeltLocationMention } from '../connectors/gdelt/index.js';
import type { LocationConfidence, LocationRole } from '../core/types.js';
import type { AreaRef } from './areas.js';

export type NewsScope = 'city' | 'greater_melbourne' | 'victoria' | 'unknown';

export interface NewsLocation {
  locationRole: LocationRole;
  locationConfidence: LocationConfidence;
  geometryGeojson: string | null;
  areaRefs: readonly string[];
  scope: NewsScope;
  reason:
    | 'source_event_point'
    | 'source_event_area'
    | 'official_place_mention'
    | 'ambiguous_same_name'
    | 'overseas_same_name'
    | 'unverified_mention'
    | 'invalid_event_point'
    | 'coordinate_outside_area'
    | 'no_location';
}

function nameKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-AU')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function primaryPlaceName(rawName: string): string {
  const first = rawName.split(',')[0] ?? rawName;
  return first.trim();
}

function baseNameKey(value: string): string {
  return nameKey(primaryPlaceName(value));
}

/** Check if two area/mention names refer to the same logical name, accounting for commas and aliases. */
function placeNamesMatch(mentionName: string, area: AreaRef): boolean {
  const mentionFull = nameKey(mentionName);
  const mentionBase = baseNameKey(mentionName);
  const areaFull = nameKey(area.name);
  const areaBase = baseNameKey(area.name);

  if (mentionFull === areaFull || mentionBase === areaFull || mentionBase === areaBase) {
    return true;
  }

  // City of Melbourne aliases
  const isCityOfMelbourne =
    area.scheme.toUpperCase() === 'COM_MUNICIPAL' ||
    (area.scheme.toUpperCase() === 'ASGS_LGA' && area.code === '24600') ||
    areaFull === 'city of melbourne' ||
    areaFull === 'melbourne';

  if (
    isCityOfMelbourne &&
    (mentionBase === 'melbourne' ||
      mentionBase === 'city of melbourne' ||
      mentionBase === 'melbourne cbd' ||
      mentionBase === 'melbourne city centre' ||
      mentionBase === 'melbourne city')
  ) {
    return true;
  }

  // Greater Geelong aliases
  const isGreaterGeelong =
    (area.scheme.toUpperCase() === 'ASGS_LGA' && area.code === '22750') ||
    areaFull === 'greater geelong' ||
    areaFull === 'geelong';

  if (isGreaterGeelong && (mentionBase === 'geelong' || mentionBase === 'greater geelong')) {
    return true;
  }

  // Greater Bendigo aliases
  const isGreaterBendigo =
    (area.scheme.toUpperCase() === 'ASGS_LGA' && area.code === '22620') ||
    areaFull === 'greater bendigo' ||
    areaFull === 'bendigo';

  if (isGreaterBendigo && (mentionBase === 'bendigo' || mentionBase === 'greater bendigo')) {
    return true;
  }

  // Greater Shepparton aliases
  const isGreaterShepparton =
    (area.scheme.toUpperCase() === 'ASGS_LGA' && area.code === '22850') ||
    areaFull === 'greater shepparton' ||
    areaFull === 'shepparton';

  if (isGreaterShepparton && (mentionBase === 'shepparton' || mentionBase === 'greater shepparton')) {
    return true;
  }

  return false;
}

/**
 * Official ABS ASGS LGA codes within Greater Melbourne GCCSA (2GMEL),
 * excluding City of Melbourne (24600) which has scope 'city'.
 */
const GREATER_MELBOURNE_LGA_CODES = new Set<string>([
  '20660', // Banyule
  '20910', // Bayside
  '21110', // Boroondara
  '21180', // Brimbank
  '21450', // Cardinia
  '21610', // Casey
  '21890', // Darebin
  '22170', // Frankston
  '22670', // Glen Eira
  '22830', // Greater Dandenong
  '23110', // Hobsons Bay
  '23270', // Hume
  '23430', // Kingston
  '23670', // Knox
  '24210', // Manningham
  '24330', // Maribyrnong
  '24410', // Maroondah
  '24650', // Melton
  '25060', // Moonee Valley
  '25250', // Merri-bek (formerly Moreland)
  '25310', // Mornington Peninsula
  '25340', // Monash
  '25710', // Nillumbik
  '25900', // Port Phillip
  '26350', // Stonnington
  '26980', // Whitehorse
  '27070', // Whittlesea
  '27260', // Wyndham
  '27350', // Yarra
  '27450', // Yarra Ranges
]);

/**
 * Normalized name keys for Greater Melbourne LGAs.
 */
const GREATER_MELBOURNE_LGA_NAMES = new Set<string>([
  'banyule',
  'bayside',
  'boroondara',
  'brimbank',
  'cardinia',
  'casey',
  'darebin',
  'frankston',
  'glen eira',
  'greater dandenong',
  'hobsons bay',
  'hume',
  'kingston',
  'knox',
  'manningham',
  'maribyrnong',
  'maroondah',
  'melton',
  'merri bek',
  'merribek',
  'moreland',
  'monash',
  'moonee valley',
  'mornington peninsula',
  'nillumbik',
  'port phillip',
  'stonnington',
  'whitehorse',
  'whittlesea',
  'wyndham',
  'yarra',
  'yarra ranges',
]);

/**
 * Common regional Victorian LGA and regional city names outside Greater Melbourne.
 */
const REGIONAL_VICTORIAN_NAMES = new Set<string>([
  'greater geelong',
  'geelong',
  'ballarat',
  'greater bendigo',
  'bendigo',
  'latrobe',
  'greater shepparton',
  'shepparton',
  'colac otway',
  'colac otway shire',
  'mildura',
  'warrnambool',
  'wodonga',
  'wangaratta',
  'bass coast',
  'baw baw',
  'south gippsland',
  'east gippsland',
  'wellington',
  'mitchell',
  'macedon ranges',
  'moorabool',
  'golden plains',
  'surf coast',
  'queenscliffe',
  'campaspe',
  'central goldfields',
  'corangamite',
  'glenelg',
  'hepburn',
  'horsham',
  'loddon',
  'mansfield',
  'mount alexander',
  'moyne',
  'murrindindi',
  'northern grampians',
  'pyrenees',
  'southern grampians',
  'strathbogie',
  'swan hill',
  'towong',
  'benalla',
  'alpine',
  'ararat',
  'buloke',
  'gannawarra',
  'hindmarsh',
  'indigo',
  'west wimmera',
  'yarriambiack',
]);

function cleanAreaName(key: string): string {
  return key
    .replace(/^(city of|shire of|rural city of|borough of|town of|municipality of)\s+/, '')
    .replace(/\s+(city|shire|rural city|borough|town)$/, '')
    .trim();
}

/** Resolves the geographic scope hierarchy of a single official area. */
export function resolveAreaScope(area: AreaRef): NewsScope {
  const scheme = area.scheme.toUpperCase();
  const code = area.code.toUpperCase();
  const key = nameKey(area.name);
  const cleaned = cleanAreaName(key);

  // 1. City of Melbourne municipal / LGA (24600)
  if (
    scheme === 'COM_MUNICIPAL' ||
    (scheme === 'ASGS_LGA' && (code === '24600' || cleaned === 'melbourne')) ||
    (scheme === 'VICMAP_LGA' && code === '24600') ||
    key === 'city of melbourne'
  ) {
    return 'city';
  }

  // 2. Greater Melbourne GCCSA
  if ((scheme === 'ASGS_GCCSA' && code === '2GMEL') || key === 'greater melbourne') {
    return 'greater_melbourne';
  }

  // 3. Victoria State
  if ((scheme === 'ASGS_STE' && code === '2') || key === 'victoria') {
    return 'victoria';
  }

  // Rest of Victoria GCCSA (2RVIC)
  if (
    scheme === 'ASGS_GCCSA' &&
    (code === '2RVIC' || key === 'rest of vic' || key === 'rest of victoria')
  ) {
    return 'victoria';
  }

  // 4. Local Government Areas (ASGS_LGA or VICMAP_LGA)
  if (scheme === 'ASGS_LGA' || scheme === 'VICMAP_LGA') {
    // Greater Melbourne LGAs (outside City of Melbourne)
    if (
      GREATER_MELBOURNE_LGA_CODES.has(code) ||
      GREATER_MELBOURNE_LGA_NAMES.has(cleaned) ||
      GREATER_MELBOURNE_LGA_NAMES.has(key)
    ) {
      return 'greater_melbourne';
    }

    // Official Victorian LGA codes start with '2' and are 5 digits (e.g. 22750 Greater Geelong, 20570 Ballarat)
    if (
      /^2\d{4}$/.test(code) ||
      REGIONAL_VICTORIAN_NAMES.has(cleaned) ||
      REGIONAL_VICTORIAN_NAMES.has(key)
    ) {
      return 'victoria';
    }

    // LGA code not starting with '2' (e.g. NSW LGA starting with '1') or lacking relationship evidence
    return 'unknown';
  }

  // 5. Statistical Area Level 2 (ASGS_SA2)
  if (scheme === 'ASGS_SA2') {
    // In ABS ASGS, SA2 codes are 9 digits:
    // Greater Melbourne (2GMEL) SA4s are 206 through 214
    if (
      /^2(0[6-9]|1[0-4])\d{6}$/.test(code) ||
      code.startsWith('206') ||
      code.startsWith('207') ||
      code.startsWith('208') ||
      code.startsWith('209') ||
      code.startsWith('210') ||
      code.startsWith('211') ||
      code.startsWith('212') ||
      code.startsWith('213') ||
      code.startsWith('214')
    ) {
      return 'greater_melbourne';
    }

    // Rest of Victoria (2RVIC) SA4s are 201..205, 215..217
    if (
      /^2(0[1-5]|1[5-7])\d{6}$/.test(code) ||
      code.startsWith('201') ||
      code.startsWith('202') ||
      code.startsWith('203') ||
      code.startsWith('204') ||
      code.startsWith('205') ||
      code.startsWith('215') ||
      code.startsWith('216') ||
      code.startsWith('217')
    ) {
      return 'victoria';
    }

    // Check by name if code is short or unformatted
    if (GREATER_MELBOURNE_LGA_NAMES.has(cleaned) || GREATER_MELBOURNE_LGA_NAMES.has(key)) {
      return 'greater_melbourne';
    }
    if (REGIONAL_VICTORIAN_NAMES.has(cleaned) || REGIONAL_VICTORIAN_NAMES.has(key)) {
      return 'victoria';
    }

    // SA2 code starting with '2' (other Victorian SA2)
    if (/^2\d{8}$/.test(code) || /^2\d{4}$/.test(code)) {
      return 'victoria';
    }

    return 'unknown';
  }

  return 'unknown';
}

/** Resolves the most specific scope from a list of matched official areas. */
export function resolveNewsScope(areas: readonly AreaRef[]): NewsScope {
  if (areas.length === 0) return 'unknown';
  const scopes = areas.map(resolveAreaScope);
  if (scopes.includes('city')) return 'city';
  if (scopes.includes('greater_melbourne')) return 'greater_melbourne';
  if (scopes.includes('victoria')) return 'victoria';
  return 'unknown';
}

/** Check if a location mention is an overseas same-name place for Melbourne / Victorian areas. */
export function isOverseasSameName(
  mention: GdeltLocationMention,
  officialVictorianAreas: readonly AreaRef[] = []
): boolean {
  const isVic = mention.countryCode === 'AS' && mention.adm1Code === 'AS07';
  if (isVic) return false;

  const baseKey = baseNameKey(mention.name);
  if (baseKey === 'melbourne' || baseKey === 'city of melbourne') return true;

  return officialVictorianAreas.some(area => {
    const areaBase = baseNameKey(area.name);
    const areaFull = nameKey(area.name);
    if (areaBase === baseKey || areaFull === baseKey) return true;
    if ((area.code === '22750' || areaFull === 'greater geelong') && baseKey === 'geelong') return true;
    if ((area.code === '22620' || areaFull === 'greater bendigo') && baseKey === 'bendigo') return true;
    if ((area.code === '22850' || areaFull === 'greater shepparton') && baseKey === 'shepparton') return true;
    return false;
  });
}

/**
 * GKG V2Locations are mentions, not proof that an event happened there.
 * Identifies City of Melbourne, Greater Melbourne, Victoria, and overseas same-name places.
 * Retains mentioned places as mentioned_place, keeps areaRefs, never invents coordinates.
 */
export function classifyGdeltMentions(
  mentions: readonly GdeltLocationMention[],
  officialVictorianAreas: readonly AreaRef[]
): NewsLocation {
  if (mentions.length === 0) {
    return {
      locationRole: 'unknown',
      locationConfidence: 'unverified',
      geometryGeojson: null,
      areaRefs: [],
      scope: 'unknown',
      reason: 'no_location',
    };
  }

  const victorian = mentions.filter(
    mention => mention.countryCode === 'AS' && mention.adm1Code === 'AS07'
  );
  const nonVictorian = mentions.filter(
    mention => mention.countryCode !== 'AS' || mention.adm1Code !== 'AS07'
  );

  // If no Victorian mentions exist:
  if (victorian.length === 0) {
    const hasOverseasSameName = nonVictorian.some(m => isOverseasSameName(m, officialVictorianAreas));
    return {
      locationRole: 'unknown',
      locationConfidence: 'unverified',
      geometryGeojson: null,
      areaRefs: [],
      scope: 'unknown',
      reason: hasOverseasSameName ? 'overseas_same_name' : 'no_location',
    };
  }

  // Check for ambiguous same-name overseas mentions
  const overseasBaseNames = new Set(nonVictorian.map(m => baseNameKey(m.name)));
  const overseasFullNames = new Set(nonVictorian.map(m => nameKey(m.name)));

  if (
    victorian.some(
      mention =>
        overseasBaseNames.has(baseNameKey(mention.name)) ||
        overseasFullNames.has(nameKey(mention.name))
    )
  ) {
    return {
      locationRole: 'unknown',
      locationConfidence: 'unverified',
      geometryGeojson: null,
      areaRefs: [],
      scope: 'unknown',
      reason: 'ambiguous_same_name',
    };
  }

  // Resolve Victorian mentions to official boundary IDs
  const refs = new Set<string>();
  for (const mention of victorian) {
    const mentionFull = nameKey(mention.name);
    const mentionBase = baseNameKey(mention.name);

    // 1. Try exact matches on full or base name
    const exactMatches = officialVictorianAreas.filter(area => {
      const areaFull = nameKey(area.name);
      const areaBase = baseNameKey(area.name);
      return areaFull === mentionFull || areaFull === mentionBase || areaBase === mentionBase;
    });

    if (exactMatches.length === 1 && exactMatches[0]) {
      refs.add(exactMatches[0].boundaryId);
    } else if (exactMatches.length > 1) {
      for (const m of exactMatches) {
        refs.add(m.boundaryId);
      }
    } else {
      // 2. Fall back to alias matches
      const aliasMatches = officialVictorianAreas.filter(area => placeNamesMatch(mention.name, area));
      if (aliasMatches.length === 1 && aliasMatches[0]) {
        refs.add(aliasMatches[0].boundaryId);
      } else if (aliasMatches.length > 1) {
        const firstScope = resolveAreaScope(aliasMatches[0]!);
        if (aliasMatches.every(a => resolveAreaScope(a) === firstScope)) {
          for (const a of aliasMatches) {
            refs.add(a.boundaryId);
          }
        }
      }
    }
  }

  const areaRefs = [...refs].sort();
  const matchedAreas = officialVictorianAreas.filter(area => refs.has(area.boundaryId));
  const scope = resolveNewsScope(matchedAreas);

  return {
    locationRole: 'mentioned_place',
    locationConfidence: 'unverified',
    geometryGeojson: null,
    areaRefs,
    scope,
    reason: refs.size > 0 ? 'official_place_mention' : 'unverified_mention',
  };
}

/**
 * Only explicit incident-site evidence may be promoted beyond a mention.
 * Regional-level incidents stay coarse (area_only), never inventing a fake point.
 * Coordinates are validated and verified against official boundaries; invalid/unverified points are quarantined.
 */
export function classifyReportedIncidentSite(input: {
  sourceExplicitlySaysIncidentSite: boolean;
  officialArea: AreaRef | null;
  sourceCoordinate: readonly [number, number] | null;
  /** Result of checking the source coordinate against the selected official boundary vintage. */
  coordinateVerifiedInsideArea: boolean;
}): NewsLocation {
  const unknown: NewsLocation = {
    locationRole: 'unknown',
    locationConfidence: 'unverified',
    geometryGeojson: null,
    areaRefs: [],
    scope: 'unknown',
    reason: 'no_location',
  };

  if (!input.sourceExplicitlySaysIncidentSite || input.officialArea === null) {
    return unknown;
  }

  const areaRefs = [input.officialArea.boundaryId];
  const scope = resolveAreaScope(input.officialArea);

  // Regional-level incident without coordinates: keep as coarse area_only, never invent a point
  if (input.sourceCoordinate === null) {
    return {
      locationRole: 'area_only',
      locationConfidence: 'resolved_area',
      geometryGeojson: null,
      areaRefs,
      scope,
      reason: 'source_event_area',
    };
  }

  const [longitude, latitude] = input.sourceCoordinate;

  // Invalid coordinates: quarantine from geographic mapping
  if (
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    return {
      locationRole: 'unknown',
      locationConfidence: 'unverified',
      geometryGeojson: null,
      areaRefs,
      scope,
      reason: 'invalid_event_point',
    };
  }

  // Coordinate not verified inside the official boundary vintage: quarantine
  if (!input.coordinateVerifiedInsideArea) {
    return {
      ...unknown,
      areaRefs,
      scope,
      reason: 'coordinate_outside_area',
    };
  }

  // Verified source event point
  return {
    locationRole: 'event_site',
    locationConfidence: 'source_coordinate',
    geometryGeojson: JSON.stringify({ type: 'Point', coordinates: [longitude, latitude] }),
    areaRefs,
    scope,
    reason: 'source_event_point',
  };
}

