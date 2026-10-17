import type { JobStatus } from '@portal/shared';

import { StatusBadge } from '../../components/ui';

/** Maps the API status to the shared label + icon + colour badge (never colour alone). */
export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <StatusBadge status={status.toLowerCase() as Lowercase<JobStatus>} />;
}
