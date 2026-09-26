import type { Project, LineGeometry, ManualZoneGroup, Mask, PageStatus } from '@shared/types'
import md2 from '../assets/tour/galien_p2.md?raw'
import md3 from '../assets/tour/galien_p3.md?raw'
import img1 from '../assets/tour/galien_p1.png'
import img2 from '../assets/tour/galien_p2.png'
import img3 from '../assets/tour/galien_p3.png'
// Masks, Kraken line geometry and manual zones of the three pages, from a real project.
import layout from '../assets/tour/galien_demo.json'

export const TOUR_DEMO_ID = '__tour_demo__'

/**
 * Demo project: the first three pages of V. Boudon-Millot & A. Pietrobelli, « Galien
 * ressuscité : édition princeps du texte grec du De propriis placitis », Revue des
 * Études Grecques 118 (2005), p. 168-213, as distributed by Persée under CC BY-NC-ND.
 * The images are the unmodified pages (no-derivatives licence): anything drawn on them
 * in the tour is drawn live by the app.
 *
 *   1. Persée cover — skipped for OCR, kept because it records where the document
 *      comes from and under which licence.
 *   2. Title (head zone), sections 1 and 2; line numbers in the left margin, a running
 *      head and footnotes, all masked.
 *   3. Section 2 continues from page 2 (Continued zone), then section 3.
 */
export const TOUR_IMAGE_URLS = [img1, img2, img3]

const MARKDOWNS: (string | undefined)[] = [undefined, md2, md3]

/** Convert a renderer asset URL to a data URI via fetch (renderer only). */
async function toDataUri(url: string): Promise<string> {
  const blob = await fetch(url).then((r) => r.blob())
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/** Build the tour demo project, pre-fetching page images as data URIs. */
export async function buildTourDemoProject(): Promise<Project> {
  const dataUris = await Promise.all(TOUR_IMAGE_URLS.map(toDataUri))

  return {
    version: 1,
    id: TOUR_DEMO_ID,
    name: 'Galien, De propriis placitis (demo)',
    projectDir: '',
    pages: dataUris.map((uri, i) => {
      const l = layout.pages[i]
      return {
        n: i + 1,
        imagePath: uri,          // data URI — passes through page:loadImage as-is
        masks: l.masks as Mask[],
        status: l.status as PageStatus,
        markdown: MARKDOWNS[i],
        lineGeometry: l.lineGeometry.length ? (l.lineGeometry as LineGeometry[]) : undefined,
        manualZones: l.manualZones.length ? (l.manualZones as ManualZoneGroup[]) : undefined,
      }
    }),
    metadata: {
      title: 'De propriis placitis',
      author: 'Galien',
      edition: 'V. Boudon-Millot, A. Pietrobelli, Revue des Études Grecques 118 (2005), p. 168-213 — doi:10.3406/reg.2005.4610 (Persée, CC BY-NC-ND)',
      language: 'grc',
    },
    // The sections are numbered 1, 2, 3… in the text.
    hierarchy: [
      {
        name: 'section',
        pattern: 'Arabic',
        format: 'Arabic',
        missingFirst: false,
        allowGaps: false,
        isMilestone: false,
        color: '#8b3a2a',
        children: [],
      },
    ],
    bibliography: [
      {
        id: 'galien-reg-2005',
        n: 'Boudon-Millot-Pietrobelli-2005',
        authors: [{ persName: 'Véronique Boudon-Millot' }, { persName: 'Antoine Pietrobelli' }],
        editors: [],
        title: 'Galien ressuscité : édition princeps du texte grec du De propriis placitis',
        titleLevel: 'a',
        publisher: 'Revue des Études Grecques, tome 118',
        date: '2005',
        scopes: [{ unit: 'page', value: '168-213' }],
      },
    ],
    lmConfig: {
      endpoint: 'http://localhost:1234',
      model: '',
      contextLength: 8000,
      temperature: 0,
    },
    ocrEngine: 'kraken',
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
  }
}
