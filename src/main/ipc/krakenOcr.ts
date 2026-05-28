import { ipcMain, app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'

const BUILTIN_SEG = 'segmentation.js_mlmodel'
const BUILTIN_REC = 'model_best.js_mlmodel'

function modelsDir(): string {
  return is.dev
    ? join(app.getAppPath(), 'resources', 'models')
    : join(process.resourcesPath, 'models')
}

// Cache the pipeline so ONNX models are not reloaded on every call
let cachedPipeline: { segPath: string; recPath: string; pipeline: unknown } | null = null

export function registerKrakenHandlers(): void {
  ipcMain.handle('kraken:getBuiltinPaths', () => ({
    segModelPath: join(modelsDir(), BUILTIN_SEG),
    recModelPath: join(modelsDir(), BUILTIN_REC),
  }))

  ipcMain.handle(
    'kraken:rerun-page',
    async (
      _event,
      imagePath: string,
      segModelPath: string,
      recModelPath: string
    ): Promise<{ text: string; lines: { text: string; corners: [number, number][] }[] }> => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { KrakenPipeline } = require('kraken-js') as {
        KrakenPipeline: {
          create: (s: string, r: string) => Promise<{
            process: (img: string) => Promise<{ text: string; obb: { corners: [number, number][] } }[]>
          }>
        }
      }

      if (
        !cachedPipeline ||
        cachedPipeline.segPath !== segModelPath ||
        cachedPipeline.recPath !== recModelPath
      ) {
        cachedPipeline = {
          segPath: segModelPath,
          recPath: recModelPath,
          pipeline: await KrakenPipeline.create(segModelPath, recModelPath),
        }
      }

      const pipeline = cachedPipeline.pipeline as {
        process: (img: string) => Promise<{ text: string; obb: { corners: [number, number][] } }[]>
      }
      const rawLines = await pipeline.process(imagePath)
      const lines = rawLines.map((l) => ({ text: l.text, corners: l.obb.corners }))
      const text = lines.map((l) => l.text).join('\n')
      return { text, lines }
    }
  )
}
