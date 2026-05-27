import type { Project } from '@shared/types'
import md127 from '../assets/tour/bnf_p127.md?raw'
import md128 from '../assets/tour/bnf_p128.md?raw'
import md129 from '../assets/tour/bnf_p129.md?raw'
import md130 from '../assets/tour/bnf_p130.md?raw'
import md131 from '../assets/tour/bnf_p131.md?raw'
import img127 from '../assets/tour/bnf_p127.png'
import img128 from '../assets/tour/bnf_p128.png'
import img129 from '../assets/tour/bnf_p129.png'
import img130 from '../assets/tour/bnf_p130.png'
import img131 from '../assets/tour/bnf_p131.png'

export const TOUR_DEMO_ID = '__tour_demo__'

/** Vite asset URLs for the 5 BNF pages (in renderer-relative form) */
export const TOUR_IMAGE_URLS = [img127, img128, img129, img130, img131]

const MARKDOWNS = [md127, md128, md129, md130, md131]

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
    name: 'Discours funèbres — BNF (demo)',
    projectDir: '',
    pages: dataUris.map((uri, i) => ({
      n: i + 1,
      imagePath: uri,          // data URI — passes through page:loadImage as-is
      masks: [],
      status: 'ocr_done' as const,
      isExample: i < 2,
      markdown: MARKDOWNS[i],
    })),
    metadata: {
      title: 'Discours funèbres',
      author: 'Grégoire de Nazianze',
      edition: 'BNF Gallica bpt6k5453852r',
      language: 'grc',
    },
    hierarchy: [
      {
        name: 'discourse',
        pattern: 'Roman',
        format: 'Roman',
        missingFirst: false,
        allowGaps: false,
        isMilestone: false,
        color: '#8b3a2a',
        children: [
          {
            name: 'section',
            pattern: '\\d+',
            format: 'Arabic',
            missingFirst: false,
            allowGaps: false,
            isMilestone: false,
            color: '#3a5a8b',
            children: [],
          },
        ],
      },
    ],
    bibliography: [],
    lmConfig: {
      endpoint: 'http://localhost:1234',
      model: 'qwen3vl-8b',
      contextLength: 8000,
      temperature: 0,
    },
    createdAt: '2025-05-27T00:00:00.000Z',
    updatedAt: '2025-05-27T00:00:00.000Z',
  }
}
