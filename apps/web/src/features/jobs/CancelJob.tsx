import { useMemo, useRef, useState } from 'react';

import { Button, FeedbackMessage } from '../../components/ui';
import { ApiRequestError } from '../auth/apiClient';
import { useAuth } from '../auth/authContext';
import { createJobsApi } from './jobsApi';

/**
 * US-021: cancel a QUEUED/RUNNING job after a `<dialog>` confirmation. The record, input and
 * history are kept; the caller refreshes the job afterwards to show the `CANCELLED` outcome.
 */
export function CancelJob({
  jobId,
  onSettled,
}: {
  jobId: string;
  /** Called after the request settles with an optional notice for the page to show. */
  onSettled: (notice: string | null) => void;
}) {
  const { api } = useAuth();
  const jobsApi = useMemo(() => createJobsApi(api), [api]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    dialogRef.current?.showModal();
  }

  async function confirmCancel() {
    setCancelling(true);
    setError(null);

    try {
      await jobsApi.cancel(jobId);
      dialogRef.current?.close();
      onSettled('The run was cancelled. Its record, input and history are kept.');
    } catch (caught) {
      if (caught instanceof ApiRequestError && (caught.status === 409 || caught.status === 404)) {
        // Finished (or removed) in the meantime: show the current state instead of an error.
        dialogRef.current?.close();
        onSettled(
          caught.status === 409 ? 'This job had already finished, so it was not cancelled.' : null,
        );
        return;
      }

      setError('The job could not be cancelled and its status did not change. Try again.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <section aria-labelledby="job-cancel-title" className="job-cancel">
      <div>
        <h2 id="job-cancel-title">Cancel this run</h2>
        <p>Stops the job now. Its record, input and history are kept until automatic deletion.</p>
      </div>
      <Button onClick={openDialog} variant="secondary">
        Cancel run
      </Button>
      <dialog aria-labelledby="job-cancel-dialog-title" className="job-dialog" ref={dialogRef}>
        <h2 id="job-cancel-dialog-title">Cancel this run?</h2>
        <p>
          The job <span className="jobs-mono">{jobId}</span> stops and is marked Cancelled. It
          cannot be resumed; submit a new run if you need the result. You can still delete the job
          afterwards.
        </p>
        {error ? <FeedbackMessage tone="error">{error}</FeedbackMessage> : null}
        <div className="job-dialog__actions">
          <Button disabled={cancelling} onClick={() => dialogRef.current?.close()} variant="ghost">
            Keep running
          </Button>
          <Button
            className="ui-button--danger"
            disabled={cancelling}
            onClick={() => void confirmCancel()}
          >
            {cancelling ? 'Cancelling…' : 'Cancel run'}
          </Button>
        </div>
      </dialog>
    </section>
  );
}
