import { jobResultSchema } from '@portal/shared';
import { describe, expect, it } from 'vitest';

import resultsFixture from './results.json';

// Mock results must have the same shape as the real `GET /jobs/{id}/result` payload (task 3.6).
describe('mock result fixtures', () => {
  const entries = Object.entries(resultsFixture.results);

  it('covers both pipelines', () => {
    const pipelines = new Set(entries.map(([, result]) => result.pipelineId));
    expect(pipelines).toEqual(new Set(['smart-checkup', 'wf-renamefastq']));
  });

  it.each(entries)('%s parses with jobResultSchema', (_jobId, result) => {
    const parsed = jobResultSchema.safeParse(result);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });
});
