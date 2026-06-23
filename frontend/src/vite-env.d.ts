/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** When `true`, apply production sidebar section filters during `vite` dev (see `settingsSectionProduction.ts`). */
  readonly VITE_PREVIEW_PRODUCTION_SETTINGS_SIDEBAR?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
