import { useCallback, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import type {
  PipelineDetail,
  PipelineOptionDescriptor,
  RenamefastqKitName,
  RenamefastqOptions,
  RunInputLayout,
} from '@portal/shared';
import {
  FASTQ_EXTENSIONS,
  RENAMEFASTQ_DEFAULT_KIT_NAME,
  RENAMEFASTQ_DEFAULT_Q_SCORE,
  RENAMEFASTQ_KIT_NAMES,
  RENAMEFASTQ_Q_SCORE_MAX,
  RENAMEFASTQ_Q_SCORE_MIN,
  RUN_INPUT_LAYOUTS,
  RUN_INPUT_MAX_BYTES,
  RUN_INPUT_MAX_FASTQ_FILES,
  RUN_NAME_MAX_LENGTH,
  SAMPLE_SHEET_MAX_BYTES,
} from '@portal/shared/constants';
import { checkLaunchRules, isValidSampleName, normalizeRunName } from '@portal/shared/run-input';

import { Button, FeedbackMessage, Input, Select } from '../../components/ui';
import { ApiRequestError } from '../auth/apiClient';
import { useAuth } from '../auth/authContext';
import { formatBytes } from '../jobs/jobsApi';
import {
  buildInputPreview,
  buildSheetPreview,
  fastqPickerAccept,
  relativePathOf,
  type InputPreview,
  type SheetPreview,
} from './inputPreview';
import { buildLaunchFormData, createPipelinesApi, LAYOUT_LABELS } from './pipelinesApi';
import { UploadProgress } from './UploadProgress';

type FieldKey =
  'runName' | 'layout' | 'files' | 'sampleName' | 'sampleSheet' | 'options' | 'qScore';
type FieldErrors = Partial<Record<FieldKey, string>>;
type SheetFile = { content: string; sizeBytes: number };
type UploadState = { loaded: number; total: number };

const LAYOUT_HINTS: Record<RunInputLayout, string> = {
  SINGLE_FILE: 'One .fastq, .fq, .fastq.gz or .fq.gz file.',
  SAMPLE_FOLDER: 'A folder whose FASTQ files all belong to one sample.',
  BARCODE_FOLDERS: 'A folder with barcode01, barcode02, … sub-folders. Needs a sample sheet.',
};
const FIELD_IDS: Record<FieldKey, string> = {
  runName: 'run-name',
  layout: 'run-layout-SINGLE_FILE',
  files: 'run-files',
  sampleName: 'run-sample-name',
  sampleSheet: 'run-sample-sheet',
  options: 'run-demultiplex',
  qScore: 'run-q-score',
};
const FIELD_ORDER: FieldKey[] = [
  'runName',
  'layout',
  'files',
  'sampleName',
  'sampleSheet',
  'options',
  'qScore',
];

/** US-017 launch form for si-lol/wf-renamefastq (design C10). */
export function RenameFastqRunPage({ pipeline }: { pipeline: PipelineDetail }) {
  const { api } = useAuth();
  const pipelinesApi = useMemo(() => createPipelinesApi(api), [api]);
  const navigate = useNavigate();
  const [runName, setRunName] = useState('');
  const [layout, setLayout] = useState<RunInputLayout>('SINGLE_FILE');
  const [files, setFiles] = useState<File[]>([]);
  const [sampleName, setSampleName] = useState('');
  const [sheet, setSheet] = useState<SheetFile | null>(null);
  const [options, setOptions] = useState<RenamefastqOptions>(() => defaultOptions(pipeline));
  const [qScoreText, setQScoreText] = useState(() => String(defaultOptions(pipeline).qScore));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const [upload, setUpload] = useState<UploadState | null>(null);
  // One key per filled-in form: retries reuse it so the server never creates a duplicate run.
  const idempotencyKey = useRef(crypto.randomUUID());
  const submitting = upload !== null;
  const folderMode = layout !== 'SINGLE_FILE';
  const limits = pipeline.limits;
  const maxFiles = limits?.maxFastqFiles ?? RUN_INPUT_MAX_FASTQ_FILES;
  const maxBytes = limits?.maxTotalBytes ?? RUN_INPUT_MAX_BYTES;
  const extensions = limits?.fastqExtensions ?? [...FASTQ_EXTENSIONS];

  const preview = useMemo(
    () =>
      buildInputPreview(
        layout,
        files.map((file) => ({ relativePath: relativePathOf(file), size: file.size })),
      ),
    [files, layout],
  );
  const sheetPreview = useMemo(
    () =>
      sheet && layout === 'BARCODE_FOLDERS'
        ? buildSheetPreview(sheet.content, preview.barcodes)
        : null,
    [layout, preview.barcodes, sheet],
  );

  // `webkitdirectory` is not a typed React prop; the input is re-mounted per layout (key).
  const fileInputRef = useCallback(
    (element: HTMLInputElement | null) => {
      element?.toggleAttribute('webkitdirectory', folderMode);
    },
    [folderMode],
  );

  function clearError(key: FieldKey) {
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function changeLayout(next: RunInputLayout) {
    setLayout(next);
    setFiles([]);
    setSheet(null);
    setErrors((current) => ({
      ...current,
      files: undefined,
      layout: undefined,
      options: undefined,
      sampleName: undefined,
      sampleSheet: undefined,
    }));

    if (next === 'BARCODE_FOLDERS') {
      setOptions((current) => ({ ...current, demultiplex: false }));
    }
  }

  function handleFilesChange(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []));
    clearError('files');
  }

  async function handleSheetChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    clearError('sampleSheet');

    if (!selected) {
      setSheet(null);
      return;
    }

    if (selected.size > SAMPLE_SHEET_MAX_BYTES) {
      setSheet(null);
      setErrors((current) => ({
        ...current,
        sampleSheet: `Choose a sample sheet of at most ${SAMPLE_SHEET_MAX_BYTES / 1024} KB.`,
      }));
      return;
    }

    try {
      setSheet({ content: await selected.text(), sizeBytes: selected.size });
    } catch {
      setSheet(null);
      setErrors((current) => ({
        ...current,
        sampleSheet: 'The sample sheet could not be read. Try again.',
      }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setServerIssues([]);

    const checked = validate({
      layout,
      options,
      preview,
      qScoreText,
      runName,
      sampleName,
      sheet,
      sheetPreview,
    });
    setErrors(checked.errors);

    if (!checked.ok) {
      setFormError('The run was not started. Correct the highlighted fields and try again.');
      focusFirstInvalid(checked.errors);
      return;
    }

    const uploadSet = new Set(preview.uploadPaths);
    const fastqFiles = files
      .map((file) => ({ file, relativePath: relativePathOf(file) }))
      .filter((item) => uploadSet.has(item.relativePath));
    const sheetFile =
      layout === 'BARCODE_FOLDERS' && sheet
        ? new File([sheet.content], 'sample_sheet.csv', { type: 'text/csv' })
        : null;
    const formData = buildLaunchFormData(
      {
        layout,
        options: checked.options,
        runName: checked.runName,
        ...(layout !== 'BARCODE_FOLDERS' && sampleName.trim()
          ? { sampleName: sampleName.trim() }
          : {}),
      },
      sheetFile,
      fastqFiles,
    );

    setUpload({ loaded: 0, total: 0 });

    try {
      const response = await pipelinesApi.launch(
        pipeline.id,
        formData,
        idempotencyKey.current,
        (loaded, total) => setUpload({ loaded, total }),
      );
      idempotencyKey.current = crypto.randomUUID();
      navigate(response.statusUrl, { state: { submitted: true } });
    } catch (error) {
      setUpload(null);
      const mapped = toServerErrors(error);
      setErrors(mapped.errors);
      setServerIssues(mapped.issues);
      setFormError(toFormError(error));
      focusFirstInvalid(mapped.errors);
    }
  }

  const kitDescriptor = descriptorOf(pipeline, 'kitName');
  const kitNames =
    kitDescriptor?.type === 'enum' ? kitDescriptor.values : [...RENAMEFASTQ_KIT_NAMES];

  return (
    <section aria-labelledby="run-title" className="jobs-page">
      <div className="jobs-page__head">
        <div>
          <p className="eyebrow">
            <Link to="/pipelines">Pipelines</Link> / {pipeline.name}
          </p>
          <h1 id="run-title">Launch a run</h1>
          <p>
            {pipeline.name} <code>{pipeline.version}</code> runs locally on this server, one run at
            a time. You get a job link as soon as the upload is accepted.
          </p>
        </div>
      </div>

      <FeedbackMessage tone="info">
        Use test or public FASTQ data only. Do not upload patient data or anything that identifies a
        person. Results are for training and are not a diagnosis.
      </FeedbackMessage>

      {formError ? (
        <FeedbackMessage tone="error">
          {formError}
          {serverIssues.length > 0 ? (
            <ul className="run-form__issues">
              {serverIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </FeedbackMessage>
      ) : null}

      <form aria-labelledby="run-title" className="run-form" noValidate onSubmit={handleSubmit}>
        <fieldset className="run-form__body" disabled={submitting}>
          <div className="run-form__section">
            <h2>Run</h2>
            <Input
              error={errors.runName}
              hint="Shown in your overview. 1–64 letters, numbers, spaces, dots, dashes or underscores; it does not have to be unique."
              id={FIELD_IDS.runName}
              label="Run name"
              maxLength={RUN_NAME_MAX_LENGTH}
              onChange={(event) => {
                setRunName(event.target.value);
                clearError('runName');
              }}
              required
              value={runName}
            />
          </div>

          <div className="run-form__section">
            <h2>Input</h2>
            <fieldset
              aria-describedby={errors.layout ? 'run-layout-error' : undefined}
              className="choice-group"
            >
              <legend>Input type</legend>
              <div className="run-layouts">
                {RUN_INPUT_LAYOUTS.filter((item) => pipeline.inputLayouts.includes(item)).map(
                  (item) => (
                    <label className="choice run-layout" key={item}>
                      <input
                        aria-describedby={`run-layout-${item}-hint`}
                        checked={layout === item}
                        id={`run-layout-${item}`}
                        name="layout"
                        onChange={() => changeLayout(item)}
                        type="radio"
                        value={item}
                      />
                      <span>
                        {LAYOUT_LABELS[item]}
                        <small id={`run-layout-${item}-hint`}>{LAYOUT_HINTS[item]}</small>
                      </span>
                    </label>
                  ),
                )}
              </div>
              {errors.layout ? (
                <span className="ui-field__error" id="run-layout-error" role="alert">
                  {errors.layout}
                </span>
              ) : null}
            </fieldset>

            <div className="ui-field">
              <label className="ui-field__label" htmlFor={FIELD_IDS.files}>
                {folderMode ? 'FASTQ folder' : 'FASTQ file'}
              </label>
              <input
                accept={folderMode ? undefined : fastqPickerAccept(extensions)}
                aria-describedby={errors.files ? 'run-files-error' : 'run-files-hint'}
                aria-invalid={Boolean(errors.files)}
                className="ui-input ui-file"
                id={FIELD_IDS.files}
                key={layout}
                multiple={folderMode}
                onChange={handleFilesChange}
                ref={fileInputRef}
                type="file"
              />
              {errors.files ? (
                <span className="ui-field__error" id="run-files-error" role="alert">
                  {errors.files}
                </span>
              ) : (
                <span className="ui-field__hint" id="run-files-hint">
                  {folderMode
                    ? 'Choose the folder itself; your browser asks to confirm the upload. '
                    : ''}
                  Up to {maxFiles} FASTQ files ({extensions.join(', ')}), {formatBytes(maxBytes)} in
                  total.
                </span>
              )}
            </div>

            {files.length > 0 ? <SelectionPreview layout={layout} preview={preview} /> : null}

            {layout === 'BARCODE_FOLDERS' ? (
              <SampleSheetField
                error={errors.sampleSheet}
                onChange={(event) => void handleSheetChange(event)}
                preview={sheetPreview}
                sheet={sheet}
              />
            ) : (
              <Input
                error={errors.sampleName}
                hint="Optional. Letters, numbers, dashes or underscores only (no spaces), at most 64."
                id={FIELD_IDS.sampleName}
                label="Sample name (optional)"
                maxLength={64}
                onChange={(event) => {
                  setSampleName(event.target.value);
                  clearError('sampleName');
                }}
                value={sampleName}
              />
            )}
          </div>

          <div className="run-form__section">
            <h2>Options</h2>
            <OptionCheckbox
              checked={options.demultiplex}
              descriptor={descriptorOf(pipeline, 'demultiplex')}
              disabled={layout === 'BARCODE_FOLDERS'}
              disabledReason="Barcode folders are already demultiplexed, so this option is turned off."
              error={errors.options}
              fallbackLabel="Demultiplex reads by barcode"
              id={FIELD_IDS.options}
              onChange={(checked) => {
                setOptions((current) => ({ ...current, demultiplex: checked }));
                clearError('options');
              }}
            />
            {options.demultiplex ? (
              <>
                <FeedbackMessage tone="info">
                  Demultiplexing can take around 8 minutes per run on this server.
                </FeedbackMessage>
                <Select
                  id="run-kit-name"
                  label={kitDescriptor?.label ?? 'Barcoding kit'}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      kitName: event.target.value as RenamefastqKitName,
                    }))
                  }
                  options={kitNames.map((value) => ({ label: value, value }))}
                  value={options.kitName}
                />
              </>
            ) : null}
            <OptionCheckbox
              checked={options.qualityFilter}
              descriptor={descriptorOf(pipeline, 'qualityFilter')}
              fallbackLabel="Quality filter"
              id="run-quality-filter"
              onChange={(checked) =>
                setOptions((current) => ({ ...current, qualityFilter: checked }))
              }
            />
            <Input
              error={errors.qScore}
              hint={`${descriptorOf(pipeline, 'qScore')?.description ?? 'Minimum read quality.'} Whole number from ${RENAMEFASTQ_Q_SCORE_MIN} to ${RENAMEFASTQ_Q_SCORE_MAX}.`}
              id={FIELD_IDS.qScore}
              inputMode="numeric"
              label={descriptorOf(pipeline, 'qScore')?.label ?? 'Minimum Q-score'}
              max={RENAMEFASTQ_Q_SCORE_MAX}
              min={RENAMEFASTQ_Q_SCORE_MIN}
              onChange={(event) => {
                setQScoreText(event.target.value);
                clearError('qScore');
              }}
              step={1}
              type="number"
              value={qScoreText}
            />
          </div>

          {upload ? <UploadProgress loaded={upload.loaded} total={upload.total} /> : null}

          <div className="new-job__actions">
            <Button type="submit">{submitting ? 'Uploading…' : 'Start run'}</Button>
            <Button onClick={() => navigate('/pipelines')} variant="ghost">
              Cancel
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function SelectionPreview({ layout, preview }: { layout: RunInputLayout; preview: InputPreview }) {
  return (
    <div aria-live="polite" className="file-preview">
      <dl>
        <div>
          <dt>Detected input type</dt>
          <dd>
            {preview.detectedLayout ? LAYOUT_LABELS[preview.detectedLayout] : 'Not recognised'}
          </dd>
        </div>
        <div>
          <dt>FASTQ files to upload</dt>
          <dd>{preview.fileCount}</dd>
        </div>
        <div>
          <dt>Total size</dt>
          <dd>{formatBytes(preview.totalBytes)}</dd>
        </div>
        {layout === 'BARCODE_FOLDERS' ? (
          <div>
            <dt>Barcodes</dt>
            <dd>{preview.barcodes.length > 0 ? preview.barcodes.join(', ') : 'None found'}</dd>
          </div>
        ) : null}
      </dl>
      {preview.skippedCount > 0 ? (
        <p className="file-preview__note">
          {preview.skippedCount} file{preview.skippedCount === 1 ? ' is' : 's are'} not FASTQ and
          will not be uploaded.
        </p>
      ) : null}
      {preview.ignoredCount > 0 ? (
        <p className="file-preview__note">
          {preview.ignoredCount} file{preview.ignoredCount === 1 ? '' : 's'} in{' '}
          <code>unclassified</code> {preview.ignoredCount === 1 ? 'is' : 'are'} ignored by the
          pipeline and will not be uploaded.
        </p>
      ) : null}
      {preview.issues.length > 0 ? (
        <ul className="file-preview__issues">
          {preview.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : (
        <p className="file-preview__ok">The selection matches the chosen input type.</p>
      )}
    </div>
  );
}

function SampleSheetField({
  error,
  onChange,
  preview,
  sheet,
}: {
  error: string | undefined;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  preview: SheetPreview | null;
  sheet: SheetFile | null;
}) {
  return (
    <>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={FIELD_IDS.sampleSheet}>
          Sample sheet (.csv)
        </label>
        <input
          accept=".csv,text/csv"
          aria-describedby={error ? 'run-sample-sheet-error' : 'run-sample-sheet-hint'}
          aria-invalid={Boolean(error)}
          className="ui-input ui-file"
          id={FIELD_IDS.sampleSheet}
          onChange={onChange}
          required
          type="file"
        />
        {error ? (
          <span className="ui-field__error" id="run-sample-sheet-error" role="alert">
            {error}
          </span>
        ) : (
          <span className="ui-field__hint" id="run-sample-sheet-hint">
            Header <code>barcode,alias</code>, then one line per barcode folder. Aliases use
            letters, numbers, dashes or underscores. At most {SAMPLE_SHEET_MAX_BYTES / 1024} KB.
          </span>
        )}
      </div>
      {sheet && preview ? <SheetMatch preview={preview} sizeBytes={sheet.sizeBytes} /> : null}
    </>
  );
}

function SheetMatch({ preview, sizeBytes }: { preview: SheetPreview; sizeBytes: number }) {
  if (preview.issues.length > 0) {
    return (
      <div aria-live="polite" className="file-preview">
        <p className="file-preview__note">Sample sheet · {formatBytes(sizeBytes)}</p>
        <ul className="file-preview__issues">
          {preview.issues.map((issue) => (
            <li key={`${issue.code}-${issue.line ?? 0}`}>
              {issue.line ? `Line ${issue.line}: ` : ''}
              {issue.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const match = preview.match;
  const unlisted = match?.unlistedFolders ?? [];
  const missing = new Set(match?.missingFolders ?? []);

  return (
    <div aria-live="polite" className="file-preview">
      <p className="file-preview__note">
        Sample sheet · {preview.rows.length} sample{preview.rows.length === 1 ? '' : 's'} ·{' '}
        {formatBytes(sizeBytes)}
      </p>
      <div
        aria-label="Sample sheet matching"
        className="run-sheet-table"
        role="region"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Barcode</th>
              <th scope="col">Alias</th>
              <th scope="col">Folder</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.barcode}>
                <td>
                  <code>{row.barcode}</code>
                </td>
                <td>{row.alias}</td>
                <td>
                  {match === null ? (
                    <span className="run-match">Select the folder to compare</span>
                  ) : (
                    <MatchStatus ok={!missing.has(row.barcode)} />
                  )}
                </td>
              </tr>
            ))}
            {unlisted.map((barcode) => (
              <tr key={`unlisted-${barcode}`}>
                <td>
                  <code>{barcode}</code>
                </td>
                <td>Not in the sheet</td>
                <td>
                  <MatchStatus ok={false} label="Folder not listed" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {match === null ? null : match.ok ? (
        <p className="file-preview__ok">Every barcode folder has exactly one line in the sheet.</p>
      ) : (
        <p className="file-preview__issues">
          The sheet and the barcode folders must list the same barcodes. Fix the rows marked above.
        </p>
      )}
    </div>
  );
}

/** Label + icon + colour, never colour alone. */
function MatchStatus({ label, ok }: { label?: string; ok: boolean }) {
  return (
    <span className={`ui-status ${ok ? 'ui-status--completed' : 'ui-status--failed'}`}>
      <svg aria-hidden="true" className="ui-status__icon" viewBox="0 0 24 24">
        {ok ? <path d="m5 12 4 4L19 6" /> : <path d="M6 6l12 12M18 6 6 18" />}
      </svg>
      <span>{label ?? (ok ? 'Folder found' : 'No matching folder')}</span>
    </span>
  );
}

function OptionCheckbox({
  checked,
  descriptor,
  disabled = false,
  disabledReason,
  error,
  fallbackLabel,
  id,
  onChange,
}: {
  checked: boolean;
  descriptor: PipelineOptionDescriptor | undefined;
  disabled?: boolean;
  disabledReason?: string;
  error?: string | undefined;
  fallbackLabel: string;
  id: string;
  onChange: (checked: boolean) => void;
}) {
  const hintId = `${id}-hint`;
  const hint = disabled && disabledReason ? disabledReason : descriptor?.description;

  return (
    <div className="run-option">
      <label className="choice">
        <input
          aria-describedby={hint || error ? hintId : undefined}
          aria-invalid={Boolean(error)}
          checked={checked}
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span>{descriptor?.label ?? fallbackLabel}</span>
      </label>
      {error ? (
        <span className="ui-field__error" id={hintId} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="ui-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function descriptorOf(pipeline: PipelineDetail, key: string) {
  return pipeline.options.find((option) => option.key === key);
}

/** Pipeline defaults from the registry descriptors, falling back to the shared constants. */
function defaultOptions(pipeline: PipelineDetail): RenamefastqOptions {
  const value = (key: string) => descriptorOf(pipeline, key)?.default;
  const kitName = value('kitName');
  const qScore = value('qScore');
  const demultiplex = value('demultiplex');
  const qualityFilter = value('qualityFilter');

  return {
    demultiplex: typeof demultiplex === 'boolean' ? demultiplex : false,
    kitName: (RENAMEFASTQ_KIT_NAMES as readonly string[]).includes(String(kitName))
      ? (kitName as RenamefastqKitName)
      : RENAMEFASTQ_DEFAULT_KIT_NAME,
    qualityFilter: typeof qualityFilter === 'boolean' ? qualityFilter : true,
    qScore: typeof qScore === 'number' ? qScore : RENAMEFASTQ_DEFAULT_Q_SCORE,
  };
}

type ValidationInput = {
  layout: RunInputLayout;
  options: RenamefastqOptions;
  preview: InputPreview;
  qScoreText: string;
  runName: string;
  sampleName: string;
  sheet: SheetFile | null;
  sheetPreview: SheetPreview | null;
};

/** Client checks with the shared rules (C4); the API repeats them authoritatively. */
function validate(
  input: ValidationInput,
):
  | { ok: true; errors: FieldErrors; runName: string; options: RenamefastqOptions }
  | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const runName = normalizeRunName(input.runName);
  const trimmedSample = input.sampleName.trim();
  const qScore = Number(input.qScoreText);

  if (!runName) {
    errors.runName = input.runName.trim()
      ? 'Use 1–64 letters, numbers, spaces, dots, dashes or underscores.'
      : 'Enter a run name.';
  }

  if (input.preview.fileCount === 0 && input.preview.issues.length === 0) {
    errors.files =
      input.layout === 'SINGLE_FILE' ? 'Choose a FASTQ file.' : 'Choose a folder with FASTQ files.';
  } else if (input.preview.issues.length > 0) {
    errors.files = input.preview.issues.join(' ');
  }

  if (input.layout !== 'BARCODE_FOLDERS' && trimmedSample && !isValidSampleName(trimmedSample)) {
    errors.sampleName = 'Use letters, numbers, dashes or underscores only (no spaces), at most 64.';
  }

  for (const issue of checkLaunchRules({
    demultiplex: input.options.demultiplex,
    hasSampleSheet: input.layout === 'BARCODE_FOLDERS' && input.sheet !== null,
    layout: input.layout,
    sampleName: input.layout === 'BARCODE_FOLDERS' ? null : trimmedSample || null,
  })) {
    const key: FieldKey = issue.field === 'options.demultiplex' ? 'options' : issue.field;
    errors[key] ??= issue.message;
  }

  if (input.layout === 'BARCODE_FOLDERS' && input.sheetPreview && !errors.sampleSheet) {
    if (input.sheetPreview.issues.length > 0) {
      errors.sampleSheet = 'Fix the sample sheet lines listed below.';
    } else if (input.sheetPreview.match && !input.sheetPreview.match.ok) {
      errors.sampleSheet = 'The sheet must list exactly the barcode folders you selected.';
    }
  }

  if (
    !Number.isInteger(qScore) ||
    input.qScoreText.trim() === '' ||
    qScore < RENAMEFASTQ_Q_SCORE_MIN ||
    qScore > RENAMEFASTQ_Q_SCORE_MAX
  ) {
    errors.qScore = `Enter a whole number from ${RENAMEFASTQ_Q_SCORE_MIN} to ${RENAMEFASTQ_Q_SCORE_MAX}.`;
  }

  if (Object.values(errors).some(Boolean) || !runName) {
    return { errors, ok: false };
  }

  return {
    errors,
    ok: true,
    options: {
      ...input.options,
      demultiplex: input.layout === 'BARCODE_FOLDERS' ? false : input.options.demultiplex,
      qScore,
    },
    runName,
  };
}

/** Maps `400 VALIDATION_FAILED` details (design API table) onto the form fields. */
function toServerErrors(error: unknown): { errors: FieldErrors; issues: string[] } {
  if (!(error instanceof ApiRequestError) || error.code !== 'VALIDATION_FAILED') {
    return { errors: {}, issues: [] };
  }

  const errors: FieldErrors = {};
  const issues: string[] = [];

  for (const detail of error.details) {
    const field = detail.field ?? '';
    const line = /^sampleSheet\.line (\d+)$/.exec(field)?.[1];
    const key: FieldKey = field.startsWith('runName')
      ? 'runName'
      : field.startsWith('layout')
        ? 'layout'
        : field.startsWith('sampleName')
          ? 'sampleName'
          : field.startsWith('sampleSheet')
            ? 'sampleSheet'
            : field.startsWith('options')
              ? 'options'
              : 'files';
    const message = line ? `Sample sheet line ${line}: ${detail.message}` : detail.message;

    errors[key] = errors[key] ? `${errors[key]} ${message}` : message;
    issues.push(message);
  }

  return { errors, issues };
}

function toFormError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'VALIDATION_FAILED':
        return 'The run was not started and nothing was kept. Correct the highlighted fields and try again.';
      case 'SERVICE_UNAVAILABLE':
        return 'This pipeline is not available on the server right now, so the run was not started. Try again later or ask an administrator.';
      case 'RATE_LIMITED':
        return 'You have reached the submission limit for this hour. Try again later.';
      case 'NOT_FOUND':
        return 'This pipeline is no longer in the catalog. Return to the pipelines list.';
      case 'NETWORK_ERROR':
        return 'The upload could not reach the service. Your selections are kept — starting again will not create a duplicate run.';
      default:
        break;
    }
  }

  return 'The run could not be started. Starting again will not create a duplicate run.';
}

function focusFirstInvalid(errors: FieldErrors) {
  const first = FIELD_ORDER.find((key) => errors[key]);

  if (first) {
    window.requestAnimationFrame(() => document.getElementById(FIELD_IDS[first])?.focus());
  }
}
