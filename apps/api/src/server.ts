import { createServer, type Server } from 'node:http';

import type { AppConfig } from './config/index.js';
import { createApiApp, type ApiRuntimeState } from './http/app.js';
import { createPrismaClient } from './infrastructure/prisma.js';

export function createApiRuntime(config: AppConfig) {
  const runtimeState: ApiRuntimeState = { draining: false, startedAt: Date.now() };
  const prisma = createPrismaClient(config.databaseUrl);
  const app = createApiApp(config, prisma, runtimeState);
  const server = createServer(app);

  return {
    app,
    prisma,
    server,
    start: () => startServer(server, config.port),
    shutdown: () => shutdownServer(server, prisma, runtimeState, config.shutdownTimeoutMs),
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

  await Promise.race([
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
    new Promise<void>((_resolve, reject) =>
      setTimeout(() => reject(new Error('Graceful shutdown timeout exceeded.')), timeoutMs),
    ),
  ]);
  await prisma.$disconnect();
}
