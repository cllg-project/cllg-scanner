// Imported before the renderer, so `window.api` exists before any component runs.
import { demoApi } from './demoApi'

window.api = demoApi
