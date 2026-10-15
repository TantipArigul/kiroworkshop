import type { IncomingMessage } from 'node:http';

import pino from 'pino';
import { pinoHttp } from 'pino-http';

import type { AppConfig } from '../config/index.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.x-csrf-token',
  'req.body.email',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.csrfToken',
  'res.headers.set-cookie',
];

type RequestWithSession = IncomingMessage & {
  session?: {
    userId?: string;
  };
};

export function createLogger(config: AppConfig) {
  return pino({
    level: config.logLevel,
    redact: {
      censor: '[REDACTED]',
      paths: REDACT_PATHS,
    },
  });
}

export function createRequestLogger(logger: ReturnType<typeof createLogger>) {
  return pinoHttp({
    logger,
    customProps: (request: IncomingMessage) => {
      const requestWithSession = request as RequestWithSession;

      return {
        requestId: request.headers['x-request-id'],
        userId: requestWithSession.session?.userId,
      };
    },
    genReqId: (request: IncomingMessage) => request.headers['x-request-id'] ?? crypto.randomUUID(),
    redact: REDACT_PATHS,
  });
}
