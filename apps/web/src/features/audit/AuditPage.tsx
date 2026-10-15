import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import type { AuditEvent, AuditEventListResponse, AuditOutcome } from '@portal/shared';
import { AUDIT_EVENT_TYPES, AUDIT_OUTCOMES, AUDIT_RESOURCE_TYPES } from '@portal/shared/constants';

import { Button, FeedbackMessage, Input, Select } from '../../components/ui';
import { useAuth } from '../auth/authContext';

const PAGE_SIZE = 20;
const FILTER_KEYS = ['from', 'to', 'eventType', 'outcome', 'actorId', 'resourceType'] as const;

type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Record<FilterKey, string>;
type AuditPageData = AuditEventListResponse['data'];
type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: AuditPageData };

const ALL_OPTION = { label: 'All', value: '' };
const eventTypeOptions = [
  ALL_OPTION,
  ...AUDIT_EVENT_TYPES.map((value) => ({ label: humanize(value), value })),
];
const outcomeOptions = [
  ALL_OPTION,
  ...AUDIT_OUTCOMES.map((value) => ({ label: humanize(value), value })),
];
const resourceTypeOptions = [
  ALL_OPTION,
  ...AUDIT_RESOURCE_TYPES.map((value) => ({ label: humanize(value), value })),
];

export function AuditPage() {
  const { api } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedFilters = readFilters(searchParams);
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const [draft, setDraft] = useState<Filters>(appliedFilters);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const queryString = buildQuery(appliedFilters, page);

  const load = useCallback(async () => {
    setState({ status: 'loading' });

    try {
      const response = await api.get<AuditEventListResponse>(`/audit-events?${queryString}`);
      setState({ status: 'ready', data: response.data });
    } catch {
      setState({ status: 'error' });
    }
  }, [api, queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchParams(toSearchParams(draft, 1));
  }

  function resetFilters() {
    const empty = emptyFilters();
    setDraft(empty);
    setSearchParams(toSearchParams(empty, 1));
  }

  function goToPage(nextPage: number) {
    setSearchParams(toSearchParams(appliedFilters, nextPage));
  }

  return (
    <section className="audit-page" aria-labelledby="audit-title">
      <div className="audit-page__head">
        <p className="eyebrow">Security / Audit trail</p>
        <h1 id="audit-title">Audit events</h1>
        <p>
          Review sign-in, access and job activity. Entries are read-only, kept for 90 days and never
          include e-mail addresses, passwords or uploaded content.
        </p>
      </div>

      <form aria-label="Filter audit events" className="audit-filters" onSubmit={applyFilters}>
        <Input
          id="audit-from"
          label="From"
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          type="datetime-local"
          value={draft.from}
        />
        <Input
          id="audit-to"
          label="To"
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          type="datetime-local"
          value={draft.to}
        />
        <Select
          id="audit-event-type"
          label="Event"
          onChange={(event) => setDraft({ ...draft, eventType: event.target.value })}
          options={eventTypeOptions}
          value={draft.eventType}
        />
        <Select
          id="audit-outcome"
          label="Outcome"
          onChange={(event) => setDraft({ ...draft, outcome: event.target.value })}
          options={outcomeOptions}
          value={draft.outcome}
        />
        <Select
          id="audit-resource-type"
          label="Resource"
          onChange={(event) => setDraft({ ...draft, resourceType: event.target.value })}
          options={resourceTypeOptions}
          value={draft.resourceType}
        />
        <Input
          id="audit-actor"
          label="Actor ID"
          maxLength={128}
          onChange={(event) => setDraft({ ...draft, actorId: event.target.value.trim() })}
          placeholder="usr_…"
          value={draft.actorId}
        />
        <div className="audit-filters__actions">
          <Button type="submit">Apply filters</Button>
          <Button onClick={resetFilters} variant="ghost">
            Reset
          </Button>
        </div>
      </form>

      <AuditResults
        onPageChange={goToPage}
        onReset={resetFilters}
        onRetry={() => void load()}
        state={state}
      />
    </section>
  );
}

function AuditResults({
  onPageChange,
  onReset,
  onRetry,
  state,
}: {
  onPageChange: (page: number) => void;
  onReset: () => void;
  onRetry: () => void;
  state: LoadState;
}) {
  if (state.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading audit events" className="audit-skeleton">
        {Array.from({ length: 6 }, (_, index) => (
          <span className="skeleton skeleton--row" key={index} />
        ))}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="audit-state">
        <FeedbackMessage tone="error">Audit events could not be loaded.</FeedbackMessage>
        <Button onClick={onRetry} variant="secondary">
          Try again
        </Button>
      </div>
    );
  }

  const { items, limit, page, total } = state.data;

  if (items.length === 0) {
    return (
      <div className="audit-state audit-state--empty">
        <h2>No audit events match these filters</h2>
        <p>Widen the time range or reset the filters to see more activity.</p>
        <Button onClick={onReset} variant="secondary">
          Reset filters
        </Button>
      </div>
    );
  }

  const first = (page - 1) * limit + 1;
  const last = first + items.length - 1;
  const lastPage = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <p aria-live="polite" className="audit-summary">
        Showing {first}–{last} of {total} events
      </p>
      <div className="audit-table-wrap" role="region" aria-label="Audit events table" tabIndex={0}>
        <table className="audit-table">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Event</th>
              <th scope="col">Outcome</th>
              <th scope="col">Actor</th>
              <th scope="col">Resource</th>
              <th scope="col">Details</th>
              <th scope="col">Request ID</th>
            </tr>
          </thead>
          <tbody>
            {items.map((event) => (
              <AuditRow event={event} key={event.id} />
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="Audit pagination" className="audit-pagination">
        <Button disabled={page <= 1} onClick={() => onPageChange(page - 1)} variant="secondary">
          Previous
        </Button>
        <span>
          Page {page} of {lastPage}
        </span>
        <Button
          disabled={page >= lastPage}
          onClick={() => onPageChange(page + 1)}
          variant="secondary"
        >
          Next
        </Button>
      </nav>
    </>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  const details = Object.entries(event.metadata);

  return (
    <tr>
      <td>
        <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
      </td>
      <td>{humanize(event.eventType)}</td>
      <td>
        <OutcomeBadge outcome={event.outcome} />
      </td>
      <td className="audit-table__mono">{event.actorId ?? 'System / CLI'}</td>
      <td>
        <span>{humanize(event.resourceType)}</span>
        {event.resourceId ? (
          <span className="audit-table__mono audit-table__sub">{event.resourceId}</span>
        ) : null}
      </td>
      <td>
        {details.length > 0 ? (
          <dl className="audit-details">
            {details.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <span className="audit-table__muted">—</span>
        )}
      </td>
      <td className="audit-table__mono audit-table__muted">{event.requestId}</td>
    </tr>
  );
}

function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  return (
    <span className={`ui-status audit-outcome audit-outcome--${outcome.toLowerCase()}`}>
      <svg aria-hidden="true" className="ui-status__icon" viewBox="0 0 24 24">
        {outcome === 'SUCCESS' ? <path d="m5 12 4 4L19 6" /> : null}
        {outcome === 'DENIED' ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M6 18 18 6" />
          </>
        ) : null}
        {outcome === 'FAILURE' ? <path d="M6 6l12 12M18 6 6 18" /> : null}
      </svg>
      <span>{humanize(outcome)}</span>
    </span>
  );
}

function emptyFilters(): Filters {
  return { from: '', to: '', eventType: '', outcome: '', actorId: '', resourceType: '' };
}

function readFilters(params: URLSearchParams): Filters {
  const filters = emptyFilters();

  for (const key of FILTER_KEYS) {
    filters[key] = params.get(key) ?? '';
  }

  return filters;
}

function toSearchParams(filters: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams();

  for (const key of FILTER_KEYS) {
    if (filters[key]) {
      params.set(key, filters[key]);
    }
  }

  if (page > 1) {
    params.set('page', String(page));
  }

  return params;
}

/** Converts URL filters (local datetime) into the API query (ISO-8601 UTC). */
function buildQuery(filters: Filters, page: number): string {
  const params = new URLSearchParams();

  for (const key of FILTER_KEYS) {
    const value = filters[key];

    if (!value) {
      continue;
    }

    if (key === 'from' || key === 'to') {
      const timestamp = new Date(value);

      if (!Number.isNaN(timestamp.getTime())) {
        params.set(key, timestamp.toISOString());
      }

      continue;
    }

    params.set(key, value);
  }

  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));

  return params.toString();
}

function humanize(value: string): string {
  const words = value.toLowerCase().split('_');

  return words
    .map((word, index) => (index === 0 ? word[0]?.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(String).join(', ');
  }

  if (value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}
