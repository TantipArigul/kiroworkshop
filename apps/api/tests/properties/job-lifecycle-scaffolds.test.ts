import { describe, expect, it } from 'vitest';

import {
  idempotencyKeyGenerator,
  jobStatusGenerator,
  retentionTimestampGenerator,
} from '@portal/shared';

describe('Job domain property scaffolds', () => {
  it('exports reusable generators for downstream Job Lifecycle properties', () => {
    expect(jobStatusGenerator).toBeDefined();
    expect(idempotencyKeyGenerator).toBeDefined();
    expect(retentionTimestampGenerator).toBeDefined();
  });

  it.skip('enforces allowed lifecycle transitions after Submission & Job Lifecycle implementation');
  it.skip('enforces idempotent submission after Submission & Job Lifecycle implementation');
  it.skip('enforces retention deletion closure after Submission & Job Lifecycle implementation');
});
