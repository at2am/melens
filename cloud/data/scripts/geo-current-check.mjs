// Read-only check that the narrowed current-records SELECT returns exactly what
// v_geo_records_current returns for the given sources. Prints the comparison SQL.
// Usage: node scripts/geo-current-check.mjs PROJECT_ID [INGEST_DATASET]
import { currentGeoRecordsSelect, readCoreViewSql } from '../dist/src/core/geo-records-current.js';

const [projectId, ingestDataset = 'melens_ingest'] = process.argv.slice(2);
if (!projectId) {
  process.stderr.write('Usage: node scripts/geo-current-check.mjs PROJECT_ID [INGEST_DATASET]\n');
  process.exit(2);
}
const narrowed = currentGeoRecordsSelect(readCoreViewSql(), { projectId, ingestDataset });
// GEOGRAPHY cannot be compared with EXCEPT; its GeoJSON text is compared instead.
const columns = `* EXCEPT (geometry, area_refs), ST_ASTEXT(geometry) AS geometry_wkt, TO_JSON_STRING(area_refs) AS area_refs_json`;
process.stdout.write(`WITH narrowed AS (SELECT ${columns} FROM (${narrowed}) WHERE source_id IN UNNEST(@sourceIds)),
view_rows AS (SELECT ${columns} FROM \`${projectId}.melens_query.v_geo_records_current\` WHERE source_id IN UNNEST(@sourceIds))
SELECT (SELECT COUNT(*) FROM narrowed) AS narrowed_rows, (SELECT COUNT(*) FROM view_rows) AS view_rows,
  (SELECT COUNT(*) FROM (SELECT * FROM narrowed EXCEPT DISTINCT SELECT * FROM view_rows)) AS only_narrowed,
  (SELECT COUNT(*) FROM (SELECT * FROM view_rows EXCEPT DISTINCT SELECT * FROM narrowed)) AS only_view`);
