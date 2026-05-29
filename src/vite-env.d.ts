/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WAVES_URL: string;
  readonly VITE_WAVES_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
