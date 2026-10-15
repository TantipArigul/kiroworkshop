import type { AuditEvent, AuthenticatedUser } from '@portal/shared';

import type { Transport, TransportResponse } from '../features/auth/apiClient';
import auditFixture from './audit-events.json';
import accountFixture from './me.json';

/**
 * Wave 2 mock adapter (VITE_API_MOCK=true). Holds a fake session in memory only, accepts any
 * password for the synthetic accounts in me.json and never stores or echoes passwords.
 */
const MOCK_LATENCY_MS = 350;
const MOCK_CSRF_TOKEN = 'mock-csrf-token-for-ui-review-only';
const MIN_PASSWORD_LENGTH = 12;
const accounts = accountFixture.accounts as AuthenticatedUser[];
const auditEvents = auditFixture.events as AuditEvent[];

let currentUser: AuthenticatedUser | null = null;

export const mockTransport: Transport = async ({ method, path, body }) => {
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));

  const url = new URL(path, 'https://mock.invalid');
  const route = `${method} ${url.pathname}`;

  switch (route) {
    case 'GET /auth/csrf-token':
      return ok({ csrfToken: MOCK_CSRF_TOKEN });
    case 'POST /auth/login':
      return login(body as { email?: string; password?: string });
    case 'GET /auth/me':
      return currentUser ? ok(currentUser) : fail(401, 'AUTHENTICATION_REQUIRED');
    case 'POST /auth/logout':
      currentUser = null;
      return { status: 204, body: null };
    case 'POST /auth/password':
      return changePassword(body as { currentPassword?: string; newPassword?: string });
    case 'GET /audit-events':
      return listAuditEvents(url.searchParams);
    default:
      return fail(404, 'NOT_FOUND');
  }
};

function login(input: { email?: string; password?: string }): TransportResponse {
  const email = input.email?.trim().toLowerCase();
  const account = accounts.find((candidate) => candidate.email === email);

  if (!account || !input.password) {
    return fail(401, 'AUTHENTICATION_FAILED', 'The e-mail or password is incorrect.');
  }

  currentUser = { ...account };

  return ok({ user: currentUser, csrfToken: MOCK_CSRF_TOKEN });
}

function changePassword(input: {
  currentPassword?: string;
  newPassword?: string;
}): TransportResponse {
  if (!currentUser) {
    return fail(401, 'AUTHENTICATION_REQUIRED');
  }

  const newPassword = input.newPassword ?? '';
  const details: { field: string; message: string }[] = [];

  if (Array.from(newPassword).length < MIN_PASSWORD_LENGTH) {
    details.push({ field: 'newPassword', message: 'Use at least 12 characters.' });
  }

  if (newPassword.toLowerCase() === currentUser.email) {
    details.push({ field: 'newPassword', message: 'Do not use your e-mail address.' });
  }

  if (details.length > 0) {
    return fail(400, 'VALIDATION_FAILED', 'Choose a different password.', details);
  }

  currentUser = { ...currentUser, passwordChangeRequired: false };

  return { status: 204, body: null };
}

function listAuditEvents(params: URLSearchParams): TransportResponse {
  if (!currentUser) {
    return fail(401, 'AUTHENTICATION_REQUIRED');
  }

  if (currentUser.passwordChangeRequired) {
    return fail(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password to continue.');
  }

  if (!currentUser.permissions.includes('AUDIT_READ')) {
    return fail(403, 'AUTHORIZATION_DENIED', 'You do not have access to audit events.');
  }

  const from = params.get('from');
  const to = params.get('to');
  const filtered = auditEvents.filter(
    (event) =>
      matches(event.eventType, params.get('eventType')) &&
      matches(event.outcome, params.get('outcome')) &&
      matches(event.actorId ?? '', params.get('actorId')) &&
      matches(event.resourceType, params.get('resourceType')) &&
      (!from || Date.parse(event.occurredAt) >= Date.parse(from)) &&
      (!to || Date.parse(event.occurredAt) <= Date.parse(to)),
  );
  const page = Number(params.get('page') ?? '1');
  const limit = Number(params.get('limit') ?? '20');

  return ok({
    items: filtered.slice((page - 1) * limit, page * limit),
    page,
    limit,
    total: filtered.length,
  });
}

function matches(value: string, filter: string | null): boolean {
  return !filter || value === filter;
}

function ok(data: unknown): TransportResponse {
  return { status: 200, body: { data, meta: { requestId: crypto.randomUUID() } } };
}

function fail(
  status: number,
  code: string,
  message = 'Unable to complete the request.',
  details: { field: string; message: string }[] = [],
): TransportResponse {
  return {
    status,
    body: { error: { code, message, details }, meta: { requestId: crypto.randomUUID() } },
  };
}
