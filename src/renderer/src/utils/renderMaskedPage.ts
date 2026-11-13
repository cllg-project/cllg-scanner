import type { Page } from '@shared/types'
import { maskingPlan } from '@shared/pageMask'

export async function renderMaskedPage(projectDir: string, page: Page): Promise<string> {
  const imgPath = await window.api.joinPaths(projectDir, page.imagePath)
  const dataUrl = await window.api.loadImageAsDataUrl(imgPath)
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const el = new window.Image()
    el.onload = () => res(el)
    el.onerror = rej
    el.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  const { keep, hide } = maskingPlan(page)
  if (keep.length > 0) {
    // Positive selection: only the selected rectangles keep their pixels.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.beginPath()
    for (const r of keep) ctx.rect(r.x, r.y, r.width, r.height)
    ctx.clip()
    ctx.drawImage(img, 0, 0)
    ctx.restore()
  } else {
    ctx.drawImage(img, 0, 0)
  }
  for (const mask of hide) {
    ctx.fillStyle = mask.fill
    ctx.fillRect(mask.x, mask.y, mask.width, mask.height)
  }
  const blob: Blob = await new Promise((res) => canvas.toBlob(res as BlobCallback, 'image/png'))
  const buf = await blob.arrayBuffer()
  return window.api.saveMaskedImage(projectDir, page.n, buf)
}
