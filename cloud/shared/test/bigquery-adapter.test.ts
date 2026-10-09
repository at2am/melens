import assert from 'node:assert/strict';
import test from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';

import { clientQueryParameters } from '../src/query/bigquery-adapter.js';

const prepared = {
  params: { from: '2026-10-09T07:00:00Z', to: '2026-10-16T12:59:59Z', day: '2026-10-09',
    topic: 'event', resultLimit: 1001, west: 144.6 },
  types: { from: 'TIMESTAMP', to: 'TIMESTAMP', day: 'DATE', topic: 'STRING', resultLimit: 'INT64', west: 'FLOAT64' },
} as const;

/** What the job request carries for one named parameter, exactly as the client builds it. */
function boundValue(value: unknown, type: string): unknown {
  return BigQuery.valueToQueryParameter_(value, type).parameterValue?.value;
}

test('a plain string bound with an explicit TIMESTAMP or DATE type reaches BigQuery as NULL', () => {
  // The regression this adapter guards against: the client expects its own value wrappers here.
  assert.equal(boundValue(prepared.params.from, 'TIMESTAMP'), undefined);
  assert.equal(boundValue(prepared.params.day, 'DATE'), undefined);
});

test('clientQueryParameters wraps instants so the window values are bound', () => {
  const params = clientQueryParameters(prepared);
  assert.equal(boundValue(params.from, 'TIMESTAMP'), '2026-10-09T07:00:00.000Z');
  assert.equal(boundValue(params.to, 'TIMESTAMP'), '2026-10-16T12:59:59.000Z');
  assert.equal(boundValue(params.day, 'DATE'), '2026-10-09');
  assert.equal(boundValue(params.topic, 'STRING'), 'event');
  assert.equal(boundValue(params.resultLimit, 'INT64'), 1001);
  assert.equal(boundValue(params.west, 'FLOAT64'), 144.6);
  assert.deepEqual(Object.keys(params), Object.keys(prepared.params));
});
