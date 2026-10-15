import type { InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  hint?: string;
  label: string;
};

export function Input({
  'aria-describedby': describedBy,
  error,
  hint,
  id,
  label,
  ...props
}: InputProps) {
  const inputId = id ?? `input-${label.toLowerCase().replaceAll(/\s+/g, '-')}`;
  const descriptionId = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  const ariaDescribedBy = [descriptionId, describedBy].filter(Boolean).join(' ') || undefined;

  return (
    <label className="ui-field" htmlFor={inputId}>
      <span className="ui-field__label">{label}</span>
      <input
        {...props}
        aria-describedby={ariaDescribedBy}
        aria-invalid={Boolean(error)}
        className="ui-input"
        id={inputId}
      />
      {error ? (
        <span className="ui-field__error" id={descriptionId} role="alert">
          {error}
        </span>
      ) : null}
      {!error && hint ? (
        <span className="ui-field__hint" id={descriptionId}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
