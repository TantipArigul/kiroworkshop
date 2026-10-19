import { INPUT_MARKERS, type InputMarkerName } from '@portal/shared';
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  markerRange,
  RECOMMENDATION_DISCLAIMER,
  RULESET_VERSION,
  trainingBand,
  trainingMidpoint,
  type RecommendationInput,
} from '../../../src/modules/results/recommendation-rules.js';

// Mock rule engine (design C2): every rule of `mock-rules-2026.10-1`, NO_MATCH, first-match by
// priority and the synthetic training midpoint (midpoint of the INPUT_MARKERS validation range).

const midpoint = (marker: InputMarkerName) => trainingMidpoint(marker);
const high = (marker: InputMarkerName) => ({ marker, value: midpoint(marker) });
const low = (marker: InputMarkerName) => ({ marker, value: markerRange(marker).min });

function input(overrides: Partial<RecommendationInput>): RecommendationInput {
  return { focusArea: 'GENERAL', lifestyleFactors: [], rows: [], ...overrides };
}

describe('training midpoint and band', () => {
  it('is the midpoint of every marker validation range', () => {
    for (const range of INPUT_MARKERS) {
      expect(trainingMidpoint(range.marker)).toBe((range.min + range.max) / 2);
      expect(markerRange(range.marker)).toEqual(range);
    }
    expect(trainingMidpoint('alt')).toBe(252.5);
    expect(trainingMidpoint('creatinine')).toBeCloseTo(7.6, 10);
  });

  it('puts the midpoint itself in the at-or-above band and anything lower below it', () => {
    for (const { marker } of INPUT_MARKERS) {
      expect(trainingBand(marker, midpoint(marker))).toBe('AT_OR_ABOVE_TRAINING_MIDPOINT');
      expect(trainingBand(marker, midpoint(marker) - 0.001)).toBe('BELOW_TRAINING_MIDPOINT');
      expect(trainingBand(marker, markerRange(marker).max)).toBe('AT_OR_ABOVE_TRAINING_MIDPOINT');
    }
  });
});

describe('evaluate — every rule of mock-rules-2026.10-1', () => {
  it('MOCK-CARDIO-01: cardiometabolic focus with a cardio marker at or above the midpoint', () => {
    const result = evaluate(
      input({
        focusArea: 'CARDIOMETABOLIC',
        rows: [high('hba1c'), low('fasting_glucose'), high('bmi'), high('alt')],
      }),
    );
    expect(result).toEqual({
      disclaimer: RECOMMENDATION_DISCLAIMER,
      matched: true,
      matchedFactors: ['focusArea:CARDIOMETABOLIC', 'marker:hba1c', 'marker:bmi'],
      packageLabel: 'Training Package B — Cardiometabolic',
      reason:
        'Focus area is Cardiometabolic and hba1c, bmi are at or above the synthetic training midpoint.',
      ruleId: 'MOCK-CARDIO-01',
      ruleVersion: RULESET_VERSION,
    });
  });

  it('MOCK-CARDIO-01 ignores markers outside its set (hdl, diastolic, alt)', () => {
    const result = evaluate(
      input({
        focusArea: 'CARDIOMETABOLIC',
        rows: [high('hdl_cholesterol'), high('diastolic_bp'), high('alt')],
      }),
    );
    expect(result.ruleId).toBe('NO_MATCH');
  });

  it('MOCK-LIVER-01: liver focus with alt at or above the midpoint or HIGH_ALCOHOL', () => {
    expect(evaluate(input({ focusArea: 'LIVER', rows: [high('alt')] }))).toMatchObject({
      matchedFactors: ['focusArea:LIVER', 'marker:alt'],
      packageLabel: 'Training Package C — Liver',
      reason: 'Focus area is Liver and alt is at or above the synthetic training midpoint.',
      ruleId: 'MOCK-LIVER-01',
    });
    expect(
      evaluate(
        input({ focusArea: 'LIVER', lifestyleFactors: ['HIGH_ALCOHOL'], rows: [low('alt')] }),
      ),
    ).toMatchObject({
      matchedFactors: ['focusArea:LIVER', 'lifestyle:HIGH_ALCOHOL'],
      reason: 'Focus area is Liver and lifestyle includes High alcohol.',
      ruleId: 'MOCK-LIVER-01',
    });
    expect(
      evaluate(
        input({ focusArea: 'LIVER', lifestyleFactors: ['HIGH_ALCOHOL'], rows: [high('alt')] }),
      ).matchedFactors,
    ).toEqual(['focusArea:LIVER', 'marker:alt', 'lifestyle:HIGH_ALCOHOL']);
  });

  it('MOCK-KIDNEY-01: kidney focus with creatinine or systolic_bp at or above the midpoint', () => {
    expect(evaluate(input({ focusArea: 'KIDNEY', rows: [high('creatinine')] }))).toMatchObject({
      matchedFactors: ['focusArea:KIDNEY', 'marker:creatinine'],
      packageLabel: 'Training Package D — Kidney',
      ruleId: 'MOCK-KIDNEY-01',
    });
    expect(
      evaluate(input({ focusArea: 'KIDNEY', rows: [low('creatinine'), high('systolic_bp')] }))
        .matchedFactors,
    ).toEqual(['focusArea:KIDNEY', 'marker:systolic_bp']);
  });

  it('MOCK-LIFESTYLE-01: SMOKING or LOW_ACTIVITY for any focus area', () => {
    for (const focusArea of ['CARDIOMETABOLIC', 'LIVER', 'KIDNEY', 'GENERAL'] as const) {
      const result = evaluate(
        input({ focusArea, lifestyleFactors: ['POOR_SLEEP', 'LOW_ACTIVITY', 'SMOKING'] }),
      );
      expect(result).toMatchObject({
        matchedFactors: ['lifestyle:SMOKING', 'lifestyle:LOW_ACTIVITY'],
        packageLabel: 'Training Package E — Lifestyle',
        reason: 'Lifestyle includes Smoking, Low activity.',
        ruleId: 'MOCK-LIFESTYLE-01',
      });
    }
  });

  it('MOCK-GENERAL-01: general focus without a higher-priority match', () => {
    expect(evaluate(input({ focusArea: 'GENERAL', rows: [high('alt')] }))).toMatchObject({
      matchedFactors: ['focusArea:GENERAL'],
      packageLabel: 'Training Package A — General',
      reason: 'Focus area is General.',
      ruleId: 'MOCK-GENERAL-01',
    });
  });

  it('NO_MATCH: no rule matches, so no package, no factors and the fixed reason', () => {
    for (const focusArea of ['CARDIOMETABOLIC', 'LIVER', 'KIDNEY'] as const) {
      const result = evaluate(
        input({
          focusArea,
          lifestyleFactors: ['POOR_SLEEP'],
          rows: INPUT_MARKERS.map((range) => low(range.marker)),
        }),
      );
      expect(result).toEqual({
        disclaimer: RECOMMENDATION_DISCLAIMER,
        matched: false,
        matchedFactors: [],
        packageLabel: 'No mock recommendation',
        reason: 'No mock rule matches this input, so no package is recommended.',
        ruleId: 'NO_MATCH',
        ruleVersion: RULESET_VERSION,
      });
    }
  });
});

describe('evaluate — priority, determinism and version', () => {
  it('applies the first matching rule by priority', () => {
    // Cardio (1) beats lifestyle (4); liver (2) beats lifestyle (4); lifestyle (4) beats general (5).
    expect(
      evaluate(
        input({
          focusArea: 'CARDIOMETABOLIC',
          lifestyleFactors: ['SMOKING'],
          rows: [high('ldl_cholesterol')],
        }),
      ).ruleId,
    ).toBe('MOCK-CARDIO-01');
    expect(
      evaluate(input({ focusArea: 'LIVER', lifestyleFactors: ['SMOKING', 'HIGH_ALCOHOL'] })).ruleId,
    ).toBe('MOCK-LIVER-01');
    expect(evaluate(input({ focusArea: 'GENERAL', lifestyleFactors: ['SMOKING'] })).ruleId).toBe(
      'MOCK-LIFESTYLE-01',
    );
    // A focus rule without its condition falls through to the lifestyle rule.
    expect(
      evaluate(input({ focusArea: 'KIDNEY', lifestyleFactors: ['LOW_ACTIVITY'], rows: [] })).ruleId,
    ).toBe('MOCK-LIFESTYLE-01');
  });

  it('is pure: same input, same output, input untouched', () => {
    const value = input({
      focusArea: 'LIVER',
      lifestyleFactors: ['HIGH_ALCOHOL'],
      rows: [high('alt')],
    });
    const snapshot = structuredClone(value);
    expect(evaluate(value)).toEqual(evaluate(structuredClone(value)));
    expect(value).toEqual(snapshot);
  });

  it('stamps every outcome with the current append-only rule set version', () => {
    expect(RULESET_VERSION).toBe('mock-rules-2026.10-1');
    expect(evaluate(input({})).ruleVersion).toBe(RULESET_VERSION);
    expect(evaluate(input({ focusArea: 'KIDNEY' })).ruleVersion).toBe(RULESET_VERSION);
  });
});
