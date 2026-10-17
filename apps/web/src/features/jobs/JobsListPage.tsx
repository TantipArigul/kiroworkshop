import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import type { JobList } from '@portal/shared';

import { Button, FeedbackMessage } from '../../components/ui';
import { useAuth } from '../auth/authContext';
import { JobStatusBadge } from './JobStatusBadge';
import { createJobsApi, formatDateTime } from './jobsApi';

type ListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: JobList; loadedAt: Date };

export function JobsListPage() {
  const { api } = useAuth();
  const jobsApi = useMemo(() => createJobsApi(api), [api]);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const deletedJobId = (location.state as { deletedJobId?: string } | null)?.deletedJobId;

  const load = useCallback(async () => {
    setState({ status: 'loading' });

    try {
      setState({ status: 'ready', data: await jobsApi.list(page), loadedAt: new Date() });
    } catch {
      setState({ status: 'error' });
    }
  }, [jobsApi, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="jobs-title" className="jobs-page">
      <div className="jobs-page__head">
        <div>
          <p className="eyebrow">Workspace / Jobs</p>
          <h1 id="jobs-title">Analysis jobs</h1>
          <p>
            Your submitted analyses, newest activity first. Only you can see these jobs; each is
            deleted automatically seven days after submission.
          </p>
        </div>
        <Link className="ui-button ui-button--primary" to="/jobs/new">
          New analysis
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
        state={state}
      />
    </section>
  );
}

function JobsListContent({
  onPageChange,
  onRetry,
  state,
}: {
  onPageChange: (page: number) => void;
  onRetry: () => void;
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
        <h2>No jobs yet</h2>
        <p>
          Start with the authored sample to see the expected input format, or upload your own
          synthetic CSV.
        </p>
        <div className="jobs-state__actions">
          <Link className="ui-button ui-button--primary" to="/jobs/new?sample=1">
            Load sample data
          </Link>
          <Link className="ui-button ui-button--secondary" to="/jobs/new">
            Submit a job
          </Link>
        </div>
      </div>
    );
  }

  const lastPage = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <div className="jobs-toolbar">
        <p aria-live="polite" className="jobs-summary">
          {total} job{total === 1 ? '' : 's'} · last updated{' '}
          <time dateTime={state.loadedAt.toISOString()}>
            {formatDateTime(state.loadedAt.toISOString())}
          </time>
        </p>
        <Button onClick={onRetry} variant="ghost">
          Refresh
        </Button>
      </div>
      <div aria-label="Jobs table" className="jobs-table-wrap" role="region" tabIndex={0}>
        <table className="jobs-table">
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col">Status</th>
              <th scope="col">Submitted</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((job) => (
              <tr key={job.id}>
                <td>
                  <Link className="jobs-table__link" to={`/jobs/${job.id}`}>
                    {job.sampleLabel}
                  </Link>
                  <span className="jobs-mono jobs-table__sub">{job.id}</span>
                </td>
                <td>
                  <JobStatusBadge status={job.status} />
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
