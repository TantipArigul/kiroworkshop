import 'express-session';

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
    userId?: string;
    /** Epoch milliseconds of the successful login; used for the absolute session timeout. */
    authenticatedAt?: number;
  }
}
