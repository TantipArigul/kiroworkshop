import type { Request, RequestHandler, Response } from 'express';

import { csrfSync } from 'csrf-sync';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';

import type { AppConfig } from '../config/index.js';

export class CorsOriginError extends Error {
  public constructor() {
    super('The request origin is not allowed.');
    this.name = 'CorsOriginError';
  }
}

export class RateLimitError extends Error {
  public constructor() {
    super('Rate limit exceeded.');
    this.name = 'RateLimitError';
  }
}

const { csrfSynchronisedProtection, generateToken, invalidCsrfTokenError } = csrfSync({
  getTokenFromRequest: (request) => getHeaderValue(request, 'x-csrf-token'),
});

export function createSessionMiddleware(config: AppConfig, store: session.Store): RequestHandler {
  return session({
    name: 'portal_session',
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    unset: 'destroy',
    // Idle timeout: every response extends the cookie and store expiry. The absolute
    // timeout is enforced separately from `authenticatedAt` by the identity session guard.
    rolling: true,
    cookie: {
      httpOnly: true,
      maxAge: config.sessionIdleTimeoutMs,
      sameSite: 'strict',
      secure: config.appEnvironment !== 'test',
    },
  });
}

export function createSecurityHeadersMiddleware(): RequestHandler {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
}

export function createOriginGuardMiddleware(config: AppConfig): RequestHandler {
  return (request, response, next) => {
    const origin = request.headers.origin;

    if (!origin) {
      next();
      return;
    }

    if (!config.allowedOrigins.includes(origin)) {
      next(new CorsOriginError());
      return;
    }

    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    next();
  };
}

export function createRateLimiters(config: AppConfig) {
  return {
    authenticatedApi: createRateLimiter(60_000, config.authRateLimitMax),
    login: createRateLimiter(15 * 60_000, config.loginRateLimitMax),
    submit: createRateLimiter(60 * 60_000, config.submitRateLimitMax),
  };
}

export const csrfProtection = csrfSynchronisedProtection;
export const generateCsrfToken = generateToken;
export { invalidCsrfTokenError };

function createRateLimiter(windowMs: number, limit: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    legacyHeaders: false,
    standardHeaders: 'draft-8',
    handler: (_request: Request, _response: Response, next) => next(new RateLimitError()),
  });
}

function getHeaderValue(request: Request, name: string): string | undefined {
  const value = request.headers[name];

  return Array.isArray(value) ? value[0] : value;
}
