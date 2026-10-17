import {
  INPUT_FILE_HEADER,
  INPUT_FILE_MAX_BYTES,
  INPUT_FILE_MAX_ROWS,
  INPUT_MARKERS,
  type SampleInput,
} from '@portal/shared';

/**
 * Authored synthetic sample (US-003): no personal data, served locally, never fetched from a
 * third party. The same values are used by the web mock fixtures and the tests.
 */
export const SAMPLE_INPUT: SampleInput = {
  parameters: {
    sampleLabel: 'Workshop sample A',
    ageBand: '40-49',
    focusArea: 'CARDIOMETABOLIC',
    lifestyleFactors: ['LOW_ACTIVITY'],
    simulateFailure: false,
  },
  file: {
    name: 'smart-checkup-sample.csv',
    content: [
      INPUT_FILE_HEADER,
      'fasting_glucose,108,mg/dL',
      'hba1c,5.9,%',
      'ldl_cholesterol,162,mg/dL',
      'hdl_cholesterol,41,mg/dL',
      'triglycerides,188,mg/dL',
      'systolic_bp,134,mmHg',
      'diastolic_bp,86,mmHg',
      'bmi,27.4,kg/m2',
      'alt,32,U/L',
      'creatinine,0.9,mg/dL',
      '',
    ].join('\n'),
  },
  format: {
    header: INPUT_FILE_HEADER,
    maxBytes: INPUT_FILE_MAX_BYTES,
    maxRows: INPUT_FILE_MAX_ROWS,
    markers: INPUT_MARKERS.map((item) => ({ ...item })),
  },
};
