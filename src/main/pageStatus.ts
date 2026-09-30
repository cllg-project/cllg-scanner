import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Project, LineGeometry, PageZone } from '@shared/types'

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
// `replace` overwrites existing Kraken geometry (a page re-OCRed from scratch, or a
// Kraken step run on it), never ALTO geometry.
export async function persistPageGeometry(
  projectDir: string,
  pageN: number,
  geometry: LineGeometry[],
  opts: { replace?: boolean } = {}
): Promise<void> {
  await updateProjectPage(projectDir, pageN, (page) => {
    const existing = page.lineGeometry ?? []
    const fromAlto = existing.some((l) => l.source === 'alto')
    if (!existing.length || (opts.replace && !fromAlto)) page.lineGeometry = geometry
  })
}

// Persists a page's zones (detected and hand-drawn), replacing the previous ones.
export async function persistPageZones(projectDir: string, pageN: number, zones: PageZone[]): Promise<void> {
  await updateProjectPage(projectDir, pageN, (page) => {
    page.zones = zones
    delete page.manualZones
  })
}

async function updateProjectPage(
  projectDir: string,
  pageN: number,
  update: (page: Project['pages'][number]) => void
): Promise<void> {
  const projectFile = join(projectDir, 'project.cllg.json')
  try {
    const raw = await readFile(projectFile, 'utf-8')
    const project: Project = JSON.parse(raw)
    const page = project.pages.find((p) => p.n === pageN)
    if (page) update(page)
    await writeFile(projectFile, JSON.stringify(project, null, 2), 'utf-8')
  } catch { /* non-fatal */ }
}
