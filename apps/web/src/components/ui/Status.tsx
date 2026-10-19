export type Status = 'cancelled' | 'completed' | 'failed' | 'queued' | 'running';

type StatusProps = {
  status: Status;
};

const statusLabels: Record<Status, string> = {
  cancelled: 'Cancelled',
  completed: 'Completed',
  failed: 'Failed',
  queued: 'Queued',
  running: 'Running',
};

export function StatusBadge({ status }: StatusProps) {
  return (
    <span className={`ui-status ui-status--${status}`}>
      <StatusIcon status={status} />
      <span>{statusLabels[status]}</span>
    </span>
  );
}

function StatusIcon({ status }: StatusProps) {
  if (status === 'completed') {
    return (
      <svg aria-hidden="true" className="ui-status__icon" viewBox="0 0 24 24">
        <path d="m5 12 4 4L19 6" />
      </svg>
    );
  }

  if (status === 'failed') {
    return (
      <svg aria-hidden="true" className="ui-status__icon" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    );
  }

  if (status === 'running') {
    return (
      <svg aria-hidden="true" className="ui-status__icon" viewBox="0 0 24 24">
        <path d="M12 3v9l6 3" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    );
  }

  if (status === 'cancelled') {
    // Circle with a diagonal bar: "stopped", distinct from the failed cross.
    return (
      <svg aria-hidden="true" className="ui-status__icon" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="m5.6 5.6 12.8 12.8" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="ui-status__icon" viewBox="0 0 24 24">
      <path d="M4 12h16" />
      <path d="M12 4v16" />
    </svg>
  );
}
