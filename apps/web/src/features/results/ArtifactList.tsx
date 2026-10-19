import { Fragment, useRef, useState } from 'react';

import type { ResultArtifact, ResultArtifactCategory } from '@portal/shared';

import { formatBytes } from '../jobs/jobsApi';
import { ReportViewer } from './ReportViewer';
import { ARTIFACT_FILES_AVAILABLE, ARTIFACT_MOCK_NOTE, downloadUrl, viewUrl } from './resultsApi';

const CATEGORY_ORDER: readonly ResultArtifactCategory[] = [
  'RESULT',
  'READS',
  'STATS',
  'REPORT',
  'OTHER',
];

const CATEGORY_LABELS: Record<ResultArtifactCategory, string> = {
  RESULT: 'Result',
  READS: 'Reads',
  STATS: 'Statistics',
  REPORT: 'Reports',
  OTHER: 'Other files',
};

/**
 * Files of a completed job grouped by category (design C8, US-011). Download is a same-origin
 * attachment link; allowlisted HTML reports can also be viewed inline in the sandboxed
 * `ReportViewer` or opened in a new tab. Mock mode never links to files.
 */
export function ArtifactList({ artifacts, jobId }: { artifacts: ResultArtifact[]; jobId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const viewButtons = useRef(new Map<string, HTMLButtonElement>());

  function closeViewer() {
    const id = openId;

    setOpenId(null);

    if (id) {
      viewButtons.current.get(id)?.focus();
    }
  }

  if (artifacts.length === 0) {
    return <p className="result-empty">No files were recorded for this job.</p>;
  }

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: artifacts.filter((artifact) => artifact.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="artifact-groups">
      {!ARTIFACT_FILES_AVAILABLE ? (
        <p className="artifact-mock-note">
          Downloads and report views: {ARTIFACT_MOCK_NOTE.toLowerCase()}.
        </p>
      ) : null}
      {groups.map((group) => (
        <section aria-labelledby={`artifacts-${group.category}`} key={group.category}>
          <h3 id={`artifacts-${group.category}`}>
            {CATEGORY_LABELS[group.category]} ({group.items.length})
          </h3>
          <ul className="artifact-list">
            {group.items.map((artifact) => (
              <Fragment key={artifact.id}>
                <li className="artifact-item">
                  <div className="artifact-item__info">
                    <code>{artifact.displayName}</code>
                    <span>{formatBytes(artifact.sizeBytes)}</span>
                    {!artifact.viewable && artifact.viewNote ? (
                      <span className="artifact-item__note">{artifact.viewNote}</span>
                    ) : null}
                  </div>
                  <div className="artifact-item__actions">
                    {artifact.viewable ? (
                      <button
                        aria-expanded={openId === artifact.id}
                        className="ui-button ui-button--secondary"
                        onClick={() => setOpenId(openId === artifact.id ? null : artifact.id)}
                        ref={(element) => {
                          if (element) {
                            viewButtons.current.set(artifact.id, element);
                          } else {
                            viewButtons.current.delete(artifact.id);
                          }
                        }}
                        type="button"
                      >
                        View<span className="visually-hidden"> {artifact.displayName}</span>
                      </button>
                    ) : null}
                    {ARTIFACT_FILES_AVAILABLE ? (
                      <>
                        {artifact.viewable ? (
                          <a
                            className="ui-button ui-button--ghost"
                            href={viewUrl(jobId, artifact)}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            Open in new tab
                            <span className="visually-hidden">
                              {' '}
                              {artifact.displayName} (opens in a new tab)
                            </span>
                          </a>
                        ) : null}
                        <a
                          className="ui-button ui-button--primary"
                          download
                          href={downloadUrl(jobId, artifact)}
                        >
                          Download<span className="visually-hidden"> {artifact.displayName}</span>
                        </a>
                      </>
                    ) : null}
                  </div>
                </li>
                {openId === artifact.id ? (
                  <li className="artifact-item artifact-item--viewer">
                    <ReportViewer
                      name={artifact.displayName}
                      onClose={closeViewer}
                      src={ARTIFACT_FILES_AVAILABLE ? viewUrl(jobId, artifact) : null}
                    />
                  </li>
                ) : null}
              </Fragment>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
