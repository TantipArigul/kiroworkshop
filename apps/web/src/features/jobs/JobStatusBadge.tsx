import type { JobStatus } from '@portal/shared';

import { StatusBadge } from '../../components/ui';
import type { Status } from '../../components/ui/Status';

const BADGE_STATUS: Record<JobStatus, Status> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/** Maps the API status to the shared label + icon + colour badge (never colour alone). */
export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <StatusBadge status={BADGE_STATUS[status]} />;
}
