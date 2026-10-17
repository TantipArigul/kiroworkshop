import { useCallback, useEffect, useRef, useState } from 'react';

import type { JobDetail, JobStatus } from '@portal/shared';
import { ACTIVE_JOB_STATUSES, JOB_POLL_INTERVAL_MS } from '@portal/shared/constants';

import { ApiRequestError } from '../auth/apiClient';
import type { JobsApi } from './jobsApi';

export type JobLoadState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error' }
  | {
      status: 'ready';
      job: JobDetail;
      /** When the shown data was last confirmed by the API. */
      lastUpdated: Date;
      /** The most recent refresh failed, so the shown data may be out of date. */
      stale: boolean;
      refreshing: boolean;
    };

/** Polling continues only while the job can still change and the page is visible (D3-11). */
export function shouldPoll(status: JobStatus, documentHidden: boolean): boolean {
  return !documentHidden && (ACTIVE_JOB_STATUSES as readonly JobStatus[]).includes(status);
}

export function useJobPolling(jobsApi: JobsApi, jobId: string) {
  const [state, setState] = useState<JobLoadState>({ status: 'loading' });
  const [hidden, setHidden] = useState(() => document.hidden);
  const requestCounter = useRef(0);

  const refresh = useCallback(async () => {
    const requestNumber = ++requestCounter.current;
    setState((current) =>
      current.status === 'ready' ? { ...current, refreshing: true } : current,
    );

    try {
      const job = await jobsApi.get(jobId);

      if (requestNumber === requestCounter.current) {
        setState({
          status: 'ready',
          job,
          lastUpdated: new Date(),
          stale: false,
          refreshing: false,
        });
      }
    } catch (error) {
      if (requestNumber !== requestCounter.current) {
        return;
      }

      if (error instanceof ApiRequestError && error.status === 404) {
        setState({ status: 'unavailable' });
        return;
      }

      // Keep the last confirmed data but label it, instead of presenting it as current.
      setState((current) =>
        current.status === 'ready'
          ? { ...current, stale: true, refreshing: false }
          : { status: 'error' },
      );
    }
  }, [jobsApi, jobId]);

  useEffect(() => {
    setState({ status: 'loading' });
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onVisibilityChange = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const currentStatus = state.status === 'ready' ? state.job.status : null;

  useEffect(() => {
    if (!currentStatus || !shouldPoll(currentStatus, hidden)) {
      return;
    }

    const timer = window.setInterval(() => void refresh(), JOB_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [currentStatus, hidden, refresh]);

  return { state, refresh, polling: Boolean(currentStatus && shouldPoll(currentStatus, hidden)) };
}
