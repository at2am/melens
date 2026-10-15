// Print a geo_records_current refresh script for review or a manual run.
// Usage: node scripts/geo-current-sql.mjs rebuild|apply PROJECT_ID [INGEST_DATASET]
import { applyGeoRecordsCurrentBatchesSql, readCoreViewSql, rebuildGeoRecordsCurrentSql }
  from '../dist/src/core/geo-records-current.js';

const [kind, projectId, ingestDataset = 'melens_ingest'] = process.argv.slice(2);
if (!projectId || !['rebuild', 'apply'].includes(kind)) {
  process.stderr.write('Usage: node scripts/geo-current-sql.mjs rebuild|apply PROJECT_ID [INGEST_DATASET]\n');
  process.exit(2);
}
const config = { projectId, ingestDataset };
process.stdout.write(kind === 'rebuild' ? rebuildGeoRecordsCurrentSql(config, readCoreViewSql())
  : applyGeoRecordsCurrentBatchesSql(config));
