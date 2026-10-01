import { loadConfig } from './config/index.js';
import { createApiRuntime } from './server.js';

const config = loadConfig(process.env);
const runtime = createApiRuntime(config);

runtime
  .start()
  .then(() => {
    process.on('SIGINT', () => void runtime.shutdown());
    process.on('SIGTERM', () => void runtime.shutdown());
  })
  .catch(async (error: unknown) => {
    await runtime.prisma.$disconnect();
    throw error;
  });
