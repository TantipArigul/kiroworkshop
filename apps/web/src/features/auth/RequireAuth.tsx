import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';

import type { Permission } from '@portal/shared';

import { useAuth } from './authContext';
import { buildSignInPath } from './returnTo';

export const CHANGE_PASSWORD_PATH = '/account/password';

type RequireAuthProps = {
  children: ReactNode;
  /** Permission the page needs in addition to an authenticated session. */
  permission?: Permission;
  /** Only the change-password page may render while a password change is pending. */
  allowPendingPasswordChange?: boolean;
};

export function RequireAuth({
  allowPendingPasswordChange = false,
  children,
  permission,
}: RequireAuthProps) {
  const { hasPermission, sessionExpired, status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <PageSkeleton />;
  }

  if (status === 'anonymous' || !user) {
    const currentPath = `${location.pathname}${location.search}`;

    return (
      <Navigate replace to={buildSignInPath(currentPath, sessionExpired ? 'expired' : undefined)} />
    );
  }

  if (user.passwordChangeRequired && !allowPendingPasswordChange) {
    return <Navigate replace to={CHANGE_PASSWORD_PATH} />;
  }

  if (permission && !hasPermission(permission)) {
    return <AccessDenied />;
  }

  return children;
}

function PageSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading your workspace" className="page-skeleton">
      <span className="skeleton skeleton--eyebrow" />
      <span className="skeleton skeleton--title" />
      <span className="skeleton skeleton--line" />
      <span className="skeleton skeleton--line skeleton--short" />
    </section>
  );
}

function AccessDenied() {
  return (
    <section className="state-page" aria-labelledby="access-denied-title">
      <svg aria-hidden="true" className="state-page__icon" viewBox="0 0 24 24">
        <rect height="10" rx="2" width="14" x="5" y="11" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      <p className="eyebrow">Restricted area</p>
      <h1 id="access-denied-title">You do not have access to this page.</h1>
      <p>Ask a trainer or administrator if you need audit access for your role.</p>
      <Link to="/jobs">Back to your workspace</Link>
    </section>
  );
}
