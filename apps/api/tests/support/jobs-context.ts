import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { JobCompletionHandler } from '../../src/modules/jobs/completion.js';
import { getJobWorker } from '../../src/http/app.js';
import { SAMPLE_INPUT } from '../../src/modules/jobs/sample-input.js';
import { createSession } from './http-session.js';
import {
  createIdentityTestContext,
  TEST_PASSWORD,
  type IdentityTestContext,
} from './identity-context.js';

export type JobsTestContext = IdentityTestContext & {
  /** Runs one executor pass (delays are 0, so QUEUED→RUNNING and RUNNING→terminal each take one). */
  tick: () => Promise<void>;
  /** Signed-in session for a ready synthetic USER account. */
  signIn: (email: string) => Promise<ReturnType<typeof createSession> & { userId: string }>;
  jobDirectoryExists: (jobId: string) => boolean;
  executor: { ready: boolean };
};

export const SAMPLE_BODY = {
  file: SAMPLE_INPUT.file,
  parameters: SAMPLE_INPUT.parameters,
};

export async function createJobsTestContext(
  options: { completionHandler?: JobCompletionHandler; environment?: Record<string, string> } = {},
): Promise<JobsTestContext> {
  const executor = { ready: true };
  const context = await createIdentityTestContext(
    {
      EXECUTOR_ENABLED: 'false',
      EXECUTOR_QUEUED_DELAY_MS: '0',
      EXECUTOR_RUNNING_DELAY_MS: '0',
      SUBMIT_RATE_LIMIT_MAX: '10000',
      AUTH_RATE_LIMIT_MAX: '10000',
      ...options.environment,
    },
    { completionHandler: options.completionHandler, isExecutorReady: () => executor.ready },
  );
  const worker = getJobWorker(context.app);

  return {
    ...context,
    executor,
    jobDirectoryExists: (jobId) => existsSync(join(context.config.storageRoot, 'jobs', jobId)),
    signIn: async (email) => {
      const { id } = await context.createUser(email, 'USER', { ready: true });
      const session = createSession(context.app);
      const response = await session.login(email, TEST_PASSWORD);

      if (response.status !== 200) {
        throw new Error(`Test login failed with ${response.status}`);
      }

      return { ...session, userId: id };
    },
    tick: () => worker.tick(),
  };
}
