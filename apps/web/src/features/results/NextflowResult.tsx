import type { NextflowResult as NextflowResultData } from '@portal/shared';

import { formatBytes } from '../jobs/jobsApi';
import { ArtifactList } from './ArtifactList';
import { formatNumber, SampleBarChart } from './BarChart';
import { ResultReferences, SummaryFacts } from './ResultReferences';

/** wf-renamefastq layout (design C8): summary → per-sample chart + table → files → references. */
export function NextflowResult({ jobId, result }: { jobId: string; result: NextflowResultData }) {
  const { summary } = result;

  return (
    <>
      <section aria-labelledby="result-summary-title" className="ui-card result-section">
        <h2 id="result-summary-title">Summary</h2>
        <SummaryFacts
          facts={[
            { label: 'Run name', value: summary.runName || 'Not set' },
            { label: 'Samples', value: formatNumber(summary.sampleCount) },
            { label: 'Total reads', value: formatNumber(summary.totalReads) },
            { label: 'Total bases', value: formatNumber(summary.totalBases) },
            { label: 'Output files', value: formatNumber(summary.outputFileCount) },
            { label: 'Output size', value: formatBytes(summary.outputBytes) },
          ]}
        />
      </section>

      <section aria-labelledby="result-chart-title" className="ui-card result-section">
        <h2 id="result-chart-title">Per-sample statistics</h2>
        <SampleBarChart samples={result.samples} />
      </section>

      <section aria-labelledby="result-files-title" className="ui-card result-section">
        <h2 id="result-files-title">Files</h2>
        <ArtifactList artifacts={result.artifacts} jobId={jobId} />
      </section>

      <ResultReferences references={result.references} />
    </>
  );
}
