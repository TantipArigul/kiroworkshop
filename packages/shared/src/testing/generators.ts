import fc from 'fast-check';

import {
  BARCODE_PATTERN,
  JOB_STATUSES,
  PATH_SEGMENT_PATTERN,
  SAMPLE_NAME_PATTERN,
} from '../constants.js';

export const jobStatusGenerator = fc.constantFrom(...JOB_STATUSES);
export const idempotencyKeyGenerator = fc.string({ minLength: 1, maxLength: 64 });
export const retentionTimestampGenerator = fc.date({
  min: new Date('2026-01-01'),
  max: new Date('2030-01-01'),
});

/** Path segments accepted by `PATH_SEGMENT_PATTERN` (may still contain `..`). */
export const pathSegmentGenerator = fc.stringMatching(PATH_SEGMENT_PATTERN);
export const sampleNameGenerator = fc.stringMatching(SAMPLE_NAME_PATTERN);
export const barcodeNameGenerator = fc.stringMatching(BARCODE_PATTERN);
