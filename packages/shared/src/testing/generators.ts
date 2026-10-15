import fc from 'fast-check';

export const jobStatusGenerator = fc.constantFrom('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
export const idempotencyKeyGenerator = fc.string({ minLength: 1, maxLength: 64 });
export const retentionTimestampGenerator = fc.date({
  min: new Date('2026-01-01'),
  max: new Date('2030-01-01'),
});
