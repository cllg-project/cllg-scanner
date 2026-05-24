import { ipcMain, BrowserWindow } from 'electron'
import { readFile, writeFile, appendFile } from 'fs/promises'
import { mkdirSync, existsSync } from 'fs'
import { join, isAbsolute } from 'path'
import type { Page, LMConfig, OCRProgressEvent, Project } from '@shared/types'

async function persistPageStatus(projectDir: string, pageN: number, status: 'ocr_done' | 'error'): Promise<void> {
  const projectFile = join(projectDir, 'project.cllg.json')
  try {
    const raw = await readFile(projectFile, 'utf-8')
    const project: Project = JSON.parse(raw)
    const page = project.pages.find((p) => p.n === pageN)
    if (page) page.status = status
    await writeFile(projectFile, JSON.stringify(project, null, 2), 'utf-8')
  } catch { /* non-fatal */ }
}

// Ported verbatim from cllg_pipeline.py
const OCR_PROMPT = `You are an OCR system for ancient Greek and Latin printed scholarly texts.

Transcribe the page exactly in pseudo-Markdown.

RULES:
- Copy text exactly: keep all characters, accents, ligatures, punctuation, spacing.
- Do NOT normalize, correct, or translate.
- Follow visual reading order.
- Each paragraph = ONE line.
- Add <tab/> at the start of paragraphs that clearly begin on this page.
- Do NOT add <tab/> if the paragraph continues from a previous page.
- Join words split by line-break hyphens.
- Wrap section markers as <ref>X</ref>.
- Major headers: # <ref>X</ref> or # <ref>X</ref> TITLE
- Standalone title: # TITLE
- Inline section markers and section markers in the margin are encoded inline.
- Margin notes: <note>TEXT</note>.
- Ignore running heads, footers, page numbers, line numbers, printer marks, footnote markers.

Output ONLY the transcription.`

// Faithful port of patch_output() from cllg_pipeline.py — EM dash kept as-is.
function normalizeHyphenAndElision(text: string): string {
  text = text.replace(/[`´‘’ʼʹ]/g, "'")
  text = text.replace(/[‐‑‒–−﹘﹣－]/g, '-')
  text = text.replace(/(?<=\w)-\s+(?=[^\W\d_])/g, '')
  return text
}

const LEFT_ANGLES  = /[‹〈《⟨＜❨❬❰⧼]/g
const RIGHT_ANGLES = /[›〉》⟩＞❩❭❱⧽]/g

function normalizeAngleBrackets(text: string): string {
  const tags: string[] = []
  text = text.replace(/<\/?[^>]+?>/g, (m) => { tags.push(m); return `@@TAG${tags.length - 1}@@` })
  text = text.replace(LEFT_ANGLES, '\u27e8').replace(RIGHT_ANGLES, '\u27e9')
  text = text.replace(/@@TAG(\d+)@@/g, (_, i) => tags[Number(i)])
  return text
}

function patchOutput(text: string): string {
  return normalizeAngleBrackets(normalizeHyphenAndElision(text)).trim()
}

let abortOCR = false

export function registerOCRHandlers(): void {
  ipcMain.handle('ocr:stop', async () => {
    abortOCR = true
  })

  ipcMain.handle(
    'ocr:test',
    async (_event, endpoint: string, apiKey?: string): Promise<{ ok: boolean; latencyMs: number; models?: string[]; error?: string }> => {
      const start = Date.now()
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        const res = await fetch(`${endpoint}/api/v1/models`, { headers, signal: AbortSignal.timeout(5000) })
        const latencyMs = Date.now() - start
        if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` }
        const data = await res.json().catch(() => ({}))
        // LM Studio native API uses { models: [{ key }] }; OpenAI-compat uses { data: [{ id }] }
        const list: { key?: string; id?: string }[] = data.models ?? data.data ?? []
        const models: string[] = list.map((m) => m.key ?? m.id ?? '').filter(Boolean)
        return { ok: true, latencyMs, models }
      } catch (err: unknown) {
        return { ok: false, latencyMs: Date.now() - start, error: String(err) }
      }
    }
  )

  ipcMain.handle(
    'ocr:run',
    async (event, projectDir: string, pages: Page[], lmConfig: LMConfig): Promise<void> => {
      abortOCR = false
      const win = BrowserWindow.fromWebContents(event.sender)
      const mdPath = join(projectDir, 'ocr_output.md')

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (lmConfig.apiKey) headers['Authorization'] = `Bearer ${lmConfig.apiKey}`

      const prompt = lmConfig.promptTemplate ?? OCR_PROMPT

      const cacheDir = join(projectDir, 'pages')
      mkdirSync(cacheDir, { recursive: true })

      for (const page of pages) {
        if (abortOCR) break
        if (page.status === 'skipped') {
          win?.webContents.send('ocr:progress', {
            pageNum: page.n,
            status: 'skipped'
          } satisfies OCRProgressEvent)
          continue
        }

        // Per-page cache: skip API call if already processed
        const cachePath = join(cacheDir, `page_${String(page.n).padStart(4, '0')}.md`)
        if (existsSync(cachePath)) {
          const cached = await readFile(cachePath, 'utf-8')
          await appendFile(mdPath, cached, 'utf-8')
          win?.webContents.send('ocr:progress', {
            pageNum: page.n,
            status: 'done',
            fromCache: true
          } satisfies OCRProgressEvent)
          continue
        }

        const resolve = (p: string): string => isAbsolute(p) ? p : join(projectDir, p)
        const imgPath = page.maskedImagePath ? resolve(page.maskedImagePath) : resolve(page.imagePath)

        if (!existsSync(imgPath)) {
          win?.webContents.send('ocr:progress', {
            pageNum: page.n,
            status: 'error',
            errorMessage: `Image not found: ${imgPath}`
          } satisfies OCRProgressEvent)
          continue
        }

        win?.webContents.send('ocr:progress', {
          pageNum: page.n,
          status: 'started'
        } satisfies OCRProgressEvent)

        const t0 = Date.now()
        try {
          const imageData = await readFile(imgPath)
          const base64 = imageData.toString('base64')
          const dataUrl = `data:image/png;base64,${base64}`

          const body = {
            model: lmConfig.model,
            input: [
              { type: 'image', data_url: dataUrl },
              { type: 'text', content: prompt }
            ],
            context_length: lmConfig.contextLength,
            temperature: lmConfig.temperature
          }

          const res = await fetch(`${lmConfig.endpoint}/api/v1/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(600_000)
          })

          if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)

          const data = await res.json()
          // LM Studio native: { output: [{ type:"message", content:"..." }], stats: { total_output_tokens } }
          // OpenAI-compat:    { choices: [{ message: { content:"..." } }] }
          const raw: string =
            data.output?.find((o: { type: string }) => o.type === 'message')?.content
            ?? data.choices?.[0]?.message?.content
            ?? data.content
            ?? ''
          const tokens: number =
            data.stats?.total_output_tokens
            ?? data.usage?.completion_tokens
            ?? raw.split(/\s+/).length
          const text = patchOutput(raw)
          const pageMarkdown = `<pb n="${page.n}"/>\n${text}\n\n`

          // Write per-page cache before appending to combined output
          await writeFile(cachePath, pageMarkdown, 'utf-8')
          await appendFile(mdPath, pageMarkdown, 'utf-8')
          await persistPageStatus(projectDir, page.n, 'ocr_done')

          win?.webContents.send('ocr:progress', {
            pageNum: page.n,
            status: 'done',
            tokens,
            elapsedMs: Date.now() - t0
          } satisfies OCRProgressEvent)
        } catch (err: unknown) {
          await persistPageStatus(projectDir, page.n, 'error')
          win?.webContents.send('ocr:progress', {
            pageNum: page.n,
            status: 'error',
            elapsedMs: Date.now() - t0,
            errorMessage: String(err)
          } satisfies OCRProgressEvent)
        }
      }
    }
  )
}
