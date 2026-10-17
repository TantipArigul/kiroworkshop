import { describe, expect, it } from 'vitest';

import { previewCsv } from './csvPreview';
import { shouldPoll } from './useJobPolling';

describe('previewCsv', () => {
  it('summarises a well-formed synthetic file', () => {
    const preview = previewCsv('marker,value,unit\nhba1c,5.4,%\nbmi,24.1,kg/m2\n');

    expect(preview).toMatchObject({ rowCount: 2, markers: ['hba1c', 'bmi'], issues: [] });
    expect(preview.sizeBytes).toBeGreaterThan(0);
  });

  it('flags a wrong header, unknown markers and an empty body', () => {
    expect(previewCsv('name,value\nfoo,1').issues).toHaveLength(2);
    expect(previewCsv('marker,value,unit\n').issues).toEqual([
      'Include between 1 and 50 marker rows.',
    ]);
  });
});

describe('shouldPoll', () => {
  it('polls only active jobs on a visible page', () => {
    expect(shouldPoll('QUEUED', false)).toBe(true);
    expect(shouldPoll('RUNNING', false)).toBe(true);
    expect(shouldPoll('RUNNING', true)).toBe(false);
    expect(shouldPoll('COMPLETED', false)).toBe(false);
    expect(shouldPoll('FAILED', false)).toBe(false);
  });
});
