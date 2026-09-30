/// <reference types="vite/client" />

import type { ElectronAPI } from '../../preload'

declare global {
  interface Window {
    api: ElectronAPI
  }

  interface ImportMetaEnv {
    /** 'true' in the web demo build (vite.web.config.ts) */
    readonly VITE_WEB_DEMO?: string
  }
}
