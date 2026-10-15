import { createContext, useContext } from 'react';

import type { AuthenticatedUser, Permission } from '@portal/shared';

import type { ApiClient } from './apiClient';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export type AuthState = {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  /** Set when an authenticated session stops being accepted by the API. */
  sessionExpired: boolean;
};

export type AuthContextValue = AuthState & {
  api: ApiClient;
  isMock: boolean;
  hasPermission: (permission: Permission) => boolean;
  signIn: (email: string, password: string) => Promise<AuthenticatedUser>;
  signOut: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return value;
}
