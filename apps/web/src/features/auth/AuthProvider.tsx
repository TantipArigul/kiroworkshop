import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';

import type { AuthenticatedUser, Permission } from '@portal/shared';

import { ApiRequestError, createApiClient, fetchTransport, type Transport } from './apiClient';
import { AuthContext, type AuthContextValue, type AuthState } from './authContext';

const IS_MOCK = import.meta.env.VITE_API_MOCK === 'true';

// The mock module is only loaded (and only bundled into a reachable chunk) in mock mode.
const transport: Transport = IS_MOCK
  ? async (request) => (await import('../../mocks/mockTransport')).mockTransport(request)
  : fetchTransport;

type AuthAction =
  | { type: 'RESOLVED'; user: AuthenticatedUser | null }
  | { type: 'SIGNED_IN'; user: AuthenticatedUser }
  | { type: 'SIGNED_OUT' }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'PASSWORD_CHANGE_REQUIRED' }
  | { type: 'PASSWORD_CHANGED' };

const initialState: AuthState = { status: 'loading', user: null, sessionExpired: false };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'RESOLVED':
      return action.user
        ? { status: 'authenticated', user: action.user, sessionExpired: false }
        : { status: 'anonymous', user: null, sessionExpired: false };
    case 'SIGNED_IN':
      return { status: 'authenticated', user: action.user, sessionExpired: false };
    case 'SIGNED_OUT':
      return { status: 'anonymous', user: null, sessionExpired: false };
    case 'SESSION_EXPIRED':
      // Only a session that was active can expire; an anonymous 401 is not news.
      return {
        status: 'anonymous',
        user: null,
        sessionExpired: state.status === 'authenticated',
      };
    case 'PASSWORD_CHANGE_REQUIRED':
      return state.user
        ? { ...state, user: { ...state.user, passwordChangeRequired: true } }
        : state;
    case 'PASSWORD_CHANGED':
      return state.user
        ? { ...state, user: { ...state.user, passwordChangeRequired: false } }
        : state;
    default:
      return state;
  }
}

type CsrfTokenData = { data: { csrfToken: string } };
type UserData = { data: AuthenticatedUser };
type LoginData = { data: { user: AuthenticatedUser; csrfToken: string } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  // The CSRF token lives in memory only; it is never written to Web Storage.
  const csrfTokenRef = useRef<string | null>(null);

  const api = useMemo(
    () =>
      createApiClient({
        transport,
        getCsrfToken: () => csrfTokenRef.current,
        onAuthenticationRequired: () => {
          csrfTokenRef.current = null;
          dispatch({ type: 'SESSION_EXPIRED' });
        },
        onPasswordChangeRequired: () => dispatch({ type: 'PASSWORD_CHANGE_REQUIRED' }),
      }),
    [],
  );

  const refreshCsrfToken = useCallback(async () => {
    const response = await api.get<CsrfTokenData>('/auth/csrf-token');
    csrfTokenRef.current = response.data.csrfToken;
  }, [api]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        await refreshCsrfToken();
        const response = await api.get<UserData>('/auth/me');

        if (active) {
          dispatch({ type: 'RESOLVED', user: response.data });
        }
      } catch {
        if (active) {
          dispatch({ type: 'RESOLVED', user: null });
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [api, refreshCsrfToken]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!csrfTokenRef.current) {
        await refreshCsrfToken();
      }

      const response = await api.post<LoginData>('/auth/login', { email, password });
      csrfTokenRef.current = response.data.csrfToken;
      dispatch({ type: 'SIGNED_IN', user: response.data.user });

      return response.data.user;
    },
    [api, refreshCsrfToken],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post<void>('/auth/logout');
    } catch (error) {
      // An already-expired session is still a completed sign-out for the user.
      if (!(error instanceof ApiRequestError)) {
        throw error;
      }
    } finally {
      csrfTokenRef.current = null;
      dispatch({ type: 'SIGNED_OUT' });
    }

    await refreshCsrfToken().catch(() => undefined);
  }, [api, refreshCsrfToken]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await api.post<void>('/auth/password', { currentPassword, newPassword });
      dispatch({ type: 'PASSWORD_CHANGED' });
    },
    [api],
  );

  const hasPermission = useCallback(
    (permission: Permission) => Boolean(state.user?.permissions.includes(permission)),
    [state.user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      api,
      changePassword,
      hasPermission,
      isMock: IS_MOCK,
      signIn,
      signOut,
    }),
    [state, api, changePassword, hasPermission, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
