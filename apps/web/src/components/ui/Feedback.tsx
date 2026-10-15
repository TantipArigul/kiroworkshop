import type { ReactNode } from 'react';

type FeedbackProps = {
  children: ReactNode;
  tone: 'error' | 'info' | 'success';
};

export function FeedbackMessage({ children, tone }: FeedbackProps) {
  return (
    <div
      className={`ui-feedback ui-feedback--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
