import { describe, expect, it } from 'vitest';

import type { JobCompletionContext } from '../../../src/modules/jobs/completion.js';
import type { TransactionClient } from '../../../src/modules/jobs/executor.js';
import type { JobStorage } from '../../../src/modules/jobs/job-storage.js';
import { resultsLog, type ResultsLogger } from '../../../src/modules/results/results-log.js';
import { createSmartCheckupResultBuilder } from '../../../src/modules/results/smart-checkup-result.js';

type Entry = { level: 'info' | 'warn' | 'error'; object: Record<string, unknown>; message: string };

const SECRET_PATH = '/private/storage/jobs/cjob00000000000000000001/result.json';

function captureLogger(): { logger: ResultsLogger; entries: Entry[] } {
  const entries: Entry[] = [];
  const write = (level: Entry['level']) => (object: Record<string, unknown>, message: string) =>
    void entries.push({ level, message, object });

  return { entries, logger: { error: write('error'), info: write('info'), warn: write('warn') } };
}

function completionContext(storage: Partial<JobStorage>): JobCompletionContext {
  return {
    jobId: 'cjob00000000000000000001',
    ownerId: 'cowner000000000000000001',
    parameters: {
      ageBand: '40-49',
      focusArea: 'LIVER',
      lifestyleFactors: [],
      sampleLabel: 'Canary label',
      simulateFailure: false,
    },
    requestId: 'request-1',
    rows: [{ marker: 'alt', unit: 'U/L', value: 321.5 }],
    storage: {
      storageKey: (jobId: string, file: string) => `jobs/${jobId}/${file}`,
      writeResult: async () => undefined,
      ...storage,
    } as JobStorage,
  };
}

function fakeTx(failOn?: 'resultArtifact' | 'packageRecommendation'): TransactionClient {
  const table = (name: string) => ({
    create: async () => {
      if (name === failOn) {
        throw new Error(`insert failed at ${SECRET_PATH}`);
      }
    },
  });

  return {
    packageRecommendation: table('packageRecommendation'),
    resultArtifact: table('resultArtifact'),
  } as unknown as TransactionClient;
}

describe('resultsLog (design Operations)', () => {
  it('emits only the allowlisted fields of each event', () => {
    const { entries, logger } = captureLogger();
    const extra = { fileName: 'secret.html', path: SECRET_PATH } as Record<string, unknown>;

    resultsLog.generated(logger, { jobId: 'j', ruleId: 'r', ruleVersion: 'v', ...extra });
    resultsLog.generationFailed(logger, { error: new TypeError(SECRET_PATH), jobId: 'j' });
    resultsLog.unavailable(logger, { jobId: 'j', reason: 'MISSING', ...extra });
    resultsLog.served(logger, {
      artifactId: 'a',
      bytes: 3,
      category: 'REPORT',
      jobId: 'j',
      mode: 'view',
      ...extra,
    });
    resultsLog.missing(logger, { artifactId: 'a', jobId: 'j', ...extra });

    expect(entries).toEqual([
      {
        level: 'info',
        message: 'Result generated',
        object: { jobId: 'j', ruleId: 'r', ruleVersion: 'v' },
      },
      {
        level: 'error',
        message: 'Result generation failed',
        object: { errorType: 'TypeError', jobId: 'j' },
      },
      { level: 'warn', message: 'Result unavailable', object: { jobId: 'j', reason: 'MISSING' } },
      {
        level: 'info',
        message: 'Artifact served',
        object: { artifactId: 'a', bytes: 3, category: 'REPORT', jobId: 'j', mode: 'view' },
      },
      { level: 'warn', message: 'Artifact missing', object: { artifactId: 'a', jobId: 'j' } },
    ]);
  });
});

describe('Smart Checkup result builder events (C3)', () => {
  it('logs Result generated after finalize created the rows', async () => {
    const { entries, logger } = captureLogger();
    const completion = await createSmartCheckupResultBuilder({ logger })(completionContext({}));

    expect(entries).toEqual([]);
    await completion?.finalize(fakeTx());

    expect(entries).toEqual([
      {
        level: 'info',
        message: 'Result generated',
        object: {
          jobId: 'cjob00000000000000000001',
          ruleId: 'MOCK-LIVER-01',
          ruleVersion: expect.any(String),
        },
      },
    ]);
  });

  it('logs the error type only when writing result.json fails, and rethrows', async () => {
    const { entries, logger } = captureLogger();
    const handler = createSmartCheckupResultBuilder({ logger });
    const writeResult = async () => {
      throw new Error(`EACCES: permission denied, open '${SECRET_PATH}'`);
    };

    await expect(handler(completionContext({ writeResult }))).rejects.toThrow('EACCES');
    expect(entries).toEqual([
      {
        level: 'error',
        message: 'Result generation failed',
        object: { errorType: 'Error', jobId: 'cjob00000000000000000001' },
      },
    ]);
  });

  it('logs Result generation failed when finalize throws, and rethrows', async () => {
    const { entries, logger } = captureLogger();
    const completion = await createSmartCheckupResultBuilder({ logger })(completionContext({}));

    await expect(completion?.finalize(fakeTx('packageRecommendation'))).rejects.toThrow();
    expect(entries.map((entry) => entry.message)).toEqual(['Result generation failed']);
    expect(JSON.stringify(entries)).not.toContain(SECRET_PATH);
    expect(JSON.stringify(entries)).not.toContain('321.5');
    expect(JSON.stringify(entries)).not.toContain('Canary label');
  });
});
