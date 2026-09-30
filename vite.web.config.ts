// Browser build of the renderer: the interactive web demo published on GitHub Pages.
// Same renderer as the desktop app, with src/web/demoApi.ts in place of the preload
// bridge. `npm run dev:web` serves it, `npm run build:web` writes dist-web/.
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  // Relative asset URLs, so the site works under https://<org>.github.io/<repo>/
  base: './',
  define: {
    'import.meta.env.VITE_WEB_DEMO': JSON.stringify('true')
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
      'pngjs/browser': resolve(__dirname, 'src/renderer/src/stubs/pngjs-browser.js')
    }
  },
  plugins: [react()],
  optimizeDeps: {
    include: ['pdfjs-dist'],
    exclude: ['djvujs-dist']
  },
  server: {
    fs: { allow: [resolve(__dirname)] }
  },
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true
  }
})
