import { formatBytes } from '../jobs/jobsApi';

const ANNOUNCE_STEP_PERCENT = 10;

/**
 * Upload progress (US-017 AC6): a native `<progress>` plus a polite live region that is only
 * updated in 10 % steps so screen readers are not flooded.
 */
export function UploadProgress({ loaded, total }: { loaded: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const announced = Math.floor(percent / ANNOUNCE_STEP_PERCENT) * ANNOUNCE_STEP_PERCENT;
  const done = total > 0 && loaded >= total;

  return (
    <div className="upload-progress">
      <label className="upload-progress__label" htmlFor="run-upload-progress">
        {done ? 'Upload complete — starting the run…' : 'Uploading files'}
      </label>
      <progress id="run-upload-progress" max={total > 0 ? total : 1} value={total > 0 ? loaded : 0}>
        {percent}%
      </progress>
      <p aria-hidden="true" className="upload-progress__detail">
        {total > 0
          ? `${formatBytes(loaded)} of ${formatBytes(total)} (${percent}%)`
          : 'Preparing the upload…'}
      </p>
      <p aria-live="polite" className="visually-hidden">
        {done ? 'Upload complete. Starting the run.' : `Upload ${announced}% complete.`}
      </p>
    </div>
  );
}
