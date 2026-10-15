import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { Button, FeedbackMessage, Input } from '../../components/ui';
import { ApiRequestError } from './apiClient';
import { useAuth } from './authContext';

const MIN_PASSWORD_LENGTH = 12;

type FieldErrors = { currentPassword?: string; newPassword?: string; confirmPassword?: string };

export function ChangePasswordPage() {
  const { changePassword, user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const forced = Boolean(user?.passwordChangeRequired);
  const email = user?.email ?? '';
  const rules = [
    {
      label: `At least ${MIN_PASSWORD_LENGTH} characters`,
      met: Array.from(newPassword).length >= MIN_PASSWORD_LENGTH,
    },
    {
      label: 'Different from your e-mail address',
      met: newPassword.length > 0 && !matchesIdentifier(newPassword, email),
    },
    {
      label: 'Matches the confirmation',
      met: newPassword.length > 0 && newPassword === confirmPassword,
    },
  ];

  if (completed) {
    return (
      <section className="state-page" aria-labelledby="password-changed-title">
        <svg
          aria-hidden="true"
          className="state-page__icon state-page__icon--success"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </svg>
        <p className="eyebrow">Account security</p>
        <h1 id="password-changed-title">Your password has been updated.</h1>
        <p>Other signed-in sessions for your account have been signed out.</p>
        <Link className="ui-button ui-button--primary" to="/jobs">
          Continue to workspace
        </Link>
      </section>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validate(currentPassword, newPassword, confirmPassword, email);

    setFieldErrors(errors);
    setFormError(null);

    if (Object.keys(errors).length > 0) {
      focusFirstInvalid(errors);
      return;
    }

    setSubmitting(true);

    try {
      await changePassword(currentPassword, newPassword);
      setCompleted(true);
    } catch (error) {
      focusFirstInvalid(applyServerError(error, setFieldErrors, setFormError));
      setSubmitting(false);
    }
  }

  return (
    <section className="form-page">
      <div>
        <p className="eyebrow">Account security</p>
        <h1>{forced ? 'Choose a new password.' : 'Change your password.'}</h1>
        <p>
          {forced
            ? 'Your account is using a temporary password from your trainer. Choose your own password to continue.'
            : 'Changing your password signs out your other sessions.'}
        </p>
      </div>
      <form className="sign-in-form" noValidate onSubmit={handleSubmit}>
        <h2 className="form-title">New password</h2>
        {forced ? (
          <FeedbackMessage tone="info">
            A password change is required before you can open your workspace.
          </FeedbackMessage>
        ) : null}
        {formError ? <FeedbackMessage tone="error">{formError}</FeedbackMessage> : null}
        <Input
          autoComplete="current-password"
          error={fieldErrors.currentPassword}
          id="current-password"
          label={forced ? 'Temporary password' : 'Current password'}
          name="currentPassword"
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          revealable
          type="password"
          value={currentPassword}
        />
        <Input
          aria-describedby="password-rules"
          autoComplete="new-password"
          error={fieldErrors.newPassword}
          id="new-password"
          label="New password"
          name="newPassword"
          onChange={(event) => setNewPassword(event.target.value)}
          required
          revealable
          type="password"
          value={newPassword}
        />
        <ul aria-label="Password requirements" className="password-rules" id="password-rules">
          {rules.map((rule) => (
            <li
              className={rule.met ? 'password-rules__item is-met' : 'password-rules__item'}
              key={rule.label}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                {rule.met ? <path d="m5 12 4 4L19 6" /> : <circle cx="12" cy="12" r="4" />}
              </svg>
              <span>
                {rule.label}
                <span className="visually-hidden">{rule.met ? ' — met' : ' — not met yet'}</span>
              </span>
            </li>
          ))}
          <li className="password-rules__note">Common passwords are rejected when you save.</li>
        </ul>
        <Input
          autoComplete="new-password"
          error={fieldErrors.confirmPassword}
          id="confirm-password"
          label="Confirm new password"
          name="confirmPassword"
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          revealable
          type="password"
          value={confirmPassword}
        />
        <Button aria-busy={submitting} disabled={submitting} type="submit">
          {submitting ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </section>
  );
}

const FIELD_IDS: Record<keyof FieldErrors, string> = {
  currentPassword: 'current-password',
  newPassword: 'new-password',
  confirmPassword: 'confirm-password',
};

function focusFirstInvalid(errors: FieldErrors) {
  const firstInvalid = (Object.keys(FIELD_IDS) as (keyof FieldErrors)[]).find((key) => errors[key]);

  if (firstInvalid) {
    // Wait for React to render the error before moving focus to the field.
    requestAnimationFrame(() => document.getElementById(FIELD_IDS[firstInvalid])?.focus());
  }
}

function matchesIdentifier(password: string, email: string): boolean {
  const normalized = password.trim().toLowerCase();
  const localPart = email.split('@')[0] ?? '';

  return normalized === email || (localPart.length > 0 && normalized === localPart);
}

function validate(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
  email: string,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!currentPassword) {
    errors.currentPassword = 'Enter your current password.';
  }

  if (Array.from(newPassword).length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (matchesIdentifier(newPassword, email)) {
    errors.newPassword = 'Do not use your e-mail address as your password.';
  } else if (newPassword === currentPassword) {
    errors.newPassword = 'Choose a password that is different from your current one.';
  }

  if (confirmPassword !== newPassword) {
    errors.confirmPassword = 'The passwords do not match.';
  }

  return errors;
}

function applyServerError(
  error: unknown,
  setFieldErrors: (errors: FieldErrors) => void,
  setFormError: (message: string | null) => void,
): FieldErrors {
  if (error instanceof ApiRequestError) {
    if (error.code === 'AUTHENTICATION_FAILED') {
      const errors = { currentPassword: 'The current password is incorrect.' };
      setFieldErrors(errors);
      return errors;
    }

    if (error.code === 'VALIDATION_FAILED') {
      const message = error.details.find((detail) => detail.field === 'newPassword')?.message;
      const errors = { newPassword: message ?? 'Choose a different password.' };
      setFieldErrors(errors);
      return errors;
    }
  }

  setFormError('Your password could not be changed. Please try again.');
  return {};
}
