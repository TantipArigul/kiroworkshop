import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import type { PipelineSummary } from '@portal/shared';

import { Button, FeedbackMessage } from '../../components/ui';
import { useAuth } from '../auth/authContext';
import { createPipelinesApi, LAYOUT_LABELS, unavailableMessage } from './pipelinesApi';

type CatalogState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: PipelineSummary[] };

/** US-016: every registry pipeline with its version, accepted input and availability. */
export function PipelinesPage() {
  const { api } = useAuth();
  const pipelinesApi = useMemo(() => createPipelinesApi(api), [api]);
  const [state, setState] = useState<CatalogState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });

    try {
      setState({ status: 'ready', items: (await pipelinesApi.list()).items });
    } catch {
      setState({ status: 'error' });
    }
  }, [pipelinesApi]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="pipelines-title" className="jobs-page">
      <div className="jobs-page__head">
        <div>
          <p className="eyebrow">Workspace / Pipelines</p>
          <h1 id="pipelines-title">Pipelines</h1>
          <p>
            Choose the analysis to run. Each pipeline is pinned to a reviewed version and runs on
            this server only.
          </p>
        </div>
      </div>

      <CatalogContent onRetry={() => void load()} state={state} />
    </section>
  );
}

function CatalogContent({ onRetry, state }: { onRetry: () => void; state: CatalogState }) {
  if (state.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading pipelines" className="pipeline-grid">
        {Array.from({ length: 2 }, (_, index) => (
          <div className="pipeline-card pipeline-card--skeleton" key={index}>
            <span className="skeleton skeleton--eyebrow" />
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--row" />
            <span className="skeleton skeleton--short" />
          </div>
        ))}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="jobs-state">
        <FeedbackMessage tone="error">
          The pipeline catalog could not be loaded. Check your connection and try again.
        </FeedbackMessage>
        <Button onClick={onRetry} variant="secondary">
          Try again
        </Button>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div className="jobs-state jobs-state--empty">
        <h2>No pipelines are listed</h2>
        <p>No pipeline is configured on this server. Ask an administrator to check the setup.</p>
      </div>
    );
  }

  return (
    <ul aria-label="Available pipelines" className="pipeline-grid">
      {state.items.map((pipeline) => (
        <li key={pipeline.id}>
          <PipelineCard pipeline={pipeline} />
        </li>
      ))}
    </ul>
  );
}

function PipelineCard({ pipeline }: { pipeline: PipelineSummary }) {
  const titleId = `pipeline-${pipeline.id}-title`;
  const reasonId = `pipeline-${pipeline.id}-reason`;
  const inputs =
    pipeline.inputLayouts.length > 0
      ? pipeline.inputLayouts.map((layout) => LAYOUT_LABELS[layout])
      : ['Synthetic marker CSV'];

  return (
    <article
      aria-labelledby={titleId}
      className={`pipeline-card${pipeline.available ? '' : ' pipeline-card--unavailable'}`}
    >
      <div className="pipeline-card__head">
        <p className="pipeline-card__meta">
          <span>{pipeline.executor === 'nextflow' ? 'Nextflow' : 'Simulated'}</span>
          <span aria-hidden="true">·</span>
          <span>
            Version <code>{pipeline.version}</code>
          </span>
        </p>
        <h2 id={titleId}>{pipeline.name}</h2>
      </div>
      <p className="pipeline-card__description">{pipeline.description}</p>
      <div className="pipeline-card__inputs">
        <h3>Accepted input</h3>
        <ul>
          {inputs.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </div>
      {pipeline.available ? (
        <Link
          aria-describedby={titleId}
          className="ui-button ui-button--primary pipeline-card__action"
          to={`/pipelines/${pipeline.id}/run`}
        >
          Run
        </Link>
      ) : (
        <div className="pipeline-card__unavailable">
          <UnavailableBadge />
          <p id={reasonId}>
            {unavailableMessage(pipeline.unavailableReason)} Runs cannot be started until it is
            ready.
          </p>
          <Button aria-describedby={reasonId} className="pipeline-card__action" disabled>
            Run
          </Button>
        </div>
      )}
    </article>
  );
}

/** Label + icon + colour (never colour alone). */
export function UnavailableBadge() {
  return (
    <span className="pipeline-badge pipeline-badge--unavailable">
      <svg aria-hidden="true" className="ui-status__icon" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6M12 16.5v.5" />
      </svg>
      <span>Unavailable</span>
    </span>
  );
}
