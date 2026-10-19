import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Test HTTP servers bind explicitly to 127.0.0.1.
 *
 * Root cause of the parallel-run flake: SuperTest's default `app.listen(0)` binds the IPv6
 * wildcard `::` and then sends requests to `127.0.0.1:<port>`. On macOS the kernel lets a
 * wildcard bind take an ephemeral port that another process already holds on `127.0.0.1`
 * (libuv sets SO_REUSEADDR), and loopback traffic goes to the more specific binding — so a test
 * request occasionally reached an unrelated local process (editor helpers, language servers)
 * and came back as 401/404/426 or an HTTP parse error without our headers. Binding the test
 * server to `127.0.0.1` makes the kernel reject ports already held on loopback.
 */
export async function listenOnLoopback(app: RequestListener): Promise<Server> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  if (address.address !== '127.0.0.1') {
    throw new Error(`Test server bound to ${address.address} instead of 127.0.0.1`);
  }
  return server;
}

/** Closes a test server and any keep-alive sockets the client pool still holds. */
export async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

const serversByApp = new WeakMap<RequestListener, Server>();

/** Records the loopback server that serves `app` so `createSession(app)` can target it. */
export function registerLoopbackServer(app: RequestListener, server: Server): void {
  serversByApp.set(app, server);
}

export function loopbackServerFor(app: RequestListener): Server {
  const server = serversByApp.get(app);
  if (!server?.listening) {
    throw new Error('No loopback test server is listening for this app; create it via a context.');
  }
  return server;
}
