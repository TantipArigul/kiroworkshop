import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import type { JobResult, JobStatus } from '@portal/shared';
import { JOB_STATUSES } from '@portal/shared/constants';

import { Button, FeedbackMessage } from '../../components/ui';
import { ApiRequestError } from '../auth/apiClient';
import { useAuth } from '../auth/authContext';
import { JobStatusBadge } from '../jobs/JobStatusBadge';
import { formatDateTime } from '../jobs/jobsApi';
import { NextflowResult } from './NextflowResult';
import { createResultsApi } from './resultsApi';
import { SmartCheckupResult } from './SmartCheckupResult';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; result: JobResult; loadedAt: Date; stale: boolean }
  | { status: 'not-ready'; jobStatus: JobStatus | null }
  | { status: 'gone' }
  | { status: 'not-found' }
  | { status: 'error' };

const PIPELINE_NAMES: Record<JobResult['pipelineId'], string> = {
  'smart-checkup': 'Smart Checkup',
  'wf-renamefastq': 'wf-renamefastq',
};

/**
 * `/jobs/:jobId/result` (design C8, US-009). Loads the result once; the user refreshes manually
 * (no polling). `409` → not completed yet, `410` → files removed, `404` → unavailable.
 */
export function ResultPage() {
  const { jobId = '' } = useParams();
  const { api } = useAuth();
  const resultsApi = useMemo(() => createResultsApi(api), [api]);
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);

    try {
      const result = await resultsApi.getResult(jobId);

      // US-009 AC4: an unreadable payload is an error state, never a partial result.
      if (typeof result !== 'object' || !Object.hasOwn(PIPELINE_NAMES, result?.pipelineId)) {
        throw new Error('Unexpected result shape.');
      }

      setState({ status: 'ready', result, loadedAt: new Date(), stale: false });
    } catch (error) {
      setState((previous) => nextStateForError(previous, error));
    } finally {
      setRefreshing(false);
    }
  }, [jobId, resultsApi]);

  useEffect(() => {
    setState({ status: 'loading' });
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading result" className="page-skeleton">
        <span className="skeleton skeleton--eyebrow" />
        <span className="skeleton skeleton--title" />
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
      </div>
    );
  }

  if (state.status === 'not-found') {
    return (
      <ResultState
        action={
          <Link className="ui-button ui-button--primary" to="/jobs">
            Back to your jobs
          </Link>
        }
        title="This result is unavailable"
      >
        <p>
          The job may have been deleted, removed automatically after seven days, or it belongs to a
          different account. Results are never shown to anyone except the job owner.
        </p>
      </ResultState>
    );
  }

  if (state.status === 'not-ready') {
    return (
      <ResultState action={<BackToJob jobId={jobId} />} title="The result is not available yet">
        {state.jobStatus ? (
          <p className="result-state__status">
            Current status: <JobStatusBadge status={state.jobStatus} />
          </p>
        ) : null}
        <p>
          A result is shown only after the job has completed. Queued and running jobs show their
          progress on the job page; failed and cancelled jobs have no result.
        </p>
      </ResultState>
    );
  }

  if (state.status === 'gone') {
    return (
      <ResultState action={<BackToJob jobId={jobId} />} title="The result files are not available">
        <p>
          They were removed by the retention policy, or this job was produced before results were
          available. Submit a new run to get a result.
        </p>
      </ResultState>
    );
  }

  if (state.status === 'error') {
    return (
      <ResultState
        action={
          <Button disabled={refreshing} onClick={() => void load()} variant="secondary">
            {refreshing ? 'Trying again…' : 'Try again'}
          </Button>
        }
        title="This result could not be loaded"
      >
        <FeedbackMessage tone="error">
          The service did not respond or returned an unreadable result. No result is shown until it
          can be confirmed.
        </FeedbackMessage>
      </ResultState>
    );
  }

  const { result } = state;

  return (
    <section aria-labelledby="result-title" className="jobs-page result-page">
      <nav aria-label="Breadcrumb" className="job-detail__crumbs">
        <Link to="/jobs">Runs and jobs</Link>
        <span aria-hidden="true">/</span>
        <Link className="jobs-mono" to={`/jobs/${encodeURIComponent(jobId)}`}>
          {jobId}
        </Link>
        <span aria-hidden="true">/</span>
        <span>Result</span>
      </nav>

      <header className="job-detail__head">
        <div>
          <p className="eyebrow">{PIPELINE_NAMES[result.pipelineId]} result</p>
          <h1 id="result-title">{result.summary.runName || 'Result'}</h1>
        </div>
        <div className="job-detail__status">
          <p className="job-detail__updated" aria-live="polite">
            {state.stale ? (
              <strong>Could not refresh — showing the result from </strong>
            ) : (
              'Loaded '
            )}
            <time dateTime={state.loadedAt.toISOString()}>
              {formatDateTime(state.loadedAt.toISOString())}
            </time>
          </p>
          <Button disabled={refreshing} onClick={() => void load()} variant="secondary">
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {result.pipelineId === 'smart-checkup' ? (
        <SmartCheckupResult jobId={jobId} result={result} />
      ) : (
        <NextflowResult jobId={jobId} result={result} />
      )}
    </section>
  );
}

/** Keeps a loaded result visible (marked stale) when only a refresh fails. */
function nextStateForError(previous: PageState, error: unknown): PageState {
  if (error instanceof ApiRequestError) {
    if (error.status === 404) {
      return { status: 'not-found' };
    }

    if (error.status === 409) {
      const reported = error.details.find((detail) => detail.field === 'status')?.message;
      const jobStatus = JOB_STATUSES.find((candidate) => candidate === reported) ?? null;

      return { status: 'not-ready', jobStatus };
    }

    if (error.status === 410) {
      return { status: 'gone' };
    }
  }

  return previous.status === 'ready' ? { ...previous, stale: true } : { status: 'error' };
}

function BackToJob({ jobId }: { jobId: string }) {
  return (
    <Link className="ui-button ui-button--primary" to={`/jobs/${encodeURIComponent(jobId)}`}>
      Back to the job
    </Link>
  );
}

function ResultState({
  action,
  children,
  title,
}: {
  action: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section aria-labelledby="result-state-title" className="state-page">
      <svg aria-hidden="true" className="state-page__icon" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="18" />
        <path d="M24 15v11M24 32v1" />
      </svg>
      <h1 id="result-state-title">{title}</h1>
      {children}
      {action}
    </section>
  );
}
