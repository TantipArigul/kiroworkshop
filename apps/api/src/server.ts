import { createServer, type Server } from 'node:http';

import { createApiApp, getJobWorker, type ApiAppConfig, type ApiRuntimeState } from './http/app.js';
import { createPrismaClient } from './infrastructure/prisma.js';

export function createApiRuntime(config: ApiAppConfig) {
  const runtimeState: ApiRuntimeState = { draining: false, startedAt: Date.now() };
  const prisma = createPrismaClient(config.databaseUrl);
  const app = createApiApp(config, prisma, runtimeState);
  const server = createServer(app);
  const worker = getJobWorker(app);
  let shuttingDown: Promise<void> | null = null;

  async function shutdown(): Promise<void> {
    runtimeState.draining = true;
    // Stop the executor first so no transition is interrupted by the disconnect; this also
    // stops running Nextflow runs (SIGTERM, then SIGKILL after SHUTDOWN_TIMEOUT_MS).
    await worker.stop();
    await shutdownServer(server, prisma, runtimeState, config.shutdownTimeoutMs);
  }

  return {
    app,
    prisma,
    server,
    start: async () => {
      await startServer(server, config.port);
      await worker.start();
    },
    /** Idempotent: a second SIGINT/SIGTERM while stopping waits for the same shutdown. */
    shutdown: () => {
      shuttingDown ??= shutdown();
      return shuttingDown;
    },
  };
}

function startServer(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function shutdownServer(
  server: Server,
  prisma: { $disconnect: () => Promise<void> },
  runtimeState: ApiRuntimeState,
  timeoutMs: number,
): Promise<void> {
  runtimeState.draining = true;
  let timer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Graceful shutdown timeout exceeded.')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    // A pending timer would keep the process alive for the whole timeout after a clean close.
    clearTimeout(timer);
  }

  await prisma.$disconnect();
}
