import { Link } from 'react-router';

import type { ResultReference } from '@portal/shared';

export const HEALTH_QUESTIONS_NOTE = 'For health questions, consult a qualified professional.';

/**
 * References + closing disclaimer of a result page (design C8, D3-8). In-app paths use the
 * router; external `https://` links open in a new tab without opener or referrer.
 */
export function ResultReferences({ references }: { references: ResultReference[] }) {
  return (
    <section aria-labelledby="result-references-title" className="ui-card result-section">
      <h2 id="result-references-title">References and limits</h2>
      {references.length > 0 ? (
        <ul className="result-references">
          {references.map((reference) => (
            <li key={reference.href}>
              {reference.href.startsWith('/') ? (
                <Link to={reference.href}>{reference.label}</Link>
              ) : (
                <a href={reference.href} rel="noopener noreferrer" target="_blank">
                  {reference.label}
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="result-empty">No references are listed for this result.</p>
      )}
      <div className="result-disclaimer" role="note">
        <svg aria-hidden="true" className="result-disclaimer__icon" viewBox="0 0 24 24">
          <path d="M12 3 2 20h20L12 3Z" />
          <path d="M12 10v4M12 17v.5" />
        </svg>
        <p>
          <strong>Training output only. Not a medical diagnosis or treatment advice.</strong>{' '}
          {HEALTH_QUESTIONS_NOTE}
        </p>
      </div>
    </section>
  );
}

/** Label/value pairs of the summary card. */
export function SummaryFacts({ facts }: { facts: { label: string; value: string }[] }) {
  return (
    <dl className="result-facts">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
