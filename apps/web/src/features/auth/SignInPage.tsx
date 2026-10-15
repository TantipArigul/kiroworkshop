import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { Button, FeedbackMessage, Input } from '../../components/ui';
import { ApiRequestError } from './apiClient';
import { useAuth } from './authContext';
import { CHANGE_PASSWORD_PATH } from './RequireAuth';
import { resolveReturnTo } from './returnTo';

type FieldErrors = { email?: string; password?: string };

const MOCK_ACCOUNTS = [
  'user@example.test',
  'auditor@example.test',
  'admin@example.test',
  'new@example.test',
];

export function SignInPage() {
  const { isMock, signIn, status, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const returnTo = resolveReturnTo(searchParams.get('returnTo'));
  const sessionExpired = searchParams.get('reason') === 'expired';

  if (status === 'authenticated' && user && !submitting) {
    return <Navigate replace to={user.passwordChangeRequired ? CHANGE_PASSWORD_PATH : returnTo} />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validate(email, password);

    setFieldErrors(errors);
    setFormError(null);

    if (errors.email || errors.password) {
      focusField(errors.email ? 'sign-in-email' : 'sign-in-password');
      return;
    }

    setSubmitting(true);

    try {
      const signedInUser = await signIn(email, password);
      navigate(signedInUser.passwordChangeRequired ? CHANGE_PASSWORD_PATH : returnTo, {
        replace: true,
      });
    } catch (error) {
      setFormError(describeSignInError(error));
      setPassword('');
      setSubmitting(false);
      focusField('sign-in-password');
    }
  }

  return (
    <section className="form-page">
      <div>
        <p className="eyebrow">Protected workspace</p>
        <h1>Sign in to continue.</h1>
        <p>
          Accounts are issued by your trainer. Use the e-mail address and temporary password you
          received; you will choose your own password the first time you sign in.
        </p>
        <ul className="assurance-list">
          <li>Your jobs and results are visible only to you.</li>
          <li>Sessions end after 30 minutes without activity.</li>
          <li>Training environment for synthetic data only.</li>
        </ul>
      </div>
      <form
        aria-describedby="sign-in-help"
        className="sign-in-form"
        noValidate
        onSubmit={handleSubmit}
      >
        <h2 className="form-title">Sign in</h2>
        {sessionExpired && !formError ? (
          <FeedbackMessage tone="info">
            Your session ended. Sign in again to continue.
          </FeedbackMessage>
        ) : null}
        {formError ? <FeedbackMessage tone="error">{formError}</FeedbackMessage> : null}
        <Input
          autoComplete="username"
          error={fieldErrors.email}
          id="sign-in-email"
          inputMode="email"
          label="E-mail address"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
        <Input
          autoComplete="current-password"
          error={fieldErrors.password}
          id="sign-in-password"
          label="Password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          revealable
          type="password"
          value={password}
        />
        <Button aria-busy={submitting} disabled={submitting} type="submit">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="form-help" id="sign-in-help">
          Forgot your password? Ask your trainer to reset it. Sessions are server-side and no
          tracking cookies are used.
        </p>
        {isMock ? (
          <div className="mock-banner">
            <strong>Mock mode</strong>
            <span>Any password works for: {MOCK_ACCOUNTS.join(', ')}.</span>
          </div>
        ) : null}
      </form>
    </section>
  );
}

function focusField(id: string) {
  // Wait for React to render the error before moving focus to the field.
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};

  if (!email.trim()) {
    errors.email = 'Enter your e-mail address.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.email = 'Enter an e-mail address such as name@example.com.';
  }

  if (!password) {
    errors.password = 'Enter your password.';
  }

  return errors;
}

function describeSignInError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'AUTHENTICATION_FAILED') {
      return 'The e-mail address or password is incorrect.';
    }

    if (error.code === 'RATE_LIMITED') {
      return 'Too many sign-in attempts. Wait a few minutes and try again.';
    }

    if (error.code === 'NETWORK_ERROR') {
      return 'The service is unreachable. Check your connection and try again.';
    }
  }

  return 'Sign-in is unavailable right now. Please try again.';
}
