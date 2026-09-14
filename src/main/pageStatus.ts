import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Project, LineGeometry } from '@shared/types'

export async function persistPageStatus(
  projectDir: string,
  pageN: number,
  status: 'ocr_done' | 'error',
  stats?: { tokens?: number; elapsedMs?: number }
): Promise<void> {
  const projectFile = join(projectDir, 'project.cllg.json')
  try {
    const raw = await readFile(projectFile, 'utf-8')
    const project: Project = JSON.parse(raw)
    const page = project.pages.find((p) => p.n === pageN)
    if (page) {
      page.status = status
      if (stats?.tokens != null) page.tokens = stats.tokens
      if (stats?.elapsedMs != null) page.elapsedMs = stats.elapsedMs
    }
    await writeFile(projectFile, JSON.stringify(project, null, 2), 'utf-8')
  } catch { /* non-fatal */ }
}

// Persists line geometry for a page, only if it doesn't already have any —
// ALTO-imported geometry (or a page's first Kraken segmentation pass) stays
// authoritative and immutable across reprocessing, matching the archival intent
// of keeping original machine/segmentation output around for later use.
export async function persistPageGeometry(
  projectDir: string,
  pageN: number,
  geometry: LineGeometry[]
): Promise<void> {
  const projectFile = join(projectDir, 'project.cllg.json')
  try {
    const raw = await readFile(projectFile, 'utf-8')
    const project: Project = JSON.parse(raw)
    const page = project.pages.find((p) => p.n === pageN)
    if (page && !page.lineGeometry?.length) {
      page.lineGeometry = geometry
    }
    await writeFile(projectFile, JSON.stringify(project, null, 2), 'utf-8')
  } catch { /* non-fatal */ }
}
