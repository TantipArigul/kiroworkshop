import type { ReactNode } from 'react';
import { Link } from 'react-router';

import {
  AGE_BANDS,
  FASTQ_EXTENSIONS,
  INPUT_FILE_HEADER,
  INPUT_FILE_MAX_ROWS,
  INPUT_MARKERS,
  RENAMEFASTQ_DEFAULT_Q_SCORE,
  RENAMEFASTQ_Q_SCORE_MAX,
  RENAMEFASTQ_Q_SCORE_MIN,
  RUN_INPUT_MAX_FASTQ_FILES,
  SAMPLE_SHEET_HEADER,
} from '@portal/shared/constants';

import { StatusBadge } from '../../components/ui';
import { BandLabel } from '../results/BarChart';
import { HEALTH_QUESTIONS_NOTE } from '../results/ResultReferences';

export const SAMPLE_RUN_PATH = '/pipelines/smart-checkup/run?sample=1';

const SECTIONS = [
  { id: 'overview', title: 'Overview' },
  { id: 'smart-checkup', title: 'Smart Checkup' },
  { id: 'wf-renamefastq', title: 'wf-renamefastq' },
  { id: 'statuses', title: 'Job statuses' },
  { id: 'results', title: 'Reading a result' },
  { id: 'failures', title: 'When something fails' },
  { id: 'disclaimer', title: 'Disclaimer' },
] as const;

/** Public `/help` guide with anchored sections (design C9, US-012 AC1–4). */
export function GuidePage() {
  return (
    <article aria-labelledby="guide-title" className="guide guide-page">
      <header className="guide-page__head">
        <p className="eyebrow">Guide</p>
        <h1 id="guide-title">Follow the analysis path with confidence.</h1>
        <p>
          How to prepare input, submit a run, follow its status and read the result. Everything in
          this portal uses synthetic or public test data for training.
        </p>
        <div className="guide-page__actions">
          <Link className="ui-button ui-button--primary" to={SAMPLE_RUN_PATH}>
            Try the sample
          </Link>
          <Link className="ui-button ui-button--ghost" to="/pipelines">
            Browse pipelines
          </Link>
        </div>
      </header>

      <nav aria-label="On this page" className="guide-toc">
        <h2>On this page</h2>
        <ol>
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <GuideSection id="overview" title="Overview">
        <ol className="guide-steps">
          <li>Choose a pipeline from the catalog.</li>
          <li>Provide the input and options, then submit. You get a job link straight away.</li>
          <li>
            Follow the status on the job page; it refreshes on its own while the job is active.
          </li>
          <li>When the job is completed, open View result to see the summary and files.</li>
        </ol>
        <p>
          Jobs and their files are private to your account and are deleted automatically after seven
          days. You can delete a job sooner from its page.
        </p>
      </GuideSection>

      <GuideSection id="smart-checkup" title="Smart Checkup">
        <h3>Input file</h3>
        <p>
          A CSV file with the header <code>{INPUT_FILE_HEADER}</code> and one row per marker (at
          most {INPUT_FILE_MAX_ROWS} rows). Each marker appears once, uses its listed unit and stays
          inside its accepted range.
        </p>
        <div
          aria-labelledby="guide-markers-caption"
          className="result-table-wrap"
          role="region"
          tabIndex={0}
        >
          <table className="result-table">
            <caption id="guide-markers-caption">Supported markers</caption>
            <thead>
              <tr>
                <th scope="col">Marker</th>
                <th scope="col">Unit</th>
                <th scope="col">Accepted range</th>
              </tr>
            </thead>
            <tbody>
              {INPUT_MARKERS.map((item) => (
                <tr key={item.marker}>
                  <th scope="row">
                    <code>{item.marker}</code>
                  </th>
                  <td>{item.unit}</td>
                  <td>
                    {item.min}–{item.max}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="guide-note">
          Ranges are validation limits for synthetic training data, not clinical reference ranges.
        </p>
        <h3>Parameters</h3>
        <ul>
          <li>Sample label: a short name to recognise the job.</li>
          <li>Age band: one of {AGE_BANDS.join(', ')}.</li>
          <li>Focus area: General, Cardiometabolic, Liver or Kidney.</li>
          <li>Lifestyle factors: any of smoking, low activity, high alcohol and poor sleep.</li>
          <li>Simulate a pipeline failure: practise the failure path; the job ends as Failed.</li>
        </ul>
        <h3>Submit</h3>
        <p>
          Load sample data or attach your own synthetic file, review the preview and submit. The job
          page opens with a link you can bookmark. <Link to={SAMPLE_RUN_PATH}>Try the sample</Link>{' '}
          to load the authored sample in one step; you still submit it yourself.
        </p>
      </GuideSection>

      <GuideSection id="wf-renamefastq" title="wf-renamefastq">
        <h3>Input types</h3>
        <ul>
          <li>Single FASTQ file.</li>
          <li>Folder of FASTQ files for one sample.</li>
          <li>Folder with one sub-folder per barcode, plus a sample sheet.</li>
        </ul>
        <p>
          Accepted file types are {FASTQ_EXTENSIONS.join(', ')}; at most {RUN_INPUT_MAX_FASTQ_FILES}{' '}
          FASTQ files and 1 GB per run.
        </p>
        <h3>Sample sheet</h3>
        <p>
          A CSV file with the header <code>{SAMPLE_SHEET_HEADER.join(',')}</code>. Each row maps a
          barcode sub-folder to the sample name used for the renamed output.
        </p>
        <h3>Options</h3>
        <ul>
          <li>Demultiplex: split reads by barcode with the selected barcoding kit.</li>
          <li>Quality filter: drop reads below the minimum Q-score.</li>
          <li>
            Minimum Q-score: whole number from {RENAMEFASTQ_Q_SCORE_MIN} to{' '}
            {RENAMEFASTQ_Q_SCORE_MAX} (default {RENAMEFASTQ_DEFAULT_Q_SCORE}).
          </li>
        </ul>
        <h3>Test data</h3>
        <p>
          Use public test FASTQ files only, never patient data. An administrator prepares the test
          data from the pipeline&apos;s own cache; no FASTQ files are stored in this repository.
        </p>
      </GuideSection>

      <GuideSection id="statuses" title="Job statuses">
        <dl className="guide-statuses">
          <div>
            <dt>
              <StatusBadge status="queued" />
            </dt>
            <dd>Accepted and waiting for its turn.</dd>
          </div>
          <div>
            <dt>
              <StatusBadge status="running" />
            </dt>
            <dd>The pipeline is working on it.</dd>
          </div>
          <div>
            <dt>
              <StatusBadge status="completed" />
            </dt>
            <dd>Finished; the result and files are available.</dd>
          </div>
          <div>
            <dt>
              <StatusBadge status="failed" />
            </dt>
            <dd>Stopped with an error; no result is produced.</dd>
          </div>
          <div>
            <dt>
              <StatusBadge status="cancelled" />
            </dt>
            <dd>Stopped by you while queued or running; no result is produced.</dd>
          </div>
        </dl>
      </GuideSection>

      <GuideSection id="results" title="Reading a result">
        <h3>Summary</h3>
        <p>The first card repeats the run name and the inputs or totals the result is based on.</p>
        <h3>Bars, legend and bands</h3>
        <p>
          Smart Checkup draws each marker inside its accepted range with a line at the midpoint of
          that range. Each marker gets a band, shown with a label, an icon and a colour:
        </p>
        <ul className="guide-bands">
          <li>
            <BandLabel band="BELOW_TRAINING_MIDPOINT" />
          </li>
          <li>
            <BandLabel band="AT_OR_ABOVE_TRAINING_MIDPOINT" />
          </li>
        </ul>
        <p>
          The midpoint is a synthetic training threshold, not a clinical reference. wf-renamefastq
          shows reads and average quality per sample. Every chart has a table with the same values.
        </p>
        <h3>Mock recommendation and its limits</h3>
        <p>
          Smart Checkup applies deterministic mock rules. The card shows the training package, the
          rule ID and version, the input factors that matched and the reason. When no rule matches
          it shows No mock recommendation. It is training output, not medical advice.
        </p>
        <h3>References</h3>
        <p>
          Links to this guide and to tool documentation. External links open in a new tab; there are
          no medical links.
        </p>
        <h3>Download</h3>
        <p>
          Files are grouped by category with their size. Download saves the file; only the job owner
          can download it, and files are removed with the job after seven days.
        </p>
        <h3>HTML report viewer</h3>
        <p>
          Nextflow execution reports and timelines open with View in an isolated frame that cannot
          reach this site or the network, or in a new tab. The DAG report loads scripts from the
          internet, so it can only be downloaded.
        </p>
      </GuideSection>

      <GuideSection id="failures" title="When something fails">
        <ul>
          <li>Invalid input: the form names the field to fix and nothing is submitted.</li>
          <li>Failed job: the job page shows a safe summary; start a new run after fixing it.</li>
          <li>Result not available yet: wait until the job is completed, then refresh.</li>
          <li>Files removed: the retention policy deleted them; submit a new run.</li>
          <li>
            Sample cannot load: go <Link to="/pipelines">back to pipelines</Link> and fill in the
            form yourself.
          </li>
        </ul>
      </GuideSection>

      <GuideSection id="disclaimer" title="Disclaimer">
        <div className="result-disclaimer" role="note">
          <svg aria-hidden="true" className="result-disclaimer__icon" viewBox="0 0 24 24">
            <path d="M12 3 2 20h20L12 3Z" />
            <path d="M12 10v4M12 17v.5" />
          </svg>
          <p>
            <strong>Training output only. Not a medical diagnosis or treatment advice.</strong>{' '}
            {HEALTH_QUESTIONS_NOTE}
          </p>
        </div>
      </GuideSection>
    </article>
  );
}

function GuideSection({ children, id, title }: { children: ReactNode; id: string; title: string }) {
  return (
    <section aria-labelledby={`${id}-title`} className="ui-card guide-section" id={id}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  );
}
