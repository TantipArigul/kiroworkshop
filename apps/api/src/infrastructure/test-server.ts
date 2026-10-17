import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';

export type LoopbackServer = {
  /** Base URL such as `http://127.0.0.1:54321`; pass it to supertest instead of the app. */
  url: string;
  close: () => Promise<void>;
};

/**
 * Starts the app on an ephemeral port bound to 127.0.0.1 only.
 *
 * Supertest's default `app.listen(0)` binds the IPv6 wildcard and then connects to 127.0.0.1.
 * On macOS that wildcard bind can succeed on a port another local process already holds on
 * 127.0.0.1, so requests reach the other process and fail with `HPE_INVALID_CONSTANT`.
 * Binding the loopback address directly makes the OS pick a port that is free there.
 */
export async function listenOnLoopback(app: Express): Promise<LoopbackServer> {
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
