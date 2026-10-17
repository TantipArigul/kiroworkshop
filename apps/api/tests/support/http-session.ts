import request from 'supertest';

/**
 * Supertest agent that keeps the session cookie and sends the current CSRF token on mutations.
 * `baseUrl` is the loopback URL from the test context (see `listenOnLoopback`).
 */
export function createSession(baseUrl: string) {
  const agent = request.agent(baseUrl);
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
    post: (path: string, body?: object) =>
      agent
        .post(path)
        .set('X-CSRF-Token', csrfToken)
        .send(body ?? {}),
    refreshCsrfToken,
  };
}

/** Session cookie value from a response's Set-Cookie header, or null when none was set. */
export function sessionCookieFrom(response: { headers: Record<string, unknown> }): string | null {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [String(header)] : [];
  const session = cookies.find((cookie: string) => cookie.startsWith('portal_session='));

  return session ? session.split(';')[0]! : null;
}
