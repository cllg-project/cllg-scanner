/// <reference types="vite/client" />

import type { Project, LMConfig, LMTestResult, OCRProgressEvent, TEIParams } from '@shared/types'

declare global {
  interface Window {
    api: {
      newProject: (pdfPath: string, projectDir: string) => Promise<Project>
      openProject: () => Promise<Project | null>
      saveProject: (project: Project) => Promise<void>
      getRecentProjects: () => Promise<Project[]>
      removeRecentProject: (projectId: string) => Promise<void>
      selectPDF: () => Promise<string | null>
      selectDocument: () => Promise<string | null>
      selectImageDir: () => Promise<string | null>
      listImagesInDir: (dirPath: string) => Promise<{ name: string; path: string }[]>
      copyImageToProject: (srcPath: string, projectDir: string, pageNum: number) => Promise<string>
      selectProjectDir: () => Promise<string | null>
      savePageImage: (projectDir: string, pageNum: number, data: ArrayBuffer) => Promise<string>
      saveMaskedImage: (projectDir: string, pageNum: number, data: ArrayBuffer) => Promise<string>
      loadImageAsDataUrl: (absolutePath: string) => Promise<string>
      testLMStudio: (endpoint: string, apiKey?: string) => Promise<LMTestResult>
      runOCR: (projectDir: string, pages: Project['pages'], lmConfig: LMConfig) => Promise<void>
      stopOCR: () => Promise<void>
      generateTEI: (params: TEIParams) => Promise<void>
      openInFinder: (path: string) => void
      selectSaveFile: (defaultName: string, ext: string) => Promise<string | null>
      loadPDFData: (filePath: string) => Promise<Uint8Array>
      exportCOCO: (project: Project) => Promise<void>
      loadOCROutput: (projectDir: string) => Promise<string>
      reloadProject: (projectDir: string) => Promise<Project>
      loadMarkdown: (projectDir: string, pageN: number) => Promise<string>
      saveMarkdown: (projectDir: string, pageN: number, content: string) => Promise<void>
      onOCRProgress: (cb: (e: OCRProgressEvent) => void) => () => void
      onTEILog: (cb: (line: string) => void) => () => void
      onPDFProgress: (cb: (current: number, total: number) => void) => () => void
    }
  }
}
