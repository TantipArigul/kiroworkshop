import type { Recommendation } from '@portal/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecommendationCard } from './RecommendationCard';

// Recommendation card (design C8, US-010 AC1–3).

const DISCLAIMER = 'Training output only. Not a medical diagnosis or treatment advice.';

const MATCHED: Recommendation = {
  disclaimer: DISCLAIMER,
  matched: true,
  matchedFactors: ['focusArea:LIVER', 'marker:alt', 'lifestyle:HIGH_ALCOHOL'],
  packageLabel: 'Training Package C — Liver',
  reason: 'Focus area is Liver and alt is at or above the synthetic training midpoint.',
  ruleId: 'MOCK-LIVER-01',
  ruleVersion: 'mock-rules-2026.10-1',
};

const NO_MATCH: Recommendation = {
  disclaimer: DISCLAIMER,
  matched: false,
  matchedFactors: [],
  packageLabel: 'No mock recommendation',
  reason: 'No mock rule matches this input, so no package is recommended.',
  ruleId: 'NO_MATCH',
  ruleVersion: 'mock-rules-2026.10-1',
};

describe('RecommendationCard', () => {
  it('shows package, rule + version, matched factors as text chips, reason and disclaimer', () => {
    const html = renderToStaticMarkup(<RecommendationCard recommendation={MATCHED} />);
    expect(html).toContain('<h2 id="recommendation-title">Training Package C — Liver</h2>');
    expect(html).toContain('<code>MOCK-LIVER-01</code>');
    expect(html).toContain('<code>mock-rules-2026.10-1</code>');
    expect(html).toContain('aria-label="Matched input factors"');
    expect(html).toContain('<li>Focus area: Liver</li>');
    expect(html).toContain('<li>Marker: alt</li>');
    expect(html).toContain('<li>Lifestyle: High alcohol</li>');
    expect(html).toContain('Why this rule matched');
    expect(html).toContain(MATCHED.reason);
    expect(html).toContain(`<strong>${DISCLAIMER}</strong>`);
    expect(html).toContain('role="note"');
    expect(html).not.toContain('recommendation--none');
  });

  it('shows "No mock recommendation" with its reason and no factors for NO_MATCH', () => {
    const html = renderToStaticMarkup(<RecommendationCard recommendation={NO_MATCH} />);
    expect(html).toContain('<h2 id="recommendation-title">No mock recommendation</h2>');
    expect(html).toContain('Why there is no recommendation');
    expect(html).toContain(NO_MATCH.reason);
    expect(html).toContain('<code>NO_MATCH</code>');
    expect(html).not.toContain('Matched input factors');
    expect(html).not.toContain('Training Package');
    expect(html).toContain('recommendation--none');
    expect(html).toContain(`<strong>${DISCLAIMER}</strong>`);
  });

  it('renders the heading from the matched flag, not from the stored label', () => {
    const html = renderToStaticMarkup(
      <RecommendationCard recommendation={{ ...NO_MATCH, packageLabel: 'Training Package A' }} />,
    );
    expect(html).toContain('<h2 id="recommendation-title">No mock recommendation</h2>');
    expect(html).not.toContain('Training Package A');
  });
});
