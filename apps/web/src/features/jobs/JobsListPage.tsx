import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import type { JobList } from '@portal/shared';
import { JOB_POLL_INTERVAL_MS } from '@portal/shared/constants';

import { Button, FeedbackMessage } from '../../components/ui';
import { useAuth } from '../auth/authContext';
import { JobProgress } from './JobProgress';
import { JobStatusBadge } from './JobStatusBadge';
import { createJobsApi, formatDateTime, shortJobId } from './jobsApi';
import { shouldPoll } from './useJobPolling';

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      data: JobList;
      loadedAt: Date;
      /** The latest background refresh failed; the table shows the last confirmed data. */
      stale: boolean;
    };

/** US-020 overview: the owner's runs with pipeline, status, queue position and progress. */
export function JobsListPage() {
  const { api } = useAuth();
  const jobsApi = useMemo(() => createJobsApi(api), [api]);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [hidden, setHidden] = useState(() => document.hidden);
  const requestCounter = useRef(0);
  const deletedJobId = (location.state as { deletedJobId?: string } | null)?.deletedJobId;

  const load = useCallback(
    async (background = false) => {
      const requestNumber = ++requestCounter.current;

      if (!background) {
        setState({ status: 'loading' });
      }

      try {
        const data = await jobsApi.list(page);

        if (requestNumber === requestCounter.current) {
          setState({ status: 'ready', data, loadedAt: new Date(), stale: false });
        }
      } catch {
        if (requestNumber !== requestCounter.current) {
          return;
        }

        // A failed background refresh keeps the last confirmed list, labelled as such.
        setState((current) =>
          background && current.status === 'ready'
            ? { ...current, stale: true }
            : { status: 'error' },
        );
      }
    },
    [jobsApi, page],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVisibilityChange = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Poll only while a job shown on this page can still change and the tab is visible.
  const polling =
    state.status === 'ready' && state.data.items.some((job) => shouldPoll(job.status, hidden));

  useEffect(() => {
    if (!polling) {
      return;
    }

    const timer = window.setInterval(() => void load(true), JOB_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [load, polling]);

  return (
    <section aria-labelledby="jobs-title" className="jobs-page">
      <div className="jobs-page__head">
        <div>
          <p className="eyebrow">Workspace / Overview</p>
          <h1 id="jobs-title">Runs and jobs</h1>
          <p>
            Your runs across all pipelines, newest activity first. Only you can see them; each is
            deleted automatically seven days after submission.
          </p>
        </div>
        <Link className="ui-button ui-button--primary" to="/pipelines">
          New run
        </Link>
      </div>

      {deletedJobId ? (
        <FeedbackMessage tone="success">
          Job <span className="jobs-mono">{deletedJobId}</span> and its input and results were
          deleted.
        </FeedbackMessage>
      ) : null}

      <JobsListContent
        onPageChange={(next) => setSearchParams(next > 1 ? { page: String(next) } : {})}
        onRetry={() => void load()}
        polling={polling}
        state={state}
      />
    </section>
  );
}

function JobsListContent({
  onPageChange,
  onRetry,
  polling,
  state,
}: {
  onPageChange: (page: number) => void;
  onRetry: () => void;
  polling: boolean;
  state: ListState;
}) {
  if (state.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading jobs" className="jobs-skeleton">
        {Array.from({ length: 4 }, (_, index) => (
          <span className="skeleton skeleton--row" key={index} />
        ))}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="jobs-state">
        <FeedbackMessage tone="error">
          Your jobs could not be loaded, so no list is shown. Check your connection and try again.
        </FeedbackMessage>
        <Button onClick={onRetry} variant="secondary">
          Try again
        </Button>
      </div>
    );
  }

  const { items, limit, page, total } = state.data;

  if (total === 0) {
    return (
      <div className="jobs-state jobs-state--empty">
        <svg aria-hidden="true" className="state-page__icon" viewBox="0 0 48 48">
          <path d="M10 14h28M10 24h20M10 34h12" />
          <circle cx="36" cy="34" r="6" />
        </svg>
        <h2>No runs yet</h2>
        <p>
          Choose a pipeline to start your first run. The Smart Checkup sample shows the expected
          input format without any upload.
        </p>
        <div className="jobs-state__actions">
          <Link className="ui-button ui-button--primary" to="/pipelines">
            Browse pipelines
          </Link>
          <Link
            className="ui-button ui-button--secondary"
            to="/pipelines/smart-checkup/run?sample=1"
          >
            Try the Smart Checkup sample
          </Link>
        </div>
      </div>
    );
  }

  const lastPage = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <div className="jobs-toolbar">
        {/* Announce only a failed refresh; the time stamp changes on every poll. */}
        <p aria-live="polite" className="visually-hidden">
          {state.stale ? 'The job list could not be refreshed and may be out of date.' : ''}
        </p>
        <p className="jobs-summary">
          {total} job{total === 1 ? '' : 's'} ·{' '}
          {state.stale ? <strong>could not refresh — showing data from </strong> : 'last updated '}
          <time dateTime={state.loadedAt.toISOString()}>
            {formatDateTime(state.loadedAt.toISOString())}
          </time>
          {polling && !state.stale ? ' · refreshing automatically' : null}
        </p>
        <Button onClick={onRetry} variant="ghost">
          Refresh
        </Button>
      </div>
      <div aria-label="Jobs table" className="jobs-table-wrap" role="region" tabIndex={0}>
        <table className="jobs-table">
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Pipeline</th>
              <th scope="col">Status</th>
              <th scope="col">Queue / progress</th>
              <th scope="col">Created</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((job) => (
              <tr key={job.id}>
                <td>
                  <Link className="jobs-table__link" to={`/jobs/${job.id}`}>
                    {job.runName || job.sampleLabel}
                  </Link>
                  <span className="jobs-mono jobs-table__sub" title={job.id}>
                    <span className="visually-hidden">Job ID ending </span>
                    {shortJobId(job.id)}
                  </span>
                </td>
                <td>{job.pipelineName}</td>
                <td>
                  <JobStatusBadge status={job.status} />
                </td>
                <td>
                  <JobProgress
                    progress={job.progress}
                    queuePosition={job.queuePosition}
                    status={job.status}
                  />
                </td>
                <td>
                  <time dateTime={job.createdAt}>{formatDateTime(job.createdAt)}</time>
                </td>
                <td>
                  <time dateTime={job.updatedAt}>{formatDateTime(job.updatedAt)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lastPage > 1 ? (
        <nav aria-label="Jobs pagination" className="jobs-pagination">
          <Button disabled={page <= 1} onClick={() => onPageChange(page - 1)} variant="secondary">
            Previous
          </Button>
          <span>
            Page {page} of {lastPage}
          </span>
          <Button
            disabled={page >= lastPage}
            onClick={() => onPageChange(page + 1)}
            variant="secondary"
          >
            Next
          </Button>
        </nav>
      ) : null}
    </>
  );
}
