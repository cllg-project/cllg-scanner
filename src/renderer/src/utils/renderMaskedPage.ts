import type { Page } from '@shared/types'

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
  ctx.drawImage(img, 0, 0)
  for (const mask of page.masks) {
    ctx.fillStyle = mask.fill
    ctx.fillRect(mask.x, mask.y, mask.width, mask.height)
  }
  const blob: Blob = await new Promise((res) => canvas.toBlob(res as BlobCallback, 'image/png'))
  const buf = await blob.arrayBuffer()
  return window.api.saveMaskedImage(projectDir, page.n, buf)
}
