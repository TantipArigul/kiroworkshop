import { smartCheckupResultSchema } from '@portal/shared';
import { describe, expect, it } from 'vitest';
import type { JobCompletionContext } from '../../../src/modules/jobs/completion.js';
import type { TransactionClient } from '../../../src/modules/jobs/executor.js';
import type { JobStorage } from '../../../src/modules/jobs/job-storage.js';
import { evaluate, RULESET_VERSION } from '../../../src/modules/results/recommendation-rules.js';
import {
  createSmartCheckupResultBuilder,
  RESULT_FILE_CONTENT_TYPE,
  RESULT_FILE_SCHEMA_VERSION,
  resultFileName,
  smartCheckupResultFileSchema,
} from '../../../src/modules/results/smart-checkup-result.js';

// Smart Checkup Result Builder (design C3): `result.json` v2 and the finalize rows.

const JOB_ID = 'cjobresultbuilder00012345';
const FIXED_NOW = new Date('2026-10-19T03:04:05.000Z');

type Written = { jobId: string; content: string };
type Created = { table: string; data: Record<string, unknown> };

function harness(
  overrides: Partial<JobCompletionContext> = {},
  writeResult?: (jobId: string, content: string) => Promise<void>,
) {
  const written: Written[] = [];
  const created: Created[] = [];
  const storage = {
    storageKey: (jobId: string, file: string) => `jobs/${jobId}/${file}`,
    writeResult:
      writeResult ??
      (async (jobId: string, content: string) => void written.push({ content, jobId })),
  } as unknown as JobStorage;
  const context: JobCompletionContext = {
    jobId: JOB_ID,
    ownerId: 'cowner000000000000000001',
    parameters: {
      ageBand: '50-59',
      focusArea: 'LIVER',
      lifestyleFactors: ['HIGH_ALCOHOL', 'POOR_SLEEP'],
      sampleLabel: 'Synthetic builder sample',
      simulateFailure: false,
    },
    requestId: 'request-builder',
    rows: [
      { marker: 'alt', unit: 'U/L', value: 300 },
      { marker: 'creatinine', unit: 'mg/dL', value: 1.1 },
    ],
    storage,
    ...overrides,
  };
  const tx = {
    packageRecommendation: {
      create: async ({ data }: { data: Record<string, unknown> }) =>
        void created.push({ data, table: 'packageRecommendation' }),
    },
    resultArtifact: {
      create: async ({ data }: { data: Record<string, unknown> }) =>
        void created.push({ data, table: 'resultArtifact' }),
    },
  } as unknown as TransactionClient;
  return { context, created, tx, written };
}

async function build(h: ReturnType<typeof harness>) {
  const handler = createSmartCheckupResultBuilder({ clock: () => FIXED_NOW });
  const outcome = await handler(h.context);
  if (!outcome) {
    throw new Error('The Smart Checkup builder must return a finalize step.');
  }
  return outcome;
}

describe('createSmartCheckupResultBuilder', () => {
  it('writes result.json schema v2 with public parameters, banded markers and the recommendation', async () => {
    const h = harness();
    await build(h);
    expect(h.written).toHaveLength(1);
    expect(h.written[0]?.jobId).toBe(JOB_ID);
    const file = JSON.parse(h.written[0]?.content ?? '') as Record<string, unknown>;
    expect(smartCheckupResultFileSchema.parse(file)).toEqual(file);
    expect(file).toEqual({
      generatedAt: FIXED_NOW.toISOString(),
      markers: [
        {
          band: 'AT_OR_ABOVE_TRAINING_MIDPOINT',
          marker: 'alt',
          max: 500,
          midpoint: 252.5,
          min: 5,
          unit: 'U/L',
          value: 300,
        },
        {
          band: 'BELOW_TRAINING_MIDPOINT',
          marker: 'creatinine',
          max: 15,
          midpoint: (0.2 + 15) / 2,
          min: 0.2,
          unit: 'mg/dL',
          value: 1.1,
        },
      ],
      parameters: {
        ageBand: '50-59',
        focusArea: 'LIVER',
        lifestyleFactors: ['HIGH_ALCOHOL', 'POOR_SLEEP'],
        sampleLabel: 'Synthetic builder sample',
      },
      recommendation: evaluate({
        focusArea: 'LIVER',
        lifestyleFactors: ['HIGH_ALCOHOL', 'POOR_SLEEP'],
        rows: h.context.rows,
      }),
      schemaVersion: RESULT_FILE_SCHEMA_VERSION,
    });
    expect(RESULT_FILE_SCHEMA_VERSION).toBe(2);
    expect(h.written[0]?.content).not.toContain('simulateFailure');
    // The file's markers fit the public result contract unchanged.
    expect(smartCheckupResultSchema.shape.markers.safeParse(file.markers).success).toBe(true);
  });

  it('creates no rows until finalize, then one ResultArtifact and one PackageRecommendation', async () => {
    const h = harness();
    const outcome = await build(h);
    expect(h.created).toEqual([]);
    await outcome.finalize(h.tx);
    expect(h.created).toEqual([
      {
        data: {
          contentType: RESULT_FILE_CONTENT_TYPE,
          fileName: `smart-checkup-result-${JOB_ID.slice(-8)}.json`,
          jobId: JOB_ID,
          storageKey: `jobs/${JOB_ID}/result.json`,
        },
        table: 'resultArtifact',
      },
      {
        data: {
          disclaimer: 'Training output only. Not a medical diagnosis or treatment advice.',
          jobId: JOB_ID,
          matchedFactors: JSON.stringify([
            'focusArea:LIVER',
            'marker:alt',
            'lifestyle:HIGH_ALCOHOL',
          ]),
          packageLabel: 'Training Package C — Liver',
          ruleIdentifier: 'MOCK-LIVER-01',
          ruleVersion: RULESET_VERSION,
        },
        table: 'packageRecommendation',
      },
    ]);
    expect(RESULT_FILE_CONTENT_TYPE).toBe('application/json');
  });

  it('stores NO_MATCH as a recommendation row too, with no factors', async () => {
    const h = harness({
      parameters: {
        ageBand: '18-29',
        focusArea: 'KIDNEY',
        lifestyleFactors: [],
        sampleLabel: 'No match sample',
        simulateFailure: false,
      },
      rows: [{ marker: 'creatinine', unit: 'mg/dL', value: 0.9 }],
    });
    const outcome = await build(h);
    await outcome.finalize(h.tx);
    const row = h.created.find((entry) => entry.table === 'packageRecommendation');
    expect(row?.data).toMatchObject({
      matchedFactors: '[]',
      packageLabel: 'No mock recommendation',
      ruleIdentifier: 'NO_MATCH',
    });
    const file = JSON.parse(h.written[0]?.content ?? '') as {
      recommendation: { matched: boolean };
    };
    expect(file.recommendation.matched).toBe(false);
  });

  it('rethrows a write failure (job becomes FAILED) and a finalize failure', async () => {
    const failing = harness({}, async () => {
      throw new Error('disk full');
    });
    await expect(createSmartCheckupResultBuilder()(failing.context)).rejects.toThrow('disk full');

    const h = harness();
    const outcome = await build(h);
    const brokenTx = {
      packageRecommendation: { create: async () => undefined },
      resultArtifact: {
        create: async () => {
          throw new Error('insert failed');
        },
      },
    } as unknown as TransactionClient;
    await expect(outcome.finalize(brokenTx)).rejects.toThrow('insert failed');
  });

  it('names the download after the last 8 characters of the job id', () => {
    expect(resultFileName('cabcdefghijklmnop12345678')).toBe('smart-checkup-result-12345678.json');
  });

  it('rejects a v1 summary or extra fields in result.json', () => {
    const base = {
      generatedAt: FIXED_NOW.toISOString(),
      markers: [],
      parameters: {
        ageBand: '40-49',
        focusArea: 'GENERAL',
        lifestyleFactors: [],
        sampleLabel: 'x',
      },
      recommendation: evaluate({ focusArea: 'GENERAL', lifestyleFactors: [], rows: [] }),
      schemaVersion: 2,
    };
    expect(smartCheckupResultFileSchema.safeParse(base).success).toBe(true);
    expect(smartCheckupResultFileSchema.safeParse({ ...base, schemaVersion: 1 }).success).toBe(
      false,
    );
    expect(
      smartCheckupResultFileSchema.safeParse({
        ...base,
        parameters: { ...base.parameters, simulateFailure: true },
      }).success,
    ).toBe(false);
    expect(smartCheckupResultFileSchema.safeParse({ ...base, path: '/x' }).success).toBe(false);
  });
});
