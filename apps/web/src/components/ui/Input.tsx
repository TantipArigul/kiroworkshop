import { useState, type InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  hint?: string;
  label: string;
  /** Adds a Show/Hide control for password fields. */
  revealable?: boolean;
};

export function Input({
  'aria-describedby': describedBy,
  error,
  hint,
  id,
  label,
  revealable = false,
  type,
  ...props
}: InputProps) {
  const [revealed, setRevealed] = useState(false);
  const inputId = id ?? `input-${label.toLowerCase().replaceAll(/\s+/g, '-')}`;
  const descriptionId = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  const ariaDescribedBy = [descriptionId, describedBy].filter(Boolean).join(' ') || undefined;
  const input = (
    <input
      {...props}
      aria-describedby={ariaDescribedBy}
      aria-invalid={Boolean(error)}
      className="ui-input"
      id={inputId}
      type={revealable && revealed ? 'text' : type}
    />
  );

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={inputId}>
        {label}
      </label>
      {revealable ? (
        <div className="ui-input-group">
          {input}
          <button
            aria-controls={inputId}
            aria-pressed={revealed}
            className="ui-button ui-button--ghost ui-input-reveal"
            onClick={() => setRevealed((current) => !current)}
            type="button"
          >
            {revealed ? 'Hide' : 'Show'}
            <span className="visually-hidden"> {label.toLowerCase()}</span>
          </button>
        </div>
      ) : (
        input
      )}
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
    </div>
  );
}
