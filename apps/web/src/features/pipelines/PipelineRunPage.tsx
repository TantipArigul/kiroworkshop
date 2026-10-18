import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import type { PipelineDetail } from '@portal/shared';

import { Button, FeedbackMessage } from '../../components/ui';
import { ApiRequestError } from '../auth/apiClient';
import { useAuth } from '../auth/authContext';
import { NewJobPage } from '../jobs/NewJobPage';
import { UnavailableBadge } from './PipelinesPage';
import { createPipelinesApi, unavailableMessage } from './pipelinesApi';
import { RenameFastqRunPage } from './RenameFastqRunPage';

type DetailState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; pipeline: PipelineDetail };

/** `/pipelines/:pipelineId/run` — picks the launch form of the requested registry pipeline. */
export function PipelineRunPage() {
  const { pipelineId = '' } = useParams();
  const { api } = useAuth();
  const pipelinesApi = useMemo(() => createPipelinesApi(api), [api]);
  const [state, setState] = useState<DetailState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });

    try {
      setState({ status: 'ready', pipeline: await pipelinesApi.get(pipelineId) });
    } catch (error) {
      setState(
        error instanceof ApiRequestError && error.status === 404
          ? { status: 'not-found' }
          : { status: 'error' },
      );
    }
  }, [pipelinesApi, pipelineId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading pipeline" className="page-skeleton">
        <span className="skeleton skeleton--eyebrow" />
        <span className="skeleton skeleton--title" />
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
      </div>
    );
  }

  if (state.status === 'not-found') {
    return (
      <section aria-labelledby="pipeline-missing-title" className="state-page">
        <svg aria-hidden="true" className="state-page__icon" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="18" />
          <path d="M24 15v11M24 32v1" />
        </svg>
        <h1 id="pipeline-missing-title">Pipeline not found</h1>
        <p>This pipeline is not in the catalog. Choose one of the listed pipelines instead.</p>
        <Link className="ui-button ui-button--primary" to="/pipelines">
          Back to pipelines
        </Link>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section aria-labelledby="pipeline-error-title" className="state-page">
        <h1 id="pipeline-error-title">This pipeline could not be loaded</h1>
        <FeedbackMessage tone="error">
          The service did not respond. Check your connection and try again.
        </FeedbackMessage>
        <Button onClick={() => void load()} variant="secondary">
          Try again
        </Button>
      </section>
    );
  }

  const { pipeline } = state;

  if (!pipeline.available) {
    return (
      <section aria-labelledby="pipeline-unavailable-title" className="state-page">
        <UnavailableBadge />
        <h1 id="pipeline-unavailable-title">{pipeline.name} is unavailable</h1>
        <p>
          {unavailableMessage(pipeline.unavailableReason)} Runs cannot be started until it is ready.
        </p>
        <div className="jobs-state__actions">
          <Button onClick={() => void load()} variant="secondary">
            Check again
          </Button>
          <Link className="ui-button ui-button--ghost" to="/pipelines">
            Back to pipelines
          </Link>
        </div>
      </section>
    );
  }

  // Smart Checkup keeps its original form (POST /jobs); wf-renamefastq uses the upload form.
  return pipeline.id === 'wf-renamefastq' ? (
    <RenameFastqRunPage pipeline={pipeline} />
  ) : (
    <NewJobPage />
  );
}
