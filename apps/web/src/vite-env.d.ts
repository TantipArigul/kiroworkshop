/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time switch for the Wave 2 mock adapter; real API is used unless exactly "true". */
  readonly VITE_API_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
