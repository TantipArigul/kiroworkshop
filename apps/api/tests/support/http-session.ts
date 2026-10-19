import request from 'supertest';
import type { Express } from 'express';

import { loopbackServerFor } from './loopback-server.js';

/**
 * Supertest agent that keeps the session cookie and sends the current CSRF token on mutations.
 * Requests go to the context's 127.0.0.1 server (see `loopback-server.ts`), never to a
 * per-request `listen(0)` on the IPv6 wildcard.
 */
export function createSession(app: Express) {
  const agent = request.agent(loopbackServerFor(app));
  let csrfToken = '';

  async function refreshCsrfToken() {
    const response = await agent.get('/api/v1/auth/csrf-token').expect(200);
    csrfToken = response.body.data.csrfToken as string;
    return csrfToken;
  }

  async function login(email: string, password: string) {
    if (!csrfToken) {
      await refreshCsrfToken();
    }

    const response = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ email, password });

    if (response.status === 200) {
      const token = (response.body as { data?: { csrfToken?: string } }).data?.csrfToken;

      if (!token) {
        throw new Error(`Login returned 200 without a CSRF token: ${response.text.slice(0, 200)}`);
      }

      csrfToken = token;
    }

    return response;
  }

  return {
    agent,
    get: (path: string) => agent.get(path),
    login,
    post: (path: string, body?: object, headers: Record<string, string> = {}) =>
      agent
        .post(path)
        .set({ ...headers, 'X-CSRF-Token': csrfToken })
        .send(body ?? {}),
    delete: (path: string) => agent.delete(path).set('X-CSRF-Token', csrfToken),
    /** POST a pre-encoded body (e.g. multipart) with the current CSRF token. */
    postRaw: (path: string, body: Buffer, headers: Record<string, string>) =>
      agent
        .post(path)
        .set({ ...headers, 'X-CSRF-Token': csrfToken })
        .send(body),
    refreshCsrfToken,
    /** Current CSRF token (for requests built outside `post`/`postRaw`). */
    csrfToken: () => csrfToken,
  };
}

/** Session cookie value from a response's Set-Cookie header, or null when none was set. */
export function sessionCookieFrom(response: { headers: Record<string, unknown> }): string | null {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [String(header)] : [];
  const session = cookies.find((cookie: string) => cookie.startsWith('portal_session='));

  return session ? session.split(';')[0]! : null;
}
