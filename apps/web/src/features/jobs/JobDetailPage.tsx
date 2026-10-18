import { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import type { JobDetail, JobRunInfo } from '@portal/shared';

import { Button, FeedbackMessage } from '../../components/ui';
import { ApiRequestError } from '../auth/apiClient';
import { useAuth } from '../auth/authContext';
import { LAYOUT_LABELS } from '../pipelines/pipelinesApi';
import { CancelJob } from './CancelJob';
import { JobProgress } from './JobProgress';
import { JobStatusBadge } from './JobStatusBadge';
import { createJobsApi, formatBytes, formatDateTime, humanize } from './jobsApi';
import { useJobPolling } from './useJobPolling';

export function JobDetailPage() {
  const { jobId = '' } = useParams();
  const { api } = useAuth();
  const jobsApi = useMemo(() => createJobsApi(api), [api]);
  const { polling, refresh, state } = useJobPolling(jobsApi, jobId);
  const location = useLocation();
  const submitted = Boolean((location.state as { submitted?: boolean } | null)?.submitted);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  if (state.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading job" className="page-skeleton">
        <span className="skeleton skeleton--eyebrow" />
        <span className="skeleton skeleton--title" />
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
      </div>
    );
  }

  if (state.status === 'unavailable') {
    return <JobUnavailable />;
  }

  if (state.status === 'error') {
    return (
      <section className="state-page" aria-labelledby="job-error-title">
        <h1 id="job-error-title">This job could not be loaded</h1>
        <FeedbackMessage tone="error">
          The service did not respond. No job information is shown until it can be confirmed.
        </FeedbackMessage>
        <Button onClick={() => void refresh()} variant="secondary">
          Try again
        </Button>
      </section>
    );
  }

  const { job } = state;

  return (
    <section aria-labelledby="job-title" className="jobs-page job-detail">
      <nav aria-label="Breadcrumb" className="job-detail__crumbs">
        <Link to="/jobs">Runs and jobs</Link>
        <span aria-hidden="true">/</span>
        <span className="jobs-mono">{job.id}</span>
      </nav>

      {submitted ? (
        <FeedbackMessage tone="success">
          Job submitted. Bookmark this page to return to it later:{' '}
          <span className="jobs-mono">{window.location.origin + job.statusUrl}</span>
        </FeedbackMessage>
      ) : null}

      <header className="job-detail__head">
        <div>
          <p className="eyebrow">{job.pipelineName}</p>
          <h1 id="job-title">{job.runName || job.sampleLabel}</h1>
        </div>
        <div className="job-detail__status">
          <JobStatusBadge status={job.status} />
          <p className="job-detail__updated" aria-live="polite">
            {state.stale ? (
              <strong>Could not refresh — showing data from </strong>
            ) : (
              'Last updated '
            )}
            <time dateTime={state.lastUpdated.toISOString()}>
              {formatDateTime(state.lastUpdated.toISOString())}
            </time>
            {state.stale ? <strong>; it may be out of date.</strong> : null}
            {polling && !state.stale ? ' · refreshing automatically' : null}
          </p>
          <Button disabled={state.refreshing} onClick={() => void refresh()} variant="secondary">
            {state.refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {cancelNotice ? <FeedbackMessage tone="info">{cancelNotice}</FeedbackMessage> : null}

      <JobOutcome job={job} />

      {job.cancellable ? (
        <CancelJob
          jobId={job.id}
          onSettled={(notice) => {
            setCancelNotice(notice);
            void refresh();
          }}
        />
      ) : null}

      <div className="job-detail__grid">
        <section aria-labelledby="job-history-title" className="ui-card job-panel">
          <h2 id="job-history-title">Status history</h2>
          <ol className="job-timeline">
            {job.history.map((event) => (
              <li key={`${event.status}-${event.occurredAt}`}>
                <JobStatusBadge status={event.status} />
                <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
                {event.summary ? <p>{event.summary}</p> : null}
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="job-input-title" className="ui-card job-panel">
          <h2 id="job-input-title">Submitted input</h2>
          <dl className="job-facts">
            <div>
              <dt>Pipeline</dt>
              <dd>{job.pipelineName}</dd>
            </div>
            <div>
              <dt>Run name</dt>
              <dd>{job.runName || job.sampleLabel}</dd>
            </div>
            <div>
              <dt>Job ID</dt>
              <dd className="jobs-mono">{job.id}</dd>
            </div>
            {job.run ? <RunFacts run={job.run} /> : null}
            {job.parameters ? (
              <>
                <div>
                  <dt>Age band</dt>
                  <dd>{job.parameters.ageBand}</dd>
                </div>
                <div>
                  <dt>Focus area</dt>
                  <dd>{humanize(job.parameters.focusArea)}</dd>
                </div>
                <div>
                  <dt>Lifestyle factors</dt>
                  <dd>
                    {job.parameters.lifestyleFactors.length > 0
                      ? job.parameters.lifestyleFactors.map(humanize).join(', ')
                      : 'None selected'}
                  </dd>
                </div>
                <div>
                  <dt>Simulated failure</dt>
                  <dd>{job.parameters.simulateFailure ? 'Requested' : 'No'}</dd>
                </div>
              </>
            ) : null}
            {job.file ? (
              <div>
                <dt>File</dt>
                <dd>
                  {job.file.name} · {formatBytes(job.file.sizeBytes)} · {job.file.rowCount} rows
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Submitted</dt>
              <dd>
                <time dateTime={job.createdAt}>{formatDateTime(job.createdAt)}</time>
              </dd>
            </div>
            <div>
              <dt>Deleted automatically</dt>
              <dd>
                <time dateTime={job.expiresAt}>{formatDateTime(job.expiresAt)}</time>
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <DeleteJob jobId={job.id} onDeleteFailed={() => void refresh()} />
    </section>
  );
}

function JobOutcome({ job }: { job: JobDetail }) {
  const relaunchPath = `/pipelines/${job.pipelineId}/run`;

  if (job.status === 'FAILED') {
    return (
      <div className="job-outcome job-outcome--failed" role="status">
        <h2>The run failed</h2>
        <p>{job.failureSummary ?? 'The run did not finish. Submit it again.'}</p>
        <p>No result is available for a failed job.</p>
        <Link className="ui-button ui-button--secondary" to={relaunchPath}>
          Start a new run
        </Link>
      </div>
    );
  }

  if (job.status === 'CANCELLED') {
    return (
      <div className="job-outcome job-outcome--cancelled" role="status">
        <h2>The run was cancelled</h2>
        <p>
          It was stopped before finishing, so no result is available. The job record, its input and
          status history are kept until automatic deletion, and you can still delete it below.
        </p>
        <Link className="ui-button ui-button--secondary" to={relaunchPath}>
          Start a new run
        </Link>
      </div>
    );
  }

  if (job.status === 'COMPLETED') {
    // US-020 AC5: no link to a result page that does not exist yet (both pipelines).
    return (
      <div className="job-outcome job-outcome--completed" role="status">
        <h2>The run completed</h2>
        <p>The run completed. Results will be viewable when the Results view is available.</p>
        {job.outputs ? (
          <p>
            {job.outputs.fileCount} output file{job.outputs.fileCount === 1 ? '' : 's'} (
            {formatBytes(job.outputs.totalBytes)}) were recorded for this run.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    // Only the heading is live: the elapsed time changes on every poll and would be re-announced.
    <div className="job-outcome">
      <h2 role="status">{job.status === 'QUEUED' ? 'Waiting to start' : 'Run in progress'}</h2>
      <JobProgress
        progress={job.progress}
        queuePosition={job.queuePosition}
        status={job.status}
        variant="full"
      />
      <p>
        This page refreshes on its own while the job is active. You can leave and come back with the
        same link.
      </p>
    </div>
  );
}

/** Input summary of a Nextflow run: layout, files, sample name or sheet, and options. */
function RunFacts({ run }: { run: JobRunInfo }) {
  const fastq = run.files.filter((file) => file.kind === 'FASTQ');
  const sheet = run.files.find((file) => file.kind === 'SAMPLE_SHEET');
  const totalBytes = fastq.reduce((sum, file) => sum + file.sizeBytes, 0);

  return (
    <>
      <div>
        <dt>Input type</dt>
        <dd>{LAYOUT_LABELS[run.layout]}</dd>
      </div>
      <div>
        <dt>
          FASTQ files ({fastq.length}, {formatBytes(totalBytes)})
        </dt>
        <dd>
          <ul className="job-files">
            {fastq.map((file) => (
              <li key={file.relativePath}>
                <code>{file.relativePath}</code> · {formatBytes(file.sizeBytes)}
              </li>
            ))}
          </ul>
        </dd>
      </div>
      {run.layout === 'BARCODE_FOLDERS' ? (
        <div>
          <dt>Sample sheet</dt>
          <dd>{sheet ? `Provided · ${formatBytes(sheet.sizeBytes)}` : 'Not provided'}</dd>
        </div>
      ) : (
        <div>
          <dt>Sample name</dt>
          <dd>{run.sampleName ?? 'Not set'}</dd>
        </div>
      )}
      <div>
        <dt>Options</dt>
        <dd>
          <ul className="job-files">
            <li>
              Demultiplex: {run.options.demultiplex ? `Yes (kit ${run.options.kitName})` : 'No'}
            </li>
            <li>Quality filter: {run.options.qualityFilter ? 'On' : 'Off'}</li>
            <li>Minimum Q-score: {run.options.qScore}</li>
          </ul>
        </dd>
      </div>
    </>
  );
}

function DeleteJob({ jobId, onDeleteFailed }: { jobId: string; onDeleteFailed: () => void }) {
  const { api } = useAuth();
  const jobsApi = useMemo(() => createJobsApi(api), [api]);
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setDeleting(true);
    setError(null);

    try {
      await jobsApi.remove(jobId);
      dialogRef.current?.close();
      navigate('/jobs', { replace: true, state: { deletedJobId: jobId } });
    } catch (caught) {
      setDeleting(false);

      if (caught instanceof ApiRequestError && caught.status === 404) {
        dialogRef.current?.close();
        onDeleteFailed();
        return;
      }

      setError('The job could not be deleted. Nothing was removed — try again.');
    }
  }

  return (
    <section aria-labelledby="job-delete-title" className="job-delete">
      <div>
        <h2 id="job-delete-title">Delete this job</h2>
        <p>Removes the job, its input file and any results now, instead of after seven days.</p>
      </div>
      <Button onClick={() => dialogRef.current?.showModal()} variant="secondary">
        Delete job
      </Button>
      <dialog aria-labelledby="job-delete-dialog-title" className="job-dialog" ref={dialogRef}>
        <h2 id="job-delete-dialog-title">Delete job permanently?</h2>
        <p>
          The job <span className="jobs-mono">{jobId}</span>, its input and results will be removed.
          This cannot be undone and the bookmarked link will stop working.
        </p>
        {error ? <FeedbackMessage tone="error">{error}</FeedbackMessage> : null}
        <div className="job-dialog__actions">
          <Button disabled={deleting} onClick={() => dialogRef.current?.close()} variant="ghost">
            Keep job
          </Button>
          <Button
            className="ui-button--danger"
            disabled={deleting}
            onClick={() => void confirmDelete()}
          >
            {deleting ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </div>
      </dialog>
    </section>
  );
}

function JobUnavailable() {
  return (
    <section aria-labelledby="job-unavailable-title" className="state-page">
      <svg aria-hidden="true" className="state-page__icon" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="18" />
        <path d="M24 15v11M24 32v1" />
      </svg>
      <h1 id="job-unavailable-title">This job is unavailable</h1>
      <p>
        It may have been deleted, removed automatically after seven days, or it belongs to a
        different account. Job data is never shown to anyone except its owner.
      </p>
      <Link className="ui-button ui-button--primary" to="/jobs">
        Back to your jobs
      </Link>
    </section>
  );
}
