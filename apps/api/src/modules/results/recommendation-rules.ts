import {
  INPUT_MARKERS,
  NO_MOCK_RECOMMENDATION_RULE_ID,
  type InputMarkerName,
  type JobParameters,
  type Recommendation,
  type TrainingBand,
} from '@portal/shared';

type FocusArea = JobParameters['focusArea'];
type LifestyleFactor = JobParameters['lifestyleFactors'][number];

/**
 * Version of the mock rule set used for new results (design C2). Rule sets are append-only:
 * changing any rule means adding a new version to `RULESETS`; stored results keep the version
 * they were evaluated with.
 */
export const RULESET_VERSION = 'mock-rules-2026.10-1';

export const RECOMMENDATION_DISCLAIMER =
  'Training output only. Not a medical diagnosis or treatment advice.';

const NO_MATCH_PACKAGE_LABEL = 'No mock recommendation';
const NO_MATCH_REASON = 'No mock rule matches this input, so no package is recommended.';
const MIDPOINT_PHRASE = 'at or above the synthetic training midpoint';

/** Input of the rule engine. `ageBand` is intentionally absent: no rule uses it. */
export type RecommendationInput = {
  focusArea: FocusArea;
  lifestyleFactors: readonly LifestyleFactor[];
  rows: readonly { marker: InputMarkerName; value: number }[];
};

type MockRule = {
  priority: number;
  ruleId: string;
  packageLabel: string;
  /** Factors that made the rule match, or `null` when it does not match. */
  match(input: RecommendationInput): string[] | null;
  reason(factors: readonly string[]): string;
};

const CARDIO_MARKERS: readonly InputMarkerName[] = [
  'fasting_glucose',
  'hba1c',
  'ldl_cholesterol',
  'triglycerides',
  'systolic_bp',
  'bmi',
];
const KIDNEY_MARKERS: readonly InputMarkerName[] = ['creatinine', 'systolic_bp'];
const LIFESTYLE_RULE_FACTORS: readonly LifestyleFactor[] = ['SMOKING', 'LOW_ACTIVITY'];

/** Rule set `mock-rules-2026.10-1` (design C2 table), evaluated first-match by `priority`. */
const RULES_2026_10_1: readonly MockRule[] = [
  {
    priority: 1,
    ruleId: 'MOCK-CARDIO-01',
    packageLabel: 'Training Package B — Cardiometabolic',
    match: (input) => {
      const markers = _markersAtOrAboveMidpoint(input, CARDIO_MARKERS);

      return input.focusArea === 'CARDIOMETABOLIC' && markers.length > 0
        ? [_focusFactor('CARDIOMETABOLIC'), ...markers.map(_markerFactor)]
        : null;
    },
    reason: (factors) => _focusAndConditionsReason(factors),
  },
  {
    priority: 2,
    ruleId: 'MOCK-LIVER-01',
    packageLabel: 'Training Package C — Liver',
    match: (input) => {
      const markers = _markersAtOrAboveMidpoint(input, ['alt']);
      const lifestyle = input.lifestyleFactors.includes('HIGH_ALCOHOL') ? ['HIGH_ALCOHOL'] : [];

      return input.focusArea === 'LIVER' && markers.length + lifestyle.length > 0
        ? [_focusFactor('LIVER'), ...markers.map(_markerFactor), ...lifestyle.map(_lifestyleFactor)]
        : null;
    },
    reason: (factors) => _focusAndConditionsReason(factors),
  },
  {
    priority: 3,
    ruleId: 'MOCK-KIDNEY-01',
    packageLabel: 'Training Package D — Kidney',
    match: (input) => {
      const markers = _markersAtOrAboveMidpoint(input, KIDNEY_MARKERS);

      return input.focusArea === 'KIDNEY' && markers.length > 0
        ? [_focusFactor('KIDNEY'), ...markers.map(_markerFactor)]
        : null;
    },
    reason: (factors) => _focusAndConditionsReason(factors),
  },
  {
    priority: 4,
    ruleId: 'MOCK-LIFESTYLE-01',
    packageLabel: 'Training Package E — Lifestyle',
    match: (input) => {
      const lifestyle = LIFESTYLE_RULE_FACTORS.filter((factor) =>
        input.lifestyleFactors.includes(factor),
      );

      return lifestyle.length > 0 ? lifestyle.map(_lifestyleFactor) : null;
    },
    reason: (factors) => `Lifestyle includes ${_lifestyleList(factors)}.`,
  },
  {
    priority: 5,
    ruleId: 'MOCK-GENERAL-01',
    packageLabel: 'Training Package A — General',
    match: (input) => (input.focusArea === 'GENERAL' ? [_focusFactor('GENERAL')] : null),
    reason: (factors) => _focusAndConditionsReason(factors),
  },
];

/** Append-only history of rule sets, keyed by version. */
const RULESETS: Readonly<Record<string, readonly MockRule[]>> = {
  [RULESET_VERSION]: RULES_2026_10_1,
};

/**
 * Synthetic training threshold of a marker: the midpoint of its validation range in
 * `INPUT_MARKERS`. Not a clinical reference value.
 */
export function trainingMidpoint(marker: InputMarkerName): number {
  const range = markerRange(marker);

  return (range.min + range.max) / 2;
}

/** Position of a value against the synthetic training midpoint. */
export function trainingBand(marker: InputMarkerName, value: number): TrainingBand {
  return value >= trainingMidpoint(marker)
    ? 'AT_OR_ABOVE_TRAINING_MIDPOINT'
    : 'BELOW_TRAINING_MIDPOINT';
}

/** Validation range of a marker (`min`, `max`, `unit`) from the shared input contract. */
export function markerRange(marker: InputMarkerName): { min: number; max: number; unit: string } {
  const range = INPUT_MARKERS.find((item) => item.marker === marker);

  if (!range) {
    // INPUT_MARKERS defines every InputMarkerName; reaching here is a contract bug.
    throw new Error('Unknown marker.');
  }

  return range;
}

/**
 * Deterministic mock recommendation (US-010): pure, first-match by priority. `matchedFactors`
 * lists only the factors that made the rule match; no match yields `NO_MATCH` with no factors.
 */
export function evaluate(input: RecommendationInput): Recommendation {
  const rules = [...(RULESETS[RULESET_VERSION] ?? [])].sort((a, b) => a.priority - b.priority);

  for (const rule of rules) {
    const factors = rule.match(input);

    if (factors) {
      return {
        disclaimer: RECOMMENDATION_DISCLAIMER,
        matched: true,
        matchedFactors: factors,
        packageLabel: rule.packageLabel,
        reason: rule.reason(factors),
        ruleId: rule.ruleId,
        ruleVersion: RULESET_VERSION,
      };
    }
  }

  return {
    disclaimer: RECOMMENDATION_DISCLAIMER,
    matched: false,
    matchedFactors: [],
    packageLabel: NO_MATCH_PACKAGE_LABEL,
    reason: NO_MATCH_REASON,
    ruleId: NO_MOCK_RECOMMENDATION_RULE_ID,
    ruleVersion: RULESET_VERSION,
  };
}

/** Rule markers (in rule order) whose input value is at or above the training midpoint. */
function _markersAtOrAboveMidpoint(
  input: RecommendationInput,
  markers: readonly InputMarkerName[],
): InputMarkerName[] {
  return markers.filter((marker) =>
    input.rows.some((row) => row.marker === marker && row.value >= trainingMidpoint(marker)),
  );
}

function _focusFactor(focusArea: FocusArea): string {
  return `focusArea:${focusArea}`;
}

function _markerFactor(marker: InputMarkerName): string {
  return `marker:${marker}`;
}

function _lifestyleFactor(factor: string): string {
  return `lifestyle:${factor}`;
}

function _factorValues(factors: readonly string[], kind: string): string[] {
  return factors
    .filter((factor) => factor.startsWith(`${kind}:`))
    .map((factor) => factor.slice(kind.length + 1));
}

/** "Focus area is Liver and alt is at or above … and lifestyle includes High alcohol." */
function _focusAndConditionsReason(factors: readonly string[]): string {
  const [focusArea = ''] = _factorValues(factors, 'focusArea');
  const markers = _factorValues(factors, 'marker');
  const parts = [`Focus area is ${_humanize(focusArea)}`];

  if (markers.length > 0) {
    parts.push(`${markers.join(', ')} ${markers.length === 1 ? 'is' : 'are'} ${MIDPOINT_PHRASE}`);
  }

  if (_factorValues(factors, 'lifestyle').length > 0) {
    parts.push(`lifestyle includes ${_lifestyleList(factors)}`);
  }

  return `${parts.join(' and ')}.`;
}

/** "Smoking, Low activity". */
function _lifestyleList(factors: readonly string[]): string {
  return _factorValues(factors, 'lifestyle').map(_humanize).join(', ');
}

/** `LOW_ACTIVITY` → "Low activity". */
function _humanize(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');

  return words.charAt(0).toUpperCase() + words.slice(1);
}
