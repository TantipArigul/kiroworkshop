import { describe, expect, it } from 'vitest';

import {
  createExecutorDirectory,
  type ExecutorAdapter,
} from '../../../src/modules/jobs/executor.js';
import { isAllowedTransition } from '../../../src/modules/jobs/job.service.js';
import { pipelineIdsForExecutor } from '../../../src/modules/pipelines/registry.js';

function adapter(id: ExecutorAdapter['id'], capacity: number): ExecutorAdapter {
  return {
    cancel: async () => undefined,
    capacity,
    cleanup: async () => undefined,
    id,
    isReady: () => true,
    poll: async () => ({ state: 'running' }),
    start: async () => undefined,
    stopAll: async () => undefined,
  };
}

describe('executor directory (C6, D3-4)', () => {
  it('routes every registry pipeline to the adapter of its executor kind', () => {
    const simulated = adapter('simulated', Number.POSITIVE_INFINITY);
    const nextflow = adapter('nextflow', 1);
    const directory = createExecutorDirectory([
      { adapter: simulated, pipelineIds: pipelineIdsForExecutor('simulated') },
      { adapter: nextflow, pipelineIds: pipelineIdsForExecutor('nextflow') },
    ]);

    expect(directory.adapterFor('smart-checkup')).toBe(simulated);
    expect(directory.adapterFor('wf-renamefastq')).toBe(nextflow);
    expect(directory.adapterFor('not-registered')).toBeNull();
    expect(directory.adapters()).toEqual([simulated, nextflow]);
  });

  it('treats CANCELLED as terminal like COMPLETED and FAILED (US-021 AC4)', () => {
    for (const from of ['COMPLETED', 'FAILED', 'CANCELLED'] as const) {
      for (const to of ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const) {
        expect(isAllowedTransition(from, to)).toBe(false);
      }
    }
  });
});
