import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import type { JobParameters } from '@portal/shared';
import {
  AGE_BANDS,
  FOCUS_AREAS,
  INPUT_FILE_HEADER,
  INPUT_FILE_MAX_BYTES,
  INPUT_FILE_MAX_ROWS,
  INPUT_MARKERS,
  LIFESTYLE_FACTORS,
} from '@portal/shared/constants';

import { Button, FeedbackMessage, Input, Select } from '../../components/ui';
import { ApiRequestError } from '../auth/apiClient';
import { useAuth } from '../auth/authContext';
import { previewCsv, type CsvPreview } from './csvPreview';
import { createJobsApi, formatBytes, humanize } from './jobsApi';

type FormValues = Omit<JobParameters, 'lifestyleFactors'> & {
  lifestyleFactors: JobParameters['lifestyleFactors'];
};
type InputFile = { name: string; content: string; preview: CsvPreview };
type FieldErrors = Partial<Record<keyof FormValues | 'file', string>>;
type SampleState = 'idle' | 'loading' | 'loaded' | 'error';

const EMPTY_VALUES: FormValues = {
  sampleLabel: '',
  ageBand: '40-49',
  focusArea: 'GENERAL',
  lifestyleFactors: [],
  simulateFailure: false,
};
const LABEL_PATTERN = /^[A-Za-z0-9 _.-]+$/;

export function NewJobPage() {
  const { api } = useAuth();
  const jobsApi = useMemo(() => createJobsApi(api), [api]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [file, setFile] = useState<InputFile | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sampleState, setSampleState] = useState<SampleState>('idle');
  const [submitting, setSubmitting] = useState(false);
  // One key per filled-in form: retries reuse it so the server never creates a duplicate job.
  const idempotencyKey = useRef(crypto.randomUUID());
  const autoLoadedSample = useRef(false);

  async function loadSample() {
    setSampleState('loading');
    setFormError(null);

    try {
      const sample = await jobsApi.sampleInput();
      setValues({ ...EMPTY_VALUES, ...sample.parameters });
      setFile({ ...sample.file, preview: previewCsv(sample.file.content) });
      setErrors({});
      setSampleState('loaded');
    } catch {
      setSampleState('error');
    }
  }

  useEffect(() => {
    if (searchParams.get('sample') === '1' && !autoLoadedSample.current) {
      autoLoadedSample.current = true;
      void loadSample();
    }
    // Runs once for the `?sample=1` entry point from the empty job list.
  }, [searchParams]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    setSampleState('idle');

    if (!selected) {
      setFile(null);
      return;
    }

    if (selected.size > INPUT_FILE_MAX_BYTES) {
      setFile(null);
      setErrors((current) => ({
        ...current,
        file: `Choose a file of at most ${INPUT_FILE_MAX_BYTES / 1024} KB.`,
      }));
      return;
    }

    try {
      const content = await selected.text();
      setFile({ name: selected.name, content, preview: previewCsv(content) });
      setErrors((current) => ({ ...current, file: undefined }));
    } catch {
      setFile(null);
      setErrors((current) => ({ ...current, file: 'The file could not be read. Try again.' }));
    }
  }

  function toggleFactor(factor: FormValues['lifestyleFactors'][number]) {
    setValues((current) => ({
      ...current,
      lifestyleFactors: current.lifestyleFactors.includes(factor)
        ? current.lifestyleFactors.filter((item) => item !== factor)
        : [...current.lifestyleFactors, factor],
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const clientErrors = validate(values, file);
    setErrors(clientErrors);

    if (Object.keys(clientErrors).length > 0) {
      focusFirstInvalid(clientErrors);
      return;
    }

    if (!file) {
      return;
    }

    setSubmitting(true);

    try {
      const response = await jobsApi.submit(
        {
          parameters: { ...values, sampleLabel: values.sampleLabel.trim() },
          file: { name: file.name, content: file.content },
        },
        idempotencyKey.current,
      );
      idempotencyKey.current = crypto.randomUUID();
      navigate(response.statusUrl, { state: { submitted: true } });
    } catch (error) {
      const serverErrors = toFieldErrors(error);
      setErrors(serverErrors);
      setFormError(toFormError(error));
      focusFirstInvalid(serverErrors);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="new-job-title" className="jobs-page">
      <div className="jobs-page__head">
        <div>
          <p className="eyebrow">
            <Link to="/pipelines">Pipelines</Link> / Smart Checkup
          </p>
          <h1 id="new-job-title">Submit an analysis</h1>
          <p>
            Describe the synthetic sample, attach its marker file and submit. You receive a job link
            immediately and can bookmark it.
          </p>
        </div>
        <Button
          disabled={sampleState === 'loading' || submitting}
          onClick={() => void loadSample()}
          variant="secondary"
        >
          {sampleState === 'loading' ? 'Loading sample…' : 'Load sample data'}
        </Button>
      </div>

      <FeedbackMessage tone="info">
        Use synthetic or de-identified training data only. Do not enter names, dates of birth,
        record numbers or any real patient information.
      </FeedbackMessage>

      {sampleState === 'loaded' ? (
        <FeedbackMessage tone="success">
          Sample data loaded. Review the values and file below, then submit when ready.
        </FeedbackMessage>
      ) : null}
      {sampleState === 'error' ? (
        <FeedbackMessage tone="error">
          The sample could not be loaded. Nothing was submitted — try again, or fill in the form and
          attach a file yourself.
        </FeedbackMessage>
      ) : null}
      {sampleState === 'error' ? (
        // US-012 AC4: fallback paths when the guided sample cannot load.
        <nav aria-label="Sample fallback" className="jobs-state__actions">
          <Link className="ui-button ui-button--secondary" to="/pipelines">
            Back to pipelines
          </Link>
          <Link className="ui-button ui-button--ghost" to="/help#smart-checkup">
            Read the guide
          </Link>
        </nav>
      ) : null}
      {formError ? <FeedbackMessage tone="error">{formError}</FeedbackMessage> : null}

      <div className="new-job">
        <form
          aria-label="New analysis"
          className="new-job__form"
          noValidate
          onSubmit={handleSubmit}
        >
          <Input
            error={errors.sampleLabel}
            hint="A short label to recognise this job, for example “Workshop sample 2”."
            id="job-sample-label"
            label="Sample label"
            maxLength={64}
            onChange={(event) => setValues({ ...values, sampleLabel: event.target.value })}
            required
            value={values.sampleLabel}
          />
          <div className="new-job__row">
            <Select
              id="job-age-band"
              label="Age band"
              onChange={(event) =>
                setValues({ ...values, ageBand: event.target.value as FormValues['ageBand'] })
              }
              options={AGE_BANDS.map((value) => ({ label: value, value }))}
              value={values.ageBand}
            />
            <Select
              id="job-focus-area"
              label="Focus area"
              onChange={(event) =>
                setValues({ ...values, focusArea: event.target.value as FormValues['focusArea'] })
              }
              options={FOCUS_AREAS.map((value) => ({ label: humanize(value), value }))}
              value={values.focusArea}
            />
          </div>
          <fieldset className="choice-group">
            <legend>Lifestyle factors (optional)</legend>
            <div className="choice-group__options">
              {LIFESTYLE_FACTORS.map((factor) => (
                <label className="choice" key={factor}>
                  <input
                    checked={values.lifestyleFactors.includes(factor)}
                    onChange={() => toggleFactor(factor)}
                    type="checkbox"
                  />
                  <span>{humanize(factor)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="ui-field">
            <label className="ui-field__label" htmlFor="job-file">
              Marker file (.csv)
            </label>
            <input
              accept=".csv,text/csv"
              aria-describedby={errors.file ? 'job-file-error' : 'job-file-hint'}
              aria-invalid={Boolean(errors.file)}
              className="ui-input ui-file"
              id="job-file"
              onChange={(event) => void handleFileChange(event)}
              type="file"
            />
            {errors.file ? (
              <span className="ui-field__error" id="job-file-error" role="alert">
                {errors.file}
              </span>
            ) : (
              <span className="ui-field__hint" id="job-file-hint">
                {sampleState === 'loaded'
                  ? 'Using the authored sample file. Choose a file to replace it. '
                  : ''}
                UTF-8 CSV, at most {INPUT_FILE_MAX_BYTES / 1024} KB and {INPUT_FILE_MAX_ROWS} rows.
              </span>
            )}
          </div>
          {file ? <FilePreview file={file} /> : null}

          <label className="choice choice--training">
            <input
              checked={values.simulateFailure}
              onChange={(event) => setValues({ ...values, simulateFailure: event.target.checked })}
              type="checkbox"
            />
            <span>
              Simulate a pipeline failure
              <small>
                Training option: the job will finish as Failed so you can see the error view.
              </small>
            </span>
          </label>

          <div className="new-job__actions">
            <Button disabled={submitting} type="submit">
              {submitting ? 'Submitting…' : 'Submit analysis'}
            </Button>
            <Button disabled={submitting} onClick={() => navigate('/pipelines')} variant="ghost">
              Cancel
            </Button>
          </div>
        </form>

        <InputFormat />
      </div>
    </section>
  );
}

function FilePreview({ file }: { file: InputFile }) {
  return (
    <div className="file-preview" aria-live="polite">
      <dl>
        <div>
          <dt>File</dt>
          <dd>{file.name}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(file.preview.sizeBytes)}</dd>
        </div>
        <div>
          <dt>Marker rows</dt>
          <dd>{file.preview.rowCount}</dd>
        </div>
      </dl>
      {file.preview.issues.length > 0 ? (
        <ul className="file-preview__issues">
          {file.preview.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : (
        <p className="file-preview__ok">The file matches the expected layout.</p>
      )}
    </div>
  );
}

function InputFormat() {
  return (
    <aside aria-labelledby="input-format-title" className="input-format">
      <h2 id="input-format-title">Input format</h2>
      <p>
        One header line <code>{INPUT_FILE_HEADER}</code>, then one row per marker. Values are plain
        numbers; each marker appears once and uses its listed unit.
      </p>
      <div
        className="input-format__table"
        role="region"
        aria-label="Supported markers"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Marker</th>
              <th scope="col">Unit</th>
              <th scope="col">Accepted range</th>
            </tr>
          </thead>
          <tbody>
            {INPUT_MARKERS.map((item) => (
              <tr key={item.marker}>
                <td>
                  <code>{item.marker}</code>
                </td>
                <td>{item.unit}</td>
                <td>
                  {item.min}–{item.max}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="input-format__note">
        Ranges are validation limits for synthetic training data, not clinical reference ranges.
      </p>
    </aside>
  );
}

function validate(values: FormValues, file: InputFile | null): FieldErrors {
  const errors: FieldErrors = {};
  const label = values.sampleLabel.trim();

  if (!label) {
    errors.sampleLabel = 'Enter a sample label.';
  } else if (!LABEL_PATTERN.test(label)) {
    errors.sampleLabel = 'Use letters, numbers, spaces, dots, dashes or underscores only.';
  }

  if (!file) {
    errors.file = 'Attach a marker file, or load the sample data.';
  } else if (file.preview.issues.length > 0) {
    errors.file = 'Fix the file issues listed below before submitting.';
  }

  return errors;
}

function toFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiRequestError) || error.code !== 'VALIDATION_FAILED') {
    return {};
  }

  const errors: FieldErrors = {};

  for (const detail of error.details) {
    const field = detail.field ?? '';
    const key = field.startsWith('parameters.')
      ? (field.split('.')[1] as keyof FormValues)
      : 'file';
    errors[key] = errors[key] ? `${errors[key]} ${detail.message}` : detail.message;
  }

  return errors;
}

function toFormError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'VALIDATION_FAILED') {
      return 'The job was not submitted. Correct the highlighted fields and try again.';
    }

    if (error.code === 'SERVICE_UNAVAILABLE') {
      return 'The analysis service is not ready, so the job was not submitted. Try again in a minute.';
    }

    if (error.code === 'RATE_LIMITED') {
      return 'You have reached the submission limit for this hour. Try again later.';
    }

    if (error.code === 'NETWORK_ERROR') {
      return 'The service could not be reached. Your form is kept — submitting again will not create a duplicate job.';
    }
  }

  return 'The job could not be submitted. Submitting again will not create a duplicate job.';
}

function focusFirstInvalid(errors: FieldErrors) {
  const order: [keyof FieldErrors, string][] = [
    ['sampleLabel', 'job-sample-label'],
    ['ageBand', 'job-age-band'],
    ['focusArea', 'job-focus-area'],
    ['file', 'job-file'],
  ];
  const first = order.find(([key]) => errors[key]);

  if (first) {
    window.requestAnimationFrame(() => document.getElementById(first[1])?.focus());
  }
}
