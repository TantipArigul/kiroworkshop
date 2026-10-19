import type { NextflowResult, SmartCheckupResult } from '@portal/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BAND_LABELS, BandIcon, BandLabel, MarkerBarChart, SampleBarChart } from './BarChart';

// Band/legend mapping (design C8, US-009 AC3): bands are never shown by colour alone.

type Marker = SmartCheckupResult['markers'][number];
type Sample = NextflowResult['samples'][number];

const MARKERS: Marker[] = [
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
    midpoint: 7.6,
    min: 0.2,
    unit: 'mg/dL',
    value: 1.1,
  },
];

const SAMPLES: Sample[] = [
  {
    avgLen: 1250.5,
    avgQual: 17.2,
    maxLen: 4000,
    minLen: 200,
    numSeqs: 1200,
    sample: 'sample_a',
    sumLen: 1_500_000,
  },
  {
    avgLen: 900,
    avgQual: 8.6,
    maxLen: 1000,
    minLen: 100,
    numSeqs: 600,
    sample: 'sample_b',
    sumLen: 540_000,
  },
];

const count = (html: string, text: string) => html.split(text).length - 1;

describe('band mapping', () => {
  it('has a text label for both training bands', () => {
    expect(BAND_LABELS).toEqual({
      AT_OR_ABOVE_TRAINING_MIDPOINT: 'At or above training midpoint',
      BELOW_TRAINING_MIDPOINT: 'Below training midpoint',
    });
  });

  it('uses a distinct, decorative icon shape per band', () => {
    const below = renderToStaticMarkup(<BandIcon band="BELOW_TRAINING_MIDPOINT" />);
    const above = renderToStaticMarkup(<BandIcon band="AT_OR_ABOVE_TRAINING_MIDPOINT" />);
    expect(below).toContain('<circle');
    expect(below).not.toContain('<rect');
    expect(above).toContain('<rect');
    expect(above).not.toContain('<circle');
    for (const html of [below, above]) {
      expect(html).toContain('aria-hidden="true"');
    }
  });

  it('pairs icon, text label and band class', () => {
    const below = renderToStaticMarkup(<BandLabel band="BELOW_TRAINING_MIDPOINT" />);
    const above = renderToStaticMarkup(<BandLabel band="AT_OR_ABOVE_TRAINING_MIDPOINT" />);
    expect(below).toContain('band--low');
    expect(below).toContain('<span>Below training midpoint</span>');
    expect(above).toContain('band--high');
    expect(above).toContain('<span>At or above training midpoint</span>');
  });
});

describe('MarkerBarChart', () => {
  const html = renderToStaticMarkup(<MarkerBarChart markers={MARKERS} />);

  it('shows a legend with both bands and the midpoint line', () => {
    const legend = html.slice(html.indexOf('aria-label="Legend"'), html.indexOf('</ul>'));
    expect(legend).toContain('Below training midpoint');
    expect(legend).toContain('At or above training midpoint');
    expect(legend).toContain('Training midpoint');
  });

  it('labels every marker band in the chart and in the paired table', () => {
    const table = html.slice(html.indexOf('<table'));
    expect(table).toContain('<caption id="marker-table-caption">');
    expect(table).toContain('<code>alt</code>');
    expect(table).toContain('<code>creatinine</code>');
    expect(count(table, 'At or above training midpoint')).toBe(1);
    expect(count(table, 'Below training midpoint')).toBe(1);
    // Legend + chart row + table row per band.
    expect(count(html, 'At or above training midpoint')).toBe(3);
    expect(count(html, 'Below training midpoint')).toBe(3);
  });

  it('keeps the bars decorative and states the synthetic threshold', () => {
    expect(html).toContain('<div aria-hidden="true" class="chart-rows">');
    expect(html).toContain('<svg aria-hidden="true" class="chart-bar"');
    expect(html).toContain('Synthetic training threshold, not a clinical reference.');
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
  });

  it('places the bar fill and midpoint inside the training range', () => {
    // alt: (300 − 5) / 495 ≈ 0.596; midpoint line at 50 of 100.
    expect(html).toMatch(/--bar-fraction:0\.59/);
    expect(html).toContain('x1="50"');
  });

  it('renders an empty state without rows', () => {
    expect(renderToStaticMarkup(<MarkerBarChart markers={[]} />)).toContain(
      'This result has no marker rows to chart.',
    );
  });
});

describe('SampleBarChart', () => {
  it('lists every sample in the paired table with all statistics', () => {
    const html = renderToStaticMarkup(<SampleBarChart samples={SAMPLES} />);
    const table = html.slice(html.indexOf('<table'));
    expect(count(table, '<th scope="row">')).toBe(2);
    expect(table).toContain('<code>sample_a</code>');
    expect(table).toContain('<code>sample_b</code>');
    expect(html).toContain('Bars are relative to the largest sample in this run.');
    // The largest sample fills its bar; the other is relative to it.
    expect(html).toContain('--bar-fraction:1');
    expect(html).toContain('--bar-fraction:0.5');
  });

  it('renders an empty state without samples', () => {
    expect(renderToStaticMarkup(<SampleBarChart samples={[]} />)).toContain(
      'No per-sample statistics were produced for this run.',
    );
  });
});
