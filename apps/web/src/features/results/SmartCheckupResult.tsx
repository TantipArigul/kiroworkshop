import type { SmartCheckupResult as SmartCheckupResultData } from '@portal/shared';

import { formatDateTime, humanize } from '../jobs/jobsApi';
import { ArtifactList } from './ArtifactList';
import { MarkerBarChart } from './BarChart';
import { RecommendationCard } from './RecommendationCard';
import { ResultReferences, SummaryFacts } from './ResultReferences';

/** Smart Checkup layout (design C8): summary → chart → recommendation → files → references. */
export function SmartCheckupResult({
  jobId,
  result,
}: {
  jobId: string;
  result: SmartCheckupResultData;
}) {
  const { summary } = result;

  return (
    <>
      <section aria-labelledby="result-summary-title" className="ui-card result-section">
        <h2 id="result-summary-title">Summary</h2>
        <SummaryFacts
          facts={[
            { label: 'Run name', value: summary.runName || 'Not set' },
            { label: 'Focus area', value: humanize(summary.focusArea) },
            { label: 'Age band', value: summary.ageBand },
            {
              label: 'Lifestyle factors',
              value:
                summary.lifestyleFactors.length > 0
                  ? summary.lifestyleFactors.map(humanize).join(', ')
                  : 'None selected',
            },
            { label: 'Markers', value: String(summary.markerCount) },
            { label: 'Generated', value: formatDateTime(summary.generatedAt) },
          ]}
        />
      </section>

      <section aria-labelledby="result-chart-title" className="ui-card result-section">
        <h2 id="result-chart-title">Markers</h2>
        <MarkerBarChart markers={result.markers} />
      </section>

      <RecommendationCard recommendation={result.recommendation} />

      <section aria-labelledby="result-files-title" className="ui-card result-section">
        <h2 id="result-files-title">Files</h2>
        <ArtifactList artifacts={result.artifacts} jobId={jobId} />
      </section>

      <ResultReferences references={result.references} />
    </>
  );
}
