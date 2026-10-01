import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router';

import { Button, FeedbackMessage, Input, StatusBadge } from './components/ui';

export function App() {
  return (
    <BrowserRouter>
      <div className="site-shell">
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
            <NavLink to="/sign-in">Sign in</NavLink>
          </nav>
        </header>
        <main>
          <Routes>
            <Route element={<Landing />} path="/" />
            <Route element={<SignIn />} path="/sign-in" />
            <Route element={<Workspace />} path="/jobs" />
            <Route element={<Guide />} path="/help" />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
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
            <Link to="/sign-in">
              <Button>Start analysis</Button>
            </Link>
            <Link to="/help">
              <Button variant="ghost">Explore the workflow</Button>
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

function SignIn() {
  return (
    <section className="form-page">
      <div>
        <p className="eyebrow">Protected workspace</p>
        <h1>Sign in to continue.</h1>
        <p>Identity access is being prepared for this training environment.</p>
      </div>
      <form className="sign-in-form">
        <Input
          disabled
          hint="Training access will be enabled with the Identity unit."
          label="Username"
          name="username"
        />
        <Input disabled label="Password" name="password" type="password" />
        <Button disabled type="submit">
          Sign in
        </Button>
        <FeedbackMessage tone="info">
          Sessions are server-side. No permanent tracking cookies are used.
        </FeedbackMessage>
      </form>
    </section>
  );
}

function Workspace() {
  return (
    <section className="workspace">
      <div className="workspace-head">
        <div>
          <p className="eyebrow">Workspace / Jobs</p>
          <h1>Analysis jobs</h1>
          <p>Monitor submitted analysis and return to the same secure result link later.</p>
        </div>
        <Link to="/sign-in">
          <Button>New analysis</Button>
        </Link>
      </div>
      <div className="job-surface">
        <div>
          <h2>No jobs yet</h2>
          <p>Sign in to load a sample input or submit a validated synthetic file.</p>
          <Link to="/help">Open the submission guide</Link>
        </div>
        <StatusBadge status="queued" />
      </div>
    </section>
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
