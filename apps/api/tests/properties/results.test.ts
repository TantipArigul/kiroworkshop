import { mkdtemp, rm } from 'node:fs/promises';
import { validateHeaderValue } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGE_BANDS,
  INPUT_FILE_HEADER,
  INPUT_MARKERS,
  NO_MOCK_RECOMMENDATION_RULE_ID,
  jobStatusGenerator,
  nextflowResultSchema,
  recommendationSchema,
  type InputMarkerName,
} from '@portal/shared';
import {
  artifactRelativePathGenerator,
  displayNameGenerator,
  recommendationInputGenerator,
  statsContentGenerator,
  statsRowGenerator,
  statsTsvFor,
} from '../../../../packages/shared/src/testing/generators.js';
import { createJobStorage } from '../../src/modules/jobs/job-storage.js';
import {
  contentDisposition,
  sanitizeFileName,
} from '../../src/modules/results/artifact-delivery.js';
import { parseNextflowStats } from '../../src/modules/results/nextflow-stats.js';
import {
  evaluate,
  RULESET_VERSION,
  type RecommendationInput,
} from '../../src/modules/results/recommendation-rules.js';
import {
  ArtifactNotFoundError,
  createResultService,
} from '../../src/modules/results/result.service.js';
import {
  createResultsTestContext,
  NEXTFLOW_PATHS,
  nextflowOutputs,
  type ResultsTestContext,
  type TestSession,
} from '../support/results-context.js';

/** Same convention as the other property suites: 100 pure runs, 25 DB/HTTP runs. */
const RUNS = 100;
const DB_RUNS = 25;
/** DB/HTTP properties share the machine with the parallel suite; 5 s is not enough there. */
const DB_PROPERTY_TIMEOUT_MS = 120_000;

const UNSAFE_FILENAME_CHARACTER = /[\u0000-\u001f\u007f"\\/]/;
const OLDER_RULESET_VERSION = 'mock-rules-2026.09-0';

let context: ResultsTestContext;
let owner: TestSession;
let intruder: TestSession;

beforeAll(async () => {
  context = await createResultsTestContext();
  owner = await context.signIn('pbt-results-owner@example.test');
  intruder = await context.signIn('pbt-results-intruder@example.test');
}, 60_000);

afterAll(async () => {
  await context.cleanup();
});

// ---------- Independent reference model of the C2 rule table ----------

const CARDIO: readonly InputMarkerName[] = [
  'fasting_glucose',
  'hba1c',
  'ldl_cholesterol',
  'triglycerides',
  'systolic_bp',
  'bmi',
];

function atOrAboveMidpoint(input: RecommendationInput): Set<string> {
  return new Set(
    input.rows
      .filter((row) => {
        const range = INPUT_MARKERS.find((item) => item.marker === row.marker);
        return range !== undefined && row.value >= (range.min + range.max) / 2;
      })
      .map((row) => row.marker),
  );
}

/** Rule id and factor set the design table (C2) prescribes for an input. */
function referenceOutcome(input: RecommendationInput): { ruleId: string; factors: string[] } {
  const high = atOrAboveMidpoint(input);
  const lifestyle = new Set<string>(input.lifestyleFactors);
  const markers = (names: readonly InputMarkerName[]) =>
    names.filter((name) => high.has(name)).map((name) => `marker:${name}`);
  const focus = `focusArea:${input.focusArea}`;
  if (input.focusArea === 'CARDIOMETABOLIC' && markers(CARDIO).length > 0) {
    return { factors: [focus, ...markers(CARDIO)], ruleId: 'MOCK-CARDIO-01' };
  }
  const alcohol = lifestyle.has('HIGH_ALCOHOL') ? ['lifestyle:HIGH_ALCOHOL'] : [];
  if (input.focusArea === 'LIVER' && markers(['alt']).length + alcohol.length > 0) {
    return { factors: [focus, ...markers(['alt']), ...alcohol], ruleId: 'MOCK-LIVER-01' };
  }
  if (input.focusArea === 'KIDNEY' && markers(['creatinine', 'systolic_bp']).length > 0) {
    return {
      factors: [focus, ...markers(['creatinine', 'systolic_bp'])],
      ruleId: 'MOCK-KIDNEY-01',
    };
  }
  const habits = ['SMOKING', 'LOW_ACTIVITY'].filter((factor) => lifestyle.has(factor));
  if (habits.length > 0) {
    return { factors: habits.map((factor) => `lifestyle:${factor}`), ruleId: 'MOCK-LIFESTYLE-01' };
  }
  if (input.focusArea === 'GENERAL') {
    return { factors: [focus], ruleId: 'MOCK-GENERAL-01' };
  }
  return { factors: [], ruleId: NO_MOCK_RECOMMENDATION_RULE_ID };
}

/** Every factor an input actually has (focus area, present markers, chosen lifestyle). */
function inputFactors(input: RecommendationInput): Set<string> {
  return new Set([
    `focusArea:${input.focusArea}`,
    ...input.rows.map((row) => `marker:${row.marker}`),
    ...input.lifestyleFactors.map((factor) => `lifestyle:${factor}`),
  ]);
}

function submissionBody(
  input: {
    focusArea: string;
    lifestyleFactors: readonly string[];
    rows: readonly { marker: string; unit: string; value: number }[];
  },
  ageBand: string,
) {
  return {
    file: {
      content: [
        INPUT_FILE_HEADER,
        ...input.rows.map((row) => `${row.marker},${row.value},${row.unit}`),
        '',
      ].join('\n'),
      name: 'synthetic-pbt.csv',
    },
    parameters: {
      ageBand,
      focusArea: input.focusArea,
      lifestyleFactors: input.lifestyleFactors,
      sampleLabel: 'PBT sample',
      simulateFailure: false,
    },
  };
}

describe('Results & Guidance properties (fast-check)', () => {
  it('P14 evaluate is deterministic and versioned (US-010 AC1, AC4)', () => {
    fc.assert(
      fc.property(recommendationInputGenerator, (input) => {
        const first = evaluate(input);
        const again = evaluate(structuredClone(input));
        expect(again).toEqual(first);
        expect(evaluate(input)).toEqual(first);
        expect(first.ruleVersion).toBe(RULESET_VERSION);
        expect(recommendationSchema.safeParse(first).success).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it(
    'P14 a stored result is re-read with the same recommendation and its stored ruleVersion (US-010 AC4)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          recommendationInputGenerator.filter((input) => input.rows.length > 0),
          fc.constantFrom(...AGE_BANDS),
          async (input, ageBand) => {
            const jobId = await context.completeSmartCheckupJob(
              owner,
              submissionBody(input, ageBand),
            );
            const row = await context.prisma.packageRecommendation.findUniqueOrThrow({
              where: { jobId },
            });
            expect(row.ruleVersion).toBe(RULESET_VERSION);
            const first = await owner.get(`/api/v1/jobs/${jobId}/result`);
            const second = await owner.get(`/api/v1/jobs/${jobId}/result`);
            expect(first.status).toBe(200);
            expect(second.body.data).toEqual(first.body.data);
            expect(first.body.data.recommendation).toEqual(evaluate(input));
            // A result evaluated with an older rule set keeps that version when read later.
            await context.prisma.packageRecommendation.update({
              data: { ruleVersion: OLDER_RULESET_VERSION },
              where: { jobId },
            });
            for (let read = 0; read < 2; read += 1) {
              const later = await owner.get(`/api/v1/jobs/${jobId}/result`);
              expect(later.body.data.recommendation.ruleVersion).toBe(OLDER_RULESET_VERSION);
            }
          },
        ),
        { numRuns: DB_RUNS },
      );
    },
    DB_PROPERTY_TIMEOUT_MS,
  );

  it('P15 a package iff a rule matches; matchedFactors ⊆ input factors; otherwise NO_MATCH (US-010 AC1, AC3)', () => {
    const at = (marker: InputMarkerName, value: number) => {
      const range = INPUT_MARKERS.find((item) => item.marker === marker);
      return { marker, unit: range?.unit ?? '', value };
    };
    // Fixed examples so every rule and NO_MATCH is exercised on every run, plus the threshold.
    const examples: [RecommendationInput][] = [
      [{ focusArea: 'CARDIOMETABOLIC', lifestyleFactors: [], rows: [at('hba1c', 9)] }],
      [{ focusArea: 'CARDIOMETABOLIC', lifestyleFactors: [], rows: [at('hba1c', 8.9)] }],
      [{ focusArea: 'LIVER', lifestyleFactors: ['HIGH_ALCOHOL'], rows: [] }],
      [{ focusArea: 'KIDNEY', lifestyleFactors: [], rows: [at('creatinine', 7.6)] }],
      [{ focusArea: 'KIDNEY', lifestyleFactors: ['SMOKING'], rows: [at('creatinine', 7.5)] }],
      [{ focusArea: 'GENERAL', lifestyleFactors: ['POOR_SLEEP'], rows: [] }],
      [{ focusArea: 'LIVER', lifestyleFactors: ['POOR_SLEEP'], rows: [at('alt', 252.4)] }],
    ];
    fc.assert(
      fc.property(recommendationInputGenerator, (input) => {
        const result = evaluate(input);
        const expected = referenceOutcome(input);
        expect(result.ruleId).toBe(expected.ruleId);
        expect([...result.matchedFactors].sort()).toEqual([...expected.factors].sort());
        const available = inputFactors(input);
        for (const factor of result.matchedFactors) {
          expect(available.has(factor)).toBe(true);
        }
        const high = atOrAboveMidpoint(input);
        for (const factor of result.matchedFactors.filter((item) => item.startsWith('marker:'))) {
          expect(high.has(factor.slice('marker:'.length))).toBe(true);
        }
        if (expected.ruleId === NO_MOCK_RECOMMENDATION_RULE_ID) {
          expect(result).toMatchObject({
            matched: false,
            matchedFactors: [],
            packageLabel: 'No mock recommendation',
          });
        } else {
          expect(result.matched).toBe(true);
          expect(result.packageLabel).toMatch(/^Training Package [A-E] — /);
          expect(result.matchedFactors.length).toBeGreaterThan(0);
        }
      }),
      { examples, numRuns: RUNS },
    );
  });

  it(
    'P16 result/download/view return data only for a COMPLETED job of the owner; view only viewable, always sandboxed (US-009 AC2, AC5; US-011 AC1–2)',
    async () => {
      const smartJobId = await context.completeSmartCheckupJob(owner);
      const smartArtifact = await context.prisma.resultArtifact.findFirstOrThrow({
        where: { jobId: smartJobId },
      });
      const seeded = await context.seedNextflowJob(owner.userId, nextflowOutputs(['pbt_sample']));
      const targets = [
        { artifacts: [{ id: smartArtifact.id, viewable: false }], jobId: smartJobId },
        {
          artifacts: Object.entries(seeded.outputIds).map(([path, id]) => ({
            id,
            viewable: path === NEXTFLOW_PATHS.report || path === NEXTFLOW_PATHS.timeline,
          })),
          jobId: seeded.jobId,
        },
      ];
      await fc.assert(
        fc.asyncProperty(
          fc.nat({ max: targets.length - 1 }),
          fc.nat(),
          jobStatusGenerator,
          fc.constantFrom('owner', 'intruder'),
          fc.constantFrom('result', 'download', 'view'),
          async (targetIndex, artifactIndex, status, requester, endpoint) => {
            const target = targets[targetIndex] ?? targets[0]!;
            const artifact = target.artifacts[artifactIndex % target.artifacts.length]!;
            const session = requester === 'owner' ? owner : intruder;
            const path =
              endpoint === 'result'
                ? `/api/v1/jobs/${target.jobId}/result`
                : `/api/v1/jobs/${target.jobId}/artifacts/${artifact.id}/${endpoint}`;
            await context.setJobStatus(target.jobId, status);
            try {
              const response = await session.get(path);
              const allowed =
                status === 'COMPLETED' &&
                requester === 'owner' &&
                (endpoint !== 'view' || artifact.viewable);
              expect(response.status === 200).toBe(allowed);
              if (!allowed) {
                expect(response.headers['content-disposition']).toBeUndefined();
                expect(response.body.error).toBeDefined();
                expect(response.body.data).toBeUndefined();
                const expectedStatus =
                  requester !== 'owner' ? 404 : status !== 'COMPLETED' ? 409 : 404;
                expect(response.status).toBe(expectedStatus);
              }
              if (endpoint === 'view' && response.status === 200) {
                const csp = String(response.headers['content-security-policy']);
                expect(csp.split(';')[0]?.trim()).toBe('sandbox allow-scripts');
                expect(csp).not.toContain('allow-same-origin');
                expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
              }
            } finally {
              await context.setJobStatus(target.jobId, 'COMPLETED');
            }
          },
        ),
        { numRuns: DB_RUNS },
      );
    },
    DB_PROPERTY_TIMEOUT_MS,
  );

  it('P17 sanitized filenames are never empty and carry no CR/LF, quote, slash, backslash or control character (US-011 AC2)', () => {
    fc.assert(
      fc.property(displayNameGenerator, fc.stringMatching(/^[a-z0-9]{20,40}$/), (name, id) => {
        const sanitized = sanitizeFileName(name, id);
        expect(sanitized.length).toBeGreaterThan(0);
        expect(UNSAFE_FILENAME_CHARACTER.test(sanitized)).toBe(false);
        expect(/^\.+$/.test(sanitized)).toBe(false);
        for (const type of ['attachment', 'inline'] as const) {
          const header = contentDisposition(type, sanitized, { extended: type === 'attachment' });
          expect(() => validateHeaderValue('Content-Disposition', header)).not.toThrow();
          expect(/[\r\n]/.test(header)).toBe(false);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('P17 every path resolved from an artifact stays under jobs/{jobId}/ (US-011 AC3)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'results-pbt-'));
    const jobId = 'cpbtresultsconfined000001';
    const artifactId = 'cpbtartifactconfined00001';
    const storage = createJobStorage(root);
    const jobDirectory = `${resolve(root, 'jobs', jobId)}${sep}`;
    const actor = { role: 'USER', userId: 'cpbtowner0000000000000001' } as never;
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('smart-checkup', 'wf-renamefastq'),
          artifactRelativePathGenerator,
          fc.boolean(),
          async (pipelineId, relativePath, prefixed) => {
            const service = createResultService({
              jobs: {
                getOwnedJob: async () =>
                  ({ id: jobId, pipelineId, runName: '', status: 'COMPLETED' }) as never,
              },
              pipelines: {
                listOutputFiles: async () => [
                  {
                    category: 'OTHER',
                    contentType: 'text/plain',
                    id: artifactId,
                    relativePath,
                    sizeBytes: 1,
                  },
                ],
              },
              prisma: {
                resultArtifact: {
                  findFirst: async () => ({
                    fileName: 'result.json',
                    id: artifactId,
                    storageKey: prefixed ? `jobs/${jobId}/${relativePath}` : relativePath,
                  }),
                },
              } as never,
              storage,
            });
            try {
              const resolved = await service.getArtifact(actor, jobId, artifactId, 'pbt', 'GET x');
              expect(resolved.absolutePath.startsWith(jobDirectory)).toBe(true);
              if (pipelineId === 'wf-renamefastq') {
                expect(resolved.absolutePath.startsWith(join(jobDirectory, 'output') + sep)).toBe(
                  true,
                );
              }
            } catch (error) {
              expect(error).toBeInstanceOf(ArtifactNotFoundError);
            }
          },
        ),
        { numRuns: RUNS },
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('P18 the stats parser never throws on any text and returns ok or INVALID (US-009 AC4)', () => {
    fc.assert(
      fc.property(statsContentGenerator, (content) => {
        let result: ReturnType<typeof parseNextflowStats> | undefined;
        expect(() => {
          result = parseNextflowStats(content);
        }).not.toThrow();
        if (result?.ok) {
          expect(nextflowResultSchema.shape.samples.safeParse(result.samples).success).toBe(true);
        } else {
          expect(result).toEqual({ ok: false, reason: 'INVALID' });
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('P18 a TSV built from valid rows parses back to the same values (US-009 AC1)', () => {
    fc.assert(
      fc.property(
        fc.array(statsRowGenerator, { maxLength: 30 }),
        fc.boolean(),
        fc.boolean(),
        (rows, crlf, finalNewline) => {
          expect(parseNextflowStats(statsTsvFor(rows, { crlf, finalNewline }))).toEqual({
            ok: true,
            samples: rows.map((row) => ({
              avgLen: row.avgLen,
              avgQual: row.avgQual,
              maxLen: row.maxLen,
              minLen: row.minLen,
              numSeqs: row.numSeqs,
              sample: row.sample,
              sumLen: row.sumLen,
            })),
          });
        },
      ),
      { numRuns: RUNS },
    );
  });
});
