import type { AuthenticatedUser } from '@portal/shared';

import type { ActorContext } from './authorization.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuthenticated`; consumed by owner/permission checks. */
      actor?: ActorContext;
      /** Public projection of the signed-in user, set by `requireAuthenticated`. */
      currentUser?: AuthenticatedUser;
    }
  }
}
