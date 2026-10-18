import type { JobSummary } from '@portal/shared';

import { formatElapsed } from './jobsApi';

type JobProgressProps = Pick<JobSummary, 'progress' | 'queuePosition' | 'status'> & {
  /** `compact` for table cells, `full` for the job detail page. */
  variant?: 'compact' | 'full';
};

/**
 * Queue position while QUEUED and completed steps / current step / elapsed time while RUNNING
 * (US-020 AC2–AC3). Never shows an estimated percentage.
 */
export function JobProgress({
  progress,
  queuePosition,
  status,
  variant = 'compact',
}: JobProgressProps) {
  if (status === 'QUEUED') {
    return (
      <span className="job-progress">
        {queuePosition ? (
          <>
            <strong>Position {queuePosition}</strong> in the queue
          </>
        ) : (
          'Waiting to start'
        )}
      </span>
    );
  }

  if (status === 'RUNNING') {
    if (!progress) {
      return <span className="job-progress">In progress</span>;
    }

    const steps = `${progress.completedSteps} step${progress.completedSteps === 1 ? '' : 's'} done`;

    return (
      <span className={`job-progress job-progress--${variant}`}>
        <span>
          <strong>{steps}</strong>
        </span>
        {progress.currentStep ? (
          <span>
            Now: <code>{progress.currentStep}</code>
          </span>
        ) : null}
        {progress.startedAt ? <span>{formatElapsed(progress.startedAt)} elapsed</span> : null}
      </span>
    );
  }

  return (
    <span className="job-progress job-progress--none">
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">Finished</span>
    </span>
  );
}
