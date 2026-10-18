import { useEffect, useRef } from 'react';

import { FeedbackMessage } from '../../components/ui';
import { ARTIFACT_MOCK_NOTE } from './resultsApi';

type ReportViewerProps = {
  /** Shown as the frame title and heading. */
  name: string;
  /** Sandboxed view URL, or `null` in mock mode (no file is ever served). */
  src: string | null;
  onClose: () => void;
};

/**
 * Inline viewer for an allowlisted HTML report (design C8, US-009 AC5). The frame is sandboxed
 * with `allow-scripts` only, so the report runs in an opaque origin: no app cookies, DOM or API,
 * and the server CSP blocks any network request. Never add `allow-same-origin`.
 */
export function ReportViewer({ name, onClose, src }: ReportViewerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <section aria-label={`Report viewer: ${name}`} className="report-viewer">
      <div className="report-viewer__head">
        <p>
          Viewing <code>{name}</code>
        </p>
        <button
          className="ui-button ui-button--secondary"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          Close report
        </button>
      </div>
      {src === null ? (
        <FeedbackMessage tone="info">{ARTIFACT_MOCK_NOTE}</FeedbackMessage>
      ) : (
        <>
          <iframe
            className="report-viewer__frame"
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts"
            src={src}
            title={name}
          />
          <p className="report-viewer__note">
            The report runs in an isolated frame without access to this site or the network.
          </p>
        </>
      )}
    </section>
  );
}
