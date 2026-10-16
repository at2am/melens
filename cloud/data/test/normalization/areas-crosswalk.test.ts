import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateCrosswalkTarget } from '../../src/normalization/areas.js';

const melbourne = {
  boundary_id: 'ASGS_LGA:24600:2021', scheme: 'ASGS_LGA', code: '24600', vintage: '2021',
};

test('an explicit area crosswalk selects a supplied official code and vintage', () => {
  assert.equal(validateCrosswalkTarget({
    boundaryId: 'ASGS_LGA:24600:2021', boundaries: [melbourne], allowedSchemes: ['ASGS_LGA'],
  }), 'ASGS_LGA:24600:2021');
});

test('area crosswalks reject absent, malformed, duplicate and wrong-level targets', () => {
  const cases = [
    { boundaryId: 'ASGS_LGA:24600:2021', boundaries: [] },
    { boundaryId: 'ASGS_LGA:2021:24600', boundaries: [melbourne] },
    { boundaryId: 'ASGS_LGA:24600:2021', boundaries: [melbourne, melbourne] },
    { boundaryId: 'ASGS_SAL:24600:2021', boundaries: [{ ...melbourne,
      boundary_id: 'ASGS_SAL:24600:2021', scheme: 'ASGS_SAL' }] },
    { boundaryId: 'ASGS_LGA:24600:2021', boundaries: [{ ...melbourne, code: '27350' }] },
    { boundaryId: 'ASGS_LGA:24600:2021', boundaries: [{ ...melbourne, vintage: '2025' }] },
  ];
  for (const input of cases) {
    assert.throws(() => validateCrosswalkTarget({ ...input, allowedSchemes: ['ASGS_LGA'] }),
      /Crosswalk target is not a unique official boundary/);
  }
});
