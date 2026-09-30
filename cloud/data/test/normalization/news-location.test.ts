import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseLocationMentions } from '../../src/connectors/gdelt/index.js';
import type { AreaRef } from '../../src/normalization/areas.js';
import {
  classifyGdeltMentions,
  classifyReportedIncidentSite,
  isOverseasSameName,
  resolveAreaScope,
  resolveNewsScope,
} from '../../src/normalization/news-location.js';

const melbourneLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '24600',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:24600:2025',
  name: 'Melbourne',
};

const comMunicipal: AreaRef = {
  scheme: 'COM_MUNICIPAL',
  code: '1',
  vintage: '2025',
  boundaryId: 'COM_MUNICIPAL:1:2025',
  name: 'City of Melbourne',
};

const greaterMelbourneGccsa: AreaRef = {
  scheme: 'ASGS_GCCSA',
  code: '2GMEL',
  vintage: '2026',
  boundaryId: 'ASGS_GCCSA:2GMEL:2026',
  name: 'Greater Melbourne',
};

const victoriaState: AreaRef = {
  scheme: 'ASGS_STE',
  code: '2',
  vintage: '2026',
  boundaryId: 'ASGS_STE:2:2026',
  name: 'Victoria',
};

const richmondArea: AreaRef = {
  scheme: 'ASGS_SA2',
  code: '206071142',
  vintage: '2026',
  boundaryId: 'ASGS_SA2:206071142:2026',
  name: 'Richmond',
};

const portPhillipLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '25900',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:25900:2025',
  name: 'Port Phillip',
};

const maribyrnongLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '24330',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:24330:2025',
  name: 'Maribyrnong',
};

const yarraLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '27350',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:27350:2025',
  name: 'Yarra',
};

const merriBekLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '25250',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:25250:2025',
  name: 'Merri-bek',
};

const greaterGeelongLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '22750',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:22750:2025',
  name: 'Greater Geelong',
};

const ballaratLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '20570',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:20570:2025',
  name: 'Ballarat',
};

const bendigoLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '22620',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:22620:2025',
  name: 'Greater Bendigo',
};

const latrobeLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '23810',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:23810:2025',
  name: 'Latrobe',
};

const sheppartonLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '22850',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:22850:2025',
  name: 'Greater Shepparton',
};

const colacOtwayLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '21750',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:21750:2025',
  name: 'Colac-Otway',
};

const milduraLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '24780',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:24780:2025',
  name: 'Mildura',
};

const warrnamboolLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '26700',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:26700:2025',
  name: 'Warrnambool',
};

const geelongSa2: AreaRef = {
  scheme: 'ASGS_SA2',
  code: '203011037',
  vintage: '2026',
  boundaryId: 'ASGS_SA2:203011037:2026',
  name: 'Geelong',
};

const ballaratSa2: AreaRef = {
  scheme: 'ASGS_SA2',
  code: '201011001',
  vintage: '2026',
  boundaryId: 'ASGS_SA2:201011001:2026',
  name: 'Ballarat',
};

const sydneyLga: AreaRef = {
  scheme: 'ASGS_LGA',
  code: '17200',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:17200:2025',
  name: 'Sydney',
};

const sydneySa2: AreaRef = {
  scheme: 'ASGS_SA2',
  code: '117031335',
  vintage: '2026',
  boundaryId: 'ASGS_SA2:117031335:2026',
  name: 'Sydney Inner',
};

const allOfficialAreas = [
  melbourneLga,
  comMunicipal,
  greaterMelbourneGccsa,
  victoriaState,
  richmondArea,
  portPhillipLga,
  maribyrnongLga,
  yarraLga,
  merriBekLga,
  greaterGeelongLga,
  ballaratLga,
  bendigoLga,
  latrobeLga,
  sheppartonLga,
  colacOtwayLga,
  milduraLga,
  warrnamboolLga,
  geelongSa2,
  ballaratSa2,
];

// --- 1. Disambiguation & Overseas Same-Name Tests ---

test('disambiguation: identifies overseas Melbourne and keeps it unlocated', () => {
  // Melbourne, Florida (alone)
  const floridaMention = {
    name: 'Melbourne, Florida, United States',
    countryCode: 'US',
    adm1Code: 'USFL',
    featureId: null,
  };
  const floridaResult = classifyGdeltMentions([floridaMention], allOfficialAreas);
  assert.equal(floridaResult.locationRole, 'unknown');
  assert.equal(floridaResult.geometryGeojson, null);
  assert.deepEqual(floridaResult.areaRefs, []);
  assert.equal(floridaResult.scope, 'unknown');
  assert.equal(floridaResult.reason, 'overseas_same_name');

  // Melbourne, Derbyshire, UK (alone)
  const ukMention = {
    name: 'Melbourne, Derbyshire, United Kingdom',
    countryCode: 'UK',
    adm1Code: 'UK00',
    featureId: null,
  };
  const ukResult = classifyGdeltMentions([ukMention], allOfficialAreas);
  assert.equal(ukResult.locationRole, 'unknown');
  assert.equal(ukResult.geometryGeojson, null);
  assert.deepEqual(ukResult.areaRefs, []);
  assert.equal(ukResult.scope, 'unknown');
  assert.equal(ukResult.reason, 'overseas_same_name');

  // Melbourne, Arkansas (alone)
  const arkansasMention = {
    name: 'Melbourne, Arkansas, United States',
    countryCode: 'US',
    adm1Code: 'USAR',
    featureId: null,
  };
  const arkResult = classifyGdeltMentions([arkansasMention], allOfficialAreas);
  assert.equal(arkResult.locationRole, 'unknown');
  assert.equal(arkResult.geometryGeojson, null);
  assert.deepEqual(arkResult.areaRefs, []);
  assert.equal(arkResult.scope, 'unknown');
  assert.equal(arkResult.reason, 'overseas_same_name');
});

test('disambiguation: ambiguous collision between Melbourne VIC and overseas Melbourne stays unlocated', () => {
  const vicMention = {
    name: 'Melbourne, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const floridaMention = {
    name: 'Melbourne, Florida, United States',
    countryCode: 'US',
    adm1Code: 'USFL',
    featureId: null,
  };

  const collisionResult = classifyGdeltMentions([vicMention, floridaMention], allOfficialAreas);
  assert.equal(collisionResult.locationRole, 'unknown');
  assert.equal(collisionResult.locationConfidence, 'unverified');
  assert.equal(collisionResult.geometryGeojson, null);
  assert.deepEqual(collisionResult.areaRefs, []);
  assert.equal(collisionResult.scope, 'unknown');
  assert.equal(collisionResult.reason, 'ambiguous_same_name');
});

test('disambiguation: overseas same-name places for non-Melbourne Victorian suburbs (e.g. Richmond VA vs VIC)', () => {
  const richmondVa = {
    name: 'Richmond, Virginia, United States',
    countryCode: 'US',
    adm1Code: 'USVA',
    featureId: null,
  };
  assert.equal(isOverseasSameName(richmondVa, allOfficialAreas), true);

  // Overseas Richmond alone remains unlocated
  const vaResult = classifyGdeltMentions([richmondVa], allOfficialAreas);
  assert.equal(vaResult.locationRole, 'unknown');
  assert.equal(vaResult.geometryGeojson, null);
  assert.deepEqual(vaResult.areaRefs, []);
  assert.equal(vaResult.scope, 'unknown');
  assert.equal(vaResult.reason, 'overseas_same_name');

  // Colliding Richmond VIC + Richmond VA remains ambiguous and unlocated
  const richmondVic = {
    name: 'Richmond, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const collisionResult = classifyGdeltMentions([richmondVic, richmondVa], allOfficialAreas);
  assert.equal(collisionResult.locationRole, 'unknown');
  assert.equal(collisionResult.geometryGeojson, null);
  assert.deepEqual(collisionResult.areaRefs, []);
  assert.equal(collisionResult.reason, 'ambiguous_same_name');
});

test('disambiguation: co-occurrence with non-conflicting overseas place does not collide', () => {
  const vicMention = {
    name: 'Melbourne, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const londonMention = {
    name: 'London, United Kingdom',
    countryCode: 'UK',
    adm1Code: 'UKGL',
    featureId: null,
  };
  const tokyoMention = {
    name: 'Tokyo, Japan',
    countryCode: 'JA',
    adm1Code: 'JA40',
    featureId: null,
  };

  const result = classifyGdeltMentions([vicMention, londonMention, tokyoMention], [melbourneLga]);
  assert.equal(result.locationRole, 'mentioned_place');
  assert.equal(result.locationConfidence, 'unverified');
  assert.equal(result.geometryGeojson, null);
  assert.deepEqual(result.areaRefs, [melbourneLga.boundaryId]);
  assert.equal(result.scope, 'city');
  assert.equal(result.reason, 'official_place_mention');
});

test('disambiguation: multiple Victorian place mentions resolve to union of areaRefs and highest scope', () => {
  const cityMention = {
    name: 'City of Melbourne, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const stateMention = {
    name: 'Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };

  const multiResult = classifyGdeltMentions(
    [cityMention, stateMention],
    [comMunicipal, victoriaState]
  );
  assert.equal(multiResult.locationRole, 'mentioned_place');
  assert.equal(multiResult.geometryGeojson, null);
  assert.deepEqual(multiResult.areaRefs, [victoriaState.boundaryId, comMunicipal.boundaryId]);
  // Precedence: city > greater_melbourne > victoria
  assert.equal(multiResult.scope, 'city');
  assert.equal(multiResult.reason, 'official_place_mention');
});

test('disambiguation: unverified Victorian mentions stay unlocated mentioned_place', () => {
  const unverifiedMention = {
    name: 'Fantasy Corner, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };

  const result = classifyGdeltMentions([unverifiedMention], allOfficialAreas);
  assert.equal(result.locationRole, 'mentioned_place');
  assert.equal(result.locationConfidence, 'unverified');
  assert.equal(result.geometryGeojson, null);
  assert.deepEqual(result.areaRefs, []);
  assert.equal(result.scope, 'unknown');
  assert.equal(result.reason, 'unverified_mention');
});

test('disambiguation: verifies against actual GDELT fixture rows', async () => {
  const fixtureUrl = new URL('../fixtures/gdelt.json', import.meta.url);
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8')) as {
    rows: Array<{ gkg_record_id: string; v2_locations: string }>;
  };

  // Row 1 (20260928184500-101): mentions both Melbourne VIC and Melbourne FL -> ambiguous collision
  const row1Mentions = parseLocationMentions(fixture.rows[0]!.v2_locations);
  const row1Result = classifyGdeltMentions(row1Mentions, [melbourneLga, victoriaState]);
  assert.equal(row1Result.locationRole, 'unknown');
  assert.equal(row1Result.reason, 'ambiguous_same_name');
  assert.equal(row1Result.geometryGeojson, null);
  assert.deepEqual(row1Result.areaRefs, []);
  assert.equal(row1Result.scope, 'unknown');

  // Row 2 (20260928184500-102): mentions only Melbourne FL -> overseas same-name
  const row2Mentions = parseLocationMentions(fixture.rows[1]!.v2_locations);
  const row2Result = classifyGdeltMentions(row2Mentions, [melbourneLga, victoriaState]);
  assert.equal(row2Result.locationRole, 'unknown');
  assert.equal(row2Result.reason, 'overseas_same_name');
  assert.equal(row2Result.geometryGeojson, null);
  assert.deepEqual(row2Result.areaRefs, []);
  assert.equal(row2Result.scope, 'unknown');
});

// --- 2. Mention vs Incident-Site Evidence Tests ---

test('mention vs incident site: GDELT place mentions are mentions only and never invent coordinates', () => {
  const mention = {
    name: 'Melbourne',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const result = classifyGdeltMentions([mention], [melbourneLga]);
  assert.equal(result.locationRole, 'mentioned_place');
  assert.equal(result.locationConfidence, 'unverified');
  assert.equal(result.geometryGeojson, null);
  assert.deepEqual(result.areaRefs, [melbourneLga.boundaryId]);
  assert.equal(result.scope, 'city');
});

test('mention vs incident site: explicit event-site evidence is required for promotion', () => {
  const base = {
    officialArea: melbourneLga,
    sourceCoordinate: [144.9631, -37.8136] as const,
    coordinateVerifiedInsideArea: true,
  };

  // Without explicit event-site evidence: cannot be promoted, remains unknown/unlocated
  const withoutEvidence = classifyReportedIncidentSite({
    ...base,
    sourceExplicitlySaysIncidentSite: false,
  });
  assert.equal(withoutEvidence.locationRole, 'unknown');
  assert.equal(withoutEvidence.geometryGeojson, null);
  assert.equal(withoutEvidence.reason, 'no_location');

  // With explicit event-site evidence: promoted to event_site with source_coordinate
  const withEvidence = classifyReportedIncidentSite({
    ...base,
    sourceExplicitlySaysIncidentSite: true,
  });
  assert.equal(withEvidence.locationRole, 'event_site');
  assert.equal(withEvidence.locationConfidence, 'source_coordinate');
  assert.equal(withEvidence.reason, 'source_event_point');
  assert.ok(withEvidence.geometryGeojson !== null);
  const parsedGeojson = JSON.parse(withEvidence.geometryGeojson);
  assert.equal(parsedGeojson.type, 'Point');
  assert.deepEqual(parsedGeojson.coordinates, [144.9631, -37.8136]);
});

test('mention vs incident site: regional-level incident site stays coarse area_only without fake point', () => {
  // Explicit incident site reported at regional LGA level with NO coordinates
  const regionalIncident = classifyReportedIncidentSite({
    sourceExplicitlySaysIncidentSite: true,
    officialArea: melbourneLga,
    sourceCoordinate: null,
    coordinateVerifiedInsideArea: false,
  });
  assert.equal(regionalIncident.locationRole, 'area_only');
  assert.equal(regionalIncident.locationConfidence, 'resolved_area');
  assert.equal(regionalIncident.geometryGeojson, null); // NEVER fabricates a point or centroid!
  assert.deepEqual(regionalIncident.areaRefs, [melbourneLga.boundaryId]);
  assert.equal(regionalIncident.scope, 'city');
  assert.equal(regionalIncident.reason, 'source_event_area');
});

// --- 3. Boundary Checks & Coordinate Validation Tests ---

test('boundary checks: invalid coordinates are quarantined', () => {
  const base = {
    sourceExplicitlySaysIncidentSite: true,
    officialArea: melbourneLga,
    coordinateVerifiedInsideArea: true,
  };

  // Longitude out of bounds (> 180 or < -180)
  const highLon = classifyReportedIncidentSite({ ...base, sourceCoordinate: [181.0, -37.81] });
  assert.equal(highLon.locationRole, 'unknown');
  assert.equal(highLon.geometryGeojson, null);
  assert.equal(highLon.reason, 'invalid_event_point');

  const lowLon = classifyReportedIncidentSite({ ...base, sourceCoordinate: [-181.0, -37.81] });
  assert.equal(lowLon.locationRole, 'unknown');
  assert.equal(lowLon.geometryGeojson, null);
  assert.equal(lowLon.reason, 'invalid_event_point');

  // Latitude out of bounds (> 90 or < -90)
  const highLat = classifyReportedIncidentSite({ ...base, sourceCoordinate: [144.96, 91.0] });
  assert.equal(highLat.locationRole, 'unknown');
  assert.equal(highLat.geometryGeojson, null);
  assert.equal(highLat.reason, 'invalid_event_point');

  const lowLat = classifyReportedIncidentSite({ ...base, sourceCoordinate: [144.96, -91.0] });
  assert.equal(lowLat.locationRole, 'unknown');
  assert.equal(lowLat.geometryGeojson, null);
  assert.equal(lowLat.reason, 'invalid_event_point');

  // Non-finite values: NaN and Infinity
  const nanCoord = classifyReportedIncidentSite({ ...base, sourceCoordinate: [Number.NaN, -37.81] });
  assert.equal(nanCoord.locationRole, 'unknown');
  assert.equal(nanCoord.geometryGeojson, null);
  assert.equal(nanCoord.reason, 'invalid_event_point');

  const infCoord = classifyReportedIncidentSite({
    ...base,
    sourceCoordinate: [144.96, Number.POSITIVE_INFINITY],
  });
  assert.equal(infCoord.locationRole, 'unknown');
  assert.equal(infCoord.geometryGeojson, null);
  assert.equal(infCoord.reason, 'invalid_event_point');
});

test('boundary checks: coordinates outside official boundary vintage are quarantined', () => {
  // Coordinate is syntactically valid, but NOT verified inside the official boundary
  const unverifiedPoint = classifyReportedIncidentSite({
    sourceExplicitlySaysIncidentSite: true,
    officialArea: melbourneLga,
    sourceCoordinate: [144.96, -37.81],
    coordinateVerifiedInsideArea: false,
  });

  assert.equal(unverifiedPoint.locationRole, 'unknown');
  assert.equal(unverifiedPoint.locationConfidence, 'unverified');
  assert.equal(unverifiedPoint.geometryGeojson, null); // Quarantined!
  assert.deepEqual(unverifiedPoint.areaRefs, [melbourneLga.boundaryId]);
  assert.equal(unverifiedPoint.scope, 'city');
  assert.equal(unverifiedPoint.reason, 'coordinate_outside_area');
});

test('boundary checks: missing official area keeps result unknown', () => {
  const result = classifyReportedIncidentSite({
    sourceExplicitlySaysIncidentSite: true,
    officialArea: null,
    sourceCoordinate: [144.96, -37.81],
    coordinateVerifiedInsideArea: true,
  });
  assert.equal(result.locationRole, 'unknown');
  assert.equal(result.geometryGeojson, null);
  assert.deepEqual(result.areaRefs, []);
  assert.equal(result.reason, 'no_location');
});

test('boundary checks: scope hierarchy correctly resolves city, greater_melbourne, victoria, and unknown', () => {
  // 1. City of Melbourne
  assert.equal(resolveAreaScope(melbourneLga), 'city');
  assert.equal(resolveAreaScope(comMunicipal), 'city');

  // 2. Greater Melbourne GCCSA, LGAs, and SA2s
  assert.equal(resolveAreaScope(greaterMelbourneGccsa), 'greater_melbourne');
  assert.equal(resolveAreaScope(richmondArea), 'greater_melbourne');
  assert.equal(resolveAreaScope(portPhillipLga), 'greater_melbourne');
  assert.equal(resolveAreaScope(maribyrnongLga), 'greater_melbourne');
  assert.equal(resolveAreaScope(yarraLga), 'greater_melbourne');
  assert.equal(resolveAreaScope(merriBekLga), 'greater_melbourne');

  // 3. Victoria State and Regional Victorian LGAs / SA2s outside Greater Melbourne
  assert.equal(resolveAreaScope(victoriaState), 'victoria');
  assert.equal(resolveAreaScope(greaterGeelongLga), 'victoria');
  assert.equal(resolveAreaScope(ballaratLga), 'victoria');
  assert.equal(resolveAreaScope(bendigoLga), 'victoria');
  assert.equal(resolveAreaScope(latrobeLga), 'victoria');
  assert.equal(resolveAreaScope(sheppartonLga), 'victoria');
  assert.equal(resolveAreaScope(colacOtwayLga), 'victoria');
  assert.equal(resolveAreaScope(milduraLga), 'victoria');
  assert.equal(resolveAreaScope(warrnamboolLga), 'victoria');
  assert.equal(resolveAreaScope(geelongSa2), 'victoria');
  assert.equal(resolveAreaScope(ballaratSa2), 'victoria');

  // 4. Unknown or outside Victoria
  const unknownArea: AreaRef = {
    scheme: 'CUSTOM_SCHEME',
    code: '999',
    vintage: '2026',
    boundaryId: 'CUSTOM_SCHEME:999:2026',
    name: 'Unknown Territory',
  };
  assert.equal(resolveAreaScope(unknownArea), 'unknown');
  assert.equal(resolveAreaScope(sydneyLga), 'unknown');
  assert.equal(resolveAreaScope(sydneySa2), 'unknown');

  // Precedence checks for resolveNewsScope (city > greater_melbourne > victoria > unknown)
  assert.equal(resolveNewsScope([melbourneLga, greaterMelbourneGccsa, victoriaState]), 'city');
  assert.equal(resolveNewsScope([melbourneLga, greaterGeelongLga]), 'city');
  assert.equal(resolveNewsScope([greaterMelbourneGccsa, victoriaState]), 'greater_melbourne');
  assert.equal(resolveNewsScope([portPhillipLga, greaterGeelongLga]), 'greater_melbourne');
  assert.equal(resolveNewsScope([greaterGeelongLga, ballaratLga]), 'victoria');
  assert.equal(resolveNewsScope([greaterGeelongLga, victoriaState]), 'victoria');
  assert.equal(resolveNewsScope([unknownArea, sydneyLga]), 'unknown');
  assert.equal(resolveNewsScope([]), 'unknown');
});

test('G05: regional Victorian cities (Geelong, Ballarat, Bendigo) resolve to victoria scope and handle mentions & incidents', () => {
  // 1. Scope assertions: Geelong and Ballarat MUST resolve to victoria, NOT greater_melbourne
  assert.equal(resolveAreaScope(greaterGeelongLga), 'victoria');
  assert.equal(resolveAreaScope(ballaratLga), 'victoria');
  assert.equal(resolveAreaScope(geelongSa2), 'victoria');
  assert.equal(resolveAreaScope(ballaratSa2), 'victoria');

  // 2. Mention in Greater Geelong resolves to victoria scope, mentioned_place, null coordinates
  const greaterGeelongMention = {
    name: 'Greater Geelong, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const greaterGeelongResult = classifyGdeltMentions([greaterGeelongMention], allOfficialAreas);
  assert.equal(greaterGeelongResult.locationRole, 'mentioned_place');
  assert.equal(greaterGeelongResult.locationConfidence, 'unverified');
  assert.equal(greaterGeelongResult.geometryGeojson, null);
  assert.deepEqual(greaterGeelongResult.areaRefs, [greaterGeelongLga.boundaryId]);
  assert.equal(greaterGeelongResult.scope, 'victoria');
  assert.equal(greaterGeelongResult.reason, 'official_place_mention');

  // Mention with colloquial/base name "Geelong" against LGA alone resolves via alias to greaterGeelongLga with scope victoria
  const geelongMention = {
    name: 'Geelong, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const geelongAliasResult = classifyGdeltMentions([geelongMention], [greaterGeelongLga]);
  assert.equal(geelongAliasResult.locationRole, 'mentioned_place');
  assert.equal(geelongAliasResult.geometryGeojson, null);
  assert.deepEqual(geelongAliasResult.areaRefs, [greaterGeelongLga.boundaryId]);
  assert.equal(geelongAliasResult.scope, 'victoria');
  assert.equal(geelongAliasResult.reason, 'official_place_mention');

  // Mention "Geelong" against official areas matching SA2 also resolves to scope victoria
  const geelongSa2Result = classifyGdeltMentions([geelongMention], allOfficialAreas);
  assert.equal(geelongSa2Result.locationRole, 'mentioned_place');
  assert.equal(geelongSa2Result.scope, 'victoria');
  assert.deepEqual(geelongSa2Result.areaRefs, [geelongSa2.boundaryId]);

  // 3. Mention in Ballarat resolves to victoria scope, mentioned_place, null coordinates
  const ballaratMention = {
    name: 'Ballarat, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const ballaratResult = classifyGdeltMentions([ballaratMention], allOfficialAreas);
  assert.equal(ballaratResult.locationRole, 'mentioned_place');
  assert.equal(ballaratResult.locationConfidence, 'unverified');
  assert.equal(ballaratResult.geometryGeojson, null);
  assert.deepEqual(ballaratResult.areaRefs, [ballaratLga.boundaryId, ballaratSa2.boundaryId].sort());
  assert.equal(ballaratResult.scope, 'victoria');
  assert.equal(ballaratResult.reason, 'official_place_mention');

  // 4. Multi-location: Greater Geelong (victoria) + Port Phillip (greater_melbourne) -> greater_melbourne
  const portPhillipMention = {
    name: 'Port Phillip, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const multiResult = classifyGdeltMentions([greaterGeelongMention, portPhillipMention], allOfficialAreas);
  assert.equal(multiResult.scope, 'greater_melbourne');
  assert.deepEqual(multiResult.areaRefs, [greaterGeelongLga.boundaryId, portPhillipLga.boundaryId].sort());

  // 5. Multi-location: Greater Geelong (victoria) + Ballarat (victoria) -> victoria
  const regionalMulti = classifyGdeltMentions([greaterGeelongMention, ballaratMention], allOfficialAreas);
  assert.equal(regionalMulti.scope, 'victoria');
  assert.deepEqual(
    regionalMulti.areaRefs,
    [ballaratLga.boundaryId, ballaratSa2.boundaryId, greaterGeelongLga.boundaryId].sort()
  );

  // 6. Multi-location: Greater Geelong (victoria) + Melbourne (city) -> city
  const cityMention = {
    name: 'Melbourne, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const cityWithRegional = classifyGdeltMentions([cityMention, greaterGeelongMention], allOfficialAreas);
  assert.equal(cityWithRegional.scope, 'city');

  // 7. Explicit reported incident site in Greater Geelong without coordinates -> area_only, victoria, null coordinates
  const regionalIncidentAreaOnly = classifyReportedIncidentSite({
    sourceExplicitlySaysIncidentSite: true,
    officialArea: greaterGeelongLga,
    sourceCoordinate: null,
    coordinateVerifiedInsideArea: false,
  });
  assert.equal(regionalIncidentAreaOnly.locationRole, 'area_only');
  assert.equal(regionalIncidentAreaOnly.locationConfidence, 'resolved_area');
  assert.equal(regionalIncidentAreaOnly.geometryGeojson, null);
  assert.deepEqual(regionalIncidentAreaOnly.areaRefs, [greaterGeelongLga.boundaryId]);
  assert.equal(regionalIncidentAreaOnly.scope, 'victoria');
  assert.equal(regionalIncidentAreaOnly.reason, 'source_event_area');

  // 8. Explicit reported incident site in Ballarat with verified coordinates -> event_site, victoria, source coordinates
  const regionalIncidentPoint = classifyReportedIncidentSite({
    sourceExplicitlySaysIncidentSite: true,
    officialArea: ballaratLga,
    sourceCoordinate: [143.8503, -37.5622],
    coordinateVerifiedInsideArea: true,
  });
  assert.equal(regionalIncidentPoint.locationRole, 'event_site');
  assert.equal(regionalIncidentPoint.locationConfidence, 'source_coordinate');
  assert.ok(regionalIncidentPoint.geometryGeojson !== null);
  assert.equal(JSON.parse(regionalIncidentPoint.geometryGeojson).type, 'Point');
  assert.deepEqual(JSON.parse(regionalIncidentPoint.geometryGeojson).coordinates, [143.8503, -37.5622]);
  assert.deepEqual(regionalIncidentPoint.areaRefs, [ballaratLga.boundaryId]);
  assert.equal(regionalIncidentPoint.scope, 'victoria');
  assert.equal(regionalIncidentPoint.reason, 'source_event_point');
});

test('boundary checks: empty mentions array returns unknown with reason no_location', () => {
  const empty = classifyGdeltMentions([], allOfficialAreas);
  assert.equal(empty.locationRole, 'unknown');
  assert.equal(empty.geometryGeojson, null);
  assert.deepEqual(empty.areaRefs, []);
  assert.equal(empty.scope, 'unknown');
  assert.equal(empty.reason, 'no_location');
});

