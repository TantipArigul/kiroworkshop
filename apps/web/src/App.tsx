import { useEffect, useRef, useState } from 'react';
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';

import { Button, FeedbackMessage } from './components/ui';
import { AuditPage } from './features/audit/AuditPage';
import { AuthProvider } from './features/auth/AuthProvider';
import { useAuth } from './features/auth/authContext';
import { ChangePasswordPage } from './features/auth/ChangePasswordPage';
import { CHANGE_PASSWORD_PATH, RequireAuth } from './features/auth/RequireAuth';
import { SignInPage } from './features/auth/SignInPage';
import { JobDetailPage } from './features/jobs/JobDetailPage';
import { JobsListPage } from './features/jobs/JobsListPage';
import { NewJobPage } from './features/jobs/NewJobPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="site-shell">
          <a className="skip-link" href="#main">
            Skip to main content
          </a>
          <SiteHeader />
          <RouteFocus />
          <main id="main" tabIndex={-1}>
            <Routes>
              <Route element={<Landing />} path="/" />
              <Route element={<SignInPage />} path="/sign-in" />
              <Route
                element={
                  <RequireAuth allowPendingPasswordChange>
                    <ChangePasswordPage />
                  </RequireAuth>
                }
                path={CHANGE_PASSWORD_PATH}
              />
              <Route
                element={
                  <RequireAuth>
                    <JobsListPage />
                  </RequireAuth>
                }
                path="/jobs"
              />
              <Route
                element={
                  <RequireAuth>
                    <NewJobPage />
                  </RequireAuth>
                }
                path="/jobs/new"
              />
              <Route
                element={
                  <RequireAuth>
                    <JobDetailPage />
                  </RequireAuth>
                }
                path="/jobs/:jobId"
              />
              <Route
                element={
                  <RequireAuth permission="AUDIT_READ">
                    <AuditPage />
                  </RequireAuth>
                }
                path="/audit"
              />
              <Route element={<Guide />} path="/help" />
            </Routes>
          </main>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

/** Moves focus to the main region after client-side navigation so screen readers announce the new page. */
function RouteFocus() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);

  useEffect(() => {
    if (previousPath.current === pathname) {
      return;
    }

    previousPath.current = pathname;
    document.getElementById('main')?.focus();
  }, [pathname]);

  return null;
}

function SiteHeader() {
  const { hasPermission, signOut, status, user } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const signedIn = status === 'authenticated' && user;

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await signOut();
    } finally {
      setSigningOut(false);
      navigate('/sign-in', { replace: true });
    }
  }

  return (
    <header className="site-header">
      <Link className="brand" to="/">
        <Mark />
        <span>
          SamNoh<span className="brand-accent">server</span>
        </span>
      </Link>
      <nav aria-label="Primary navigation" className="site-nav">
        <NavLink to="/jobs">Workspace</NavLink>
        <NavLink to="/help">Guide</NavLink>
        {signedIn && hasPermission('AUDIT_READ') ? <NavLink to="/audit">Audit</NavLink> : null}
        {signedIn ? (
          <div className="site-account">
            <NavLink
              aria-label={`Account settings for ${user.email}`}
              className="site-account__email"
              to={CHANGE_PASSWORD_PATH}
            >
              {user.email}
            </NavLink>
            <Button disabled={signingOut} onClick={() => void handleSignOut()} variant="secondary">
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        ) : (
          <NavLink to="/sign-in">Sign in</NavLink>
        )}
      </nav>
    </header>
  );
}

function Mark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 40 40">
      <path d="M8 28 16 12l8 16 8-16" />
      <circle cx="8" cy="28" r="3" />
      <circle cx="16" cy="12" r="3" />
      <circle cx="24" cy="28" r="3" />
      <circle cx="32" cy="12" r="3" />
    </svg>
  );
}

function Landing() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Clinical analysis workspace</p>
          <h1>
            From synthetic input to <span>traceable insight.</span>
          </h1>
          <p className="hero-summary">
            SamNohserver is a focused training environment for submitting synthetic analysis jobs,
            following their progress, and reviewing interpretable outputs.
          </p>
          <div className="hero-actions">
            <Link className="ui-button ui-button--primary" to="/jobs">
              Start analysis
            </Link>
            <Link className="ui-button ui-button--ghost" to="/help">
              Explore the workflow
            </Link>
          </div>
          <small>Training output only — not medical diagnosis or treatment advice.</small>
        </div>
        <ScientificAnchor />
      </section>
      <section className="research-story">
        <div className="research-story__inner">
          <div className="research-story__heading">
            <p className="eyebrow">One focused workflow</p>
            <h2>Structured steps for a clear research handoff.</h2>
            <p>
              Keep each action legible: prepare the input, monitor the analysis, then review the
              outcome in context.
            </p>
          </div>
          <div className="workflow-steps">
            <Step
              number="01"
              title="Prepare input"
              text="Load authored sample data or validate a synthetic file."
            />
            <Step
              number="02"
              title="Track the job"
              text="Keep a bookmarkable URL and a clear, labelled status."
            />
            <Step
              number="03"
              title="Review output"
              text="Read the result with its context and stated limitation."
            />
          </div>
        </div>
      </section>
      <section aria-label="Privacy and source commitments" className="trust-strip">
        <span>Private by default</span>
        <span>HTTPS delivery</span>
        <span id="mit-license">MIT licensed source</span>
      </section>
    </>
  );
}

function ScientificAnchor() {
  return (
    <div
      aria-label="Abstract analysis sequence visual from input through signal to result"
      className="science-anchor"
      role="img"
    >
      <svg aria-hidden="true" viewBox="0 0 480 420">
        <path
          className="science-anchor__trace science-anchor__trace--top"
          d="M40 114C120 28 194 28 270 114s148 86 170 0"
        />
        <path
          className="science-anchor__trace science-anchor__trace--bottom"
          d="M40 306c80 86 154 86 230 0s148-86 170 0"
        />
        <path className="science-anchor__bridge" d="M99 89v242M181 67v286M270 67v286M354 89v242" />
        <circle className="science-anchor__node" cx="99" cy="114" r="16" />
        <circle
          className="science-anchor__node science-anchor__node--active"
          cx="181"
          cy="210"
          r="22"
        />
        <circle
          className="science-anchor__node science-anchor__node--active"
          cx="270"
          cy="210"
          r="22"
        />
        <circle className="science-anchor__node" cx="354" cy="306" r="16" />
        <circle className="science-anchor__signal" cx="226" cy="210" r="64" />
      </svg>
      <div aria-hidden="true" className="science-anchor__labels">
        <span>Input</span>
        <span>Signal</span>
        <span>Result</span>
      </div>
    </div>
  );
}

function Step({ number, text, title }: { number: string; text: string; title: string }) {
  return (
    <article>
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function Guide() {
  return (
    <section className="guide">
      <p className="eyebrow">Guide</p>
      <h1>Follow the analysis path with confidence.</h1>
      <ol>
        <li>Use the sample input to confirm formatting.</li>
        <li>Submit one analysis and retain its job URL.</li>
        <li>Read status, safe errors, result labels and limitation notes.</li>
      </ol>
      <FeedbackMessage tone="success">
        Interactive sample and final result views are added with the Job and Results units.
      </FeedbackMessage>
    </section>
  );
}
