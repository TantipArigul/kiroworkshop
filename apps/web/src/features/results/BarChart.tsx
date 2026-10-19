import type { CSSProperties } from 'react';

import type { NextflowResult, SmartCheckupResult, TrainingBand } from '@portal/shared';

/**
 * Accessible bar charts for the result page (design C8, D3-7). The SVG bars are decorative
 * (`aria-hidden`); every value is also in the paired `<table>`. Bands always show a distinct
 * icon shape, a text label and a legend, never colour alone (US-009 AC3).
 */

type Marker = SmartCheckupResult['markers'][number];
type Sample = NextflowResult['samples'][number];

export const BAND_LABELS: Record<TrainingBand, string> = {
  BELOW_TRAINING_MIDPOINT: 'Below training midpoint',
  AT_OR_ABOVE_TRAINING_MIDPOINT: 'At or above training midpoint',
};

const BAND_CLASS: Record<TrainingBand, string> = {
  BELOW_TRAINING_MIDPOINT: 'band--low',
  AT_OR_ABOVE_TRAINING_MIDPOINT: 'band--high',
};

const THRESHOLD_NOTE = 'Synthetic training threshold, not a clinical reference.';
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** Circle + down arrow for "below", square + up arrow for "at or above": distinct shapes. */
export function BandIcon({ band }: { band: TrainingBand }) {
  return band === 'BELOW_TRAINING_MIDPOINT' ? (
    <svg aria-hidden="true" className="band-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M8 13l4 4 4-4" />
    </svg>
  ) : (
    <svg aria-hidden="true" className="band-icon" viewBox="0 0 24 24">
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <path d="M12 17V7M8 11l4-4 4 4" />
    </svg>
  );
}

export function BandLabel({ band }: { band: TrainingBand }) {
  return (
    <span className={`band-label ${BAND_CLASS[band]}`}>
      <BandIcon band={band} />
      <span>{BAND_LABELS[band]}</span>
    </span>
  );
}

function BandLegend() {
  return (
    <ul aria-label="Legend" className="chart-legend">
      <li>
        <BandLabel band="BELOW_TRAINING_MIDPOINT" />
      </li>
      <li>
        <BandLabel band="AT_OR_ABOVE_TRAINING_MIDPOINT" />
      </li>
      <li>
        <span className="chart-legend__midpoint" aria-hidden="true" />
        <span>Training midpoint</span>
      </li>
    </ul>
  );
}

/** Fraction of the track filled by `value` within `[min, max]`, clamped to 0–1. */
function fraction(value: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }

  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Track + bar in a 100-unit wide box; the bar is scaled from the left by a CSS variable. */
function Bar({ className, marker, value }: { className: string; marker?: number; value: number }) {
  return (
    <svg
      aria-hidden="true"
      className="chart-bar"
      focusable="false"
      preserveAspectRatio="none"
      viewBox="0 0 100 10"
    >
      <rect className="chart-bar__track" height="10" width="100" />
      <rect
        className={`chart-bar__fill ${className}`}
        height="10"
        style={{ '--bar-fraction': value } as CSSProperties}
        width="100"
      />
      {marker === undefined ? null : (
        <line className="chart-bar__midpoint" x1={marker * 100} x2={marker * 100} y1="0" y2="10" />
      )}
    </svg>
  );
}

/** Smart Checkup: each marker within its synthetic validation range, with the midpoint line. */
export function MarkerBarChart({ markers }: { markers: SmartCheckupResult['markers'] }) {
  if (markers.length === 0) {
    return <p className="result-empty">This result has no marker rows to chart.</p>;
  }

  return (
    <figure aria-labelledby="marker-chart-title" className="result-chart">
      <figcaption className="result-chart__caption">
        <span id="marker-chart-title">Marker values within their training range</span>
        <span className="result-chart__note">{THRESHOLD_NOTE}</span>
      </figcaption>
      <BandLegend />
      <div aria-hidden="true" className="chart-rows">
        {markers.map((marker) => (
          <MarkerRow key={marker.marker} marker={marker} />
        ))}
      </div>
      <div
        aria-labelledby="marker-table-caption"
        className="result-table-wrap"
        role="region"
        tabIndex={0}
      >
        <table className="result-table">
          <caption id="marker-table-caption">Marker values (same data as the chart)</caption>
          <thead>
            <tr>
              <th scope="col">Marker</th>
              <th scope="col">Value</th>
              <th scope="col">Training range</th>
              <th scope="col">Training midpoint</th>
              <th scope="col">Band</th>
            </tr>
          </thead>
          <tbody>
            {markers.map((marker) => (
              <tr key={marker.marker}>
                <th scope="row">
                  <code>{marker.marker}</code>
                </th>
                <td>
                  {formatNumber(marker.value)} {marker.unit}
                </td>
                <td>
                  {formatNumber(marker.min)}–{formatNumber(marker.max)} {marker.unit}
                </td>
                <td>{formatNumber(marker.midpoint)}</td>
                <td>
                  <BandLabel band={marker.band} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function MarkerRow({ marker }: { marker: Marker }) {
  return (
    <div className="chart-row">
      <div className="chart-row__head">
        <code>{marker.marker}</code>
        <span>
          {formatNumber(marker.value)} {marker.unit}
        </span>
      </div>
      <Bar
        className={BAND_CLASS[marker.band]}
        marker={fraction(marker.midpoint, marker.min, marker.max)}
        value={fraction(marker.value, marker.min, marker.max)}
      />
      <div className="chart-row__scale">
        <span>{formatNumber(marker.min)}</span>
        <BandLabel band={marker.band} />
        <span>{formatNumber(marker.max)}</span>
      </div>
    </div>
  );
}

/** wf-renamefastq: reads and average quality per sample, scaled to the largest sample. */
export function SampleBarChart({ samples }: { samples: NextflowResult['samples'] }) {
  if (samples.length === 0) {
    return <p className="result-empty">No per-sample statistics were produced for this run.</p>;
  }

  const maxReads = Math.max(...samples.map((sample) => sample.numSeqs));
  const maxQuality = Math.max(...samples.map((sample) => sample.avgQual));

  return (
    <figure aria-labelledby="sample-chart-title" className="result-chart">
      <figcaption className="result-chart__caption">
        <span id="sample-chart-title">Reads and average quality per sample</span>
        <span className="result-chart__note">
          Bars are relative to the largest sample in this run.
        </span>
      </figcaption>
      <div aria-hidden="true" className="chart-groups">
        <SampleGroup
          label="Reads"
          max={maxReads}
          pick={(sample) => sample.numSeqs}
          samples={samples}
        />
        <SampleGroup
          label="Average quality (Q)"
          max={maxQuality}
          pick={(sample) => sample.avgQual}
          samples={samples}
        />
      </div>
      <div
        aria-labelledby="sample-table-caption"
        className="result-table-wrap"
        role="region"
        tabIndex={0}
      >
        <table className="result-table">
          <caption id="sample-table-caption">Per-sample statistics</caption>
          <thead>
            <tr>
              <th scope="col">Sample</th>
              <th scope="col">Reads</th>
              <th scope="col">Total bases</th>
              <th scope="col">Min length</th>
              <th scope="col">Average length</th>
              <th scope="col">Max length</th>
              <th scope="col">Average quality</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((sample) => (
              <tr key={sample.sample}>
                <th scope="row">
                  <code>{sample.sample}</code>
                </th>
                <td>{formatNumber(sample.numSeqs)}</td>
                <td>{formatNumber(sample.sumLen)}</td>
                <td>{formatNumber(sample.minLen)}</td>
                <td>{formatNumber(sample.avgLen)}</td>
                <td>{formatNumber(sample.maxLen)}</td>
                <td>{formatNumber(sample.avgQual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function SampleGroup({
  label,
  max,
  pick,
  samples,
}: {
  label: string;
  max: number;
  pick: (sample: Sample) => number;
  samples: NextflowResult['samples'];
}) {
  return (
    <div className="chart-group">
      <h3 className="chart-group__title">{label}</h3>
      <div className="chart-rows">
        {samples.map((sample) => (
          <div className="chart-row" key={sample.sample}>
            <div className="chart-row__head">
              <code>{sample.sample}</code>
              <span>{formatNumber(pick(sample))}</span>
            </div>
            <Bar className="chart-bar__fill--neutral" value={fraction(pick(sample), 0, max)} />
          </div>
        ))}
      </div>
    </div>
  );
}
