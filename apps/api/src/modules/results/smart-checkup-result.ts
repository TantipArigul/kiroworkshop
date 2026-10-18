import {
  jobParametersSchema,
  recommendationSchema,
  smartCheckupResultSchema,
  type Recommendation,
} from '@portal/shared';
import { z } from 'zod';

import type { JobCompletionHandler } from '../jobs/completion.js';
import { RESULT_FILE_NAME } from '../jobs/job-storage.js';
import { evaluate, markerRange, trainingBand, trainingMidpoint } from './recommendation-rules.js';

export const RESULT_FILE_SCHEMA_VERSION = 2;
export const RESULT_FILE_CONTENT_TYPE = 'application/json';

/**
 * `jobs/{jobId}/result.json`, version 2 (design C3, Data Model): public parameters (without
 * `simulateFailure`), markers with their training range and band, and the recommendation.
 */
export const smartCheckupResultFileSchema = z
  .object({
    schemaVersion: z.literal(RESULT_FILE_SCHEMA_VERSION),
    generatedAt: z.iso.datetime({ offset: true }),
    parameters: jobParametersSchema.omit({ simulateFailure: true }).strict(),
    markers: smartCheckupResultSchema.shape.markers,
    recommendation: recommendationSchema,
  })
  .strict();

export type SmartCheckupResultFile = z.infer<typeof smartCheckupResultFileSchema>;

/** Download name of a Smart Checkup result (`smart-checkup-result-{last 8 of job id}.json`). */
export function resultFileName(jobId: string): string {
  return `smart-checkup-result-${jobId.slice(-8)}.json`;
}

/**
 * Smart Checkup completion handler (design C3): evaluates the mock rules, writes `result.json`
 * and returns `finalize`, which creates the `ResultArtifact` and `PackageRecommendation` rows
 * (including `NO_MATCH`) inside the RUNNING → COMPLETED transaction. A throw from either step
 * makes the job FAILED, so a COMPLETED Smart Checkup job always has its result.
 */
export function createSmartCheckupResultBuilder(
  options: { clock?: () => Date } = {},
): JobCompletionHandler {
  const { clock = () => new Date() } = options;

  return async ({ jobId, parameters, rows, storage }) => {
    const { simulateFailure: _ignored, ...publicParameters } = parameters;
    void _ignored;
    const recommendation = evaluate({
      focusArea: parameters.focusArea,
      lifestyleFactors: parameters.lifestyleFactors,
      rows,
    });
    const content: SmartCheckupResultFile = {
      schemaVersion: RESULT_FILE_SCHEMA_VERSION,
      generatedAt: clock().toISOString(),
      parameters: publicParameters,
      markers: rows.map((row) => {
        const range = markerRange(row.marker);

        return {
          marker: row.marker,
          value: row.value,
          unit: row.unit,
          min: range.min,
          max: range.max,
          midpoint: trainingMidpoint(row.marker),
          band: trainingBand(row.marker, row.value),
        };
      }),
      recommendation,
    };

    // Never write a file the result service would later reject as invalid.
    await storage.writeResult(
      jobId,
      JSON.stringify(smartCheckupResultFileSchema.parse(content), null, 2),
    );

    return {
      finalize: async (tx) => {
        await tx.resultArtifact.create({
          data: {
            contentType: RESULT_FILE_CONTENT_TYPE,
            fileName: resultFileName(jobId),
            jobId,
            storageKey: storage.storageKey(jobId, RESULT_FILE_NAME),
          },
        });
        await tx.packageRecommendation.create({ data: toRecommendationRow(jobId, recommendation) });
      },
    };
  };
}

function toRecommendationRow(jobId: string, recommendation: Recommendation) {
  return {
    disclaimer: recommendation.disclaimer,
    jobId,
    matchedFactors: JSON.stringify(recommendation.matchedFactors),
    packageLabel: recommendation.packageLabel,
    ruleIdentifier: recommendation.ruleId,
    ruleVersion: recommendation.ruleVersion,
  };
}
