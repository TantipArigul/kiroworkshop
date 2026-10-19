import type { Recommendation } from '@portal/shared';

import { humanize } from '../jobs/jobsApi';

const FACTOR_KIND_LABELS: Record<string, string> = {
  focusArea: 'Focus area',
  marker: 'Marker',
  lifestyle: 'Lifestyle',
};

/** `focusArea:LIVER` → "Focus area: Liver"; marker names stay as written in the input file. */
function factorLabel(factor: string): string {
  const [kind = '', value = ''] = factor.split(':');
  const shown = kind === 'marker' ? value : humanize(value);

  return `${FACTOR_KIND_LABELS[kind] ?? kind}: ${shown}`;
}

/**
 * Mock package recommendation (design C8, US-010 AC1–3): package, rule id + version, matched
 * factors as text chips, reason and a prominent training-only disclaimer. `NO_MATCH` shows
 * "No mock recommendation" with its reason instead of guessing a package.
 */
export function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  const { matched } = recommendation;

  return (
    <section
      aria-labelledby="recommendation-title"
      className={`ui-card result-section recommendation${matched ? '' : ' recommendation--none'}`}
    >
      <div className="recommendation__head">
        <p className="eyebrow">Mock package recommendation</p>
        <h2 id="recommendation-title">
          {matched ? recommendation.packageLabel : 'No mock recommendation'}
        </h2>
        <p className="recommendation__rule">
          Rule <code>{recommendation.ruleId}</code> · version{' '}
          <code>{recommendation.ruleVersion}</code>
        </p>
      </div>

      {matched ? (
        <div className="recommendation__factors">
          <h3>Matched input factors</h3>
          <ul aria-label="Matched input factors" className="factor-chips">
            {recommendation.matchedFactors.map((factor) => (
              <li key={factor}>{factorLabel(factor)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h3>{matched ? 'Why this rule matched' : 'Why there is no recommendation'}</h3>
        <p>{recommendation.reason}</p>
      </div>

      <div className="result-disclaimer" role="note">
        <svg aria-hidden="true" className="result-disclaimer__icon" viewBox="0 0 24 24">
          <path d="M12 3 2 20h20L12 3Z" />
          <path d="M12 10v4M12 17v.5" />
        </svg>
        <p>
          <strong>{recommendation.disclaimer}</strong> The rule is deterministic mock logic for
          training and is not medical advice.
        </p>
      </div>
    </section>
  );
}
