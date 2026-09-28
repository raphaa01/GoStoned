/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOSTONE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
