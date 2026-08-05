/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** When 'true', the app uses the in-memory demo backend (see demo.ts). */
  readonly VITE_DEMO?: string;
  /** Optional origin of a real backend, e.g. https://api.example.com. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
