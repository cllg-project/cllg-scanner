import { diffChars } from 'diff'

export type DiffTokens = ReturnType<typeof diffChars>

export function stripXml(text: string): string {
  return text.replace(/<[^>]+>/g, '')
}

/**
 * Returns the byte offset in `original` of the character at `targetStripped`
 * in the XML-stripped version of `original`.
 * Tags are skipped at the TOP of each iteration so we never land on a `<`.
 */
export function strippedToOriginalOffset(original: string, targetStripped: number): number {
  let stripped = 0, orig = 0
  while (orig < original.length) {
    // Skip any XML tags sitting at the current position before counting
    while (orig < original.length && original[orig] === '<') {
      const end = original.indexOf('>', orig)
      orig = end >= 0 ? end + 1 : orig + 1
    }
    if (stripped === targetStripped) break
    stripped++
    orig++
  }
  return orig
}

/** Remove plain-text chars in byte range [origStart, origEnd), keeping XML tags intact. */
export function removeTextInRange(content: string, origStart: number, origEnd: number): string {
  let result = content.slice(0, origStart)
  let pos = origStart
  while (pos < origEnd) {
    if (content[pos] === '<') {
      const end = content.indexOf('>', pos)
      result += content.slice(pos, end >= 0 ? end + 1 : pos + 1)
      pos = end >= 0 ? end + 1 : pos + 1
    } else { pos++ }
  }
  return result + content.slice(origEnd)
}

export interface SuggestionRange {
  origStart: number
  origEnd: number
  tokenIdx: number    // index of the `removed` token in DiffTokens
  removedText: string // plain text Kraken proposes to replace
  addedText: string   // Kraken's replacement (may be empty = pure deletion)
}

/** Compute suggestion ranges in the original (XML-tagged) content. */
export function computeSuggestionRanges(content: string, tokens: DiffTokens): SuggestionRange[] {
  const ranges: SuggestionRange[] = []
  let strippedPos = 0

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.added) continue

    if (t.removed) {
      const origStart = strippedToOriginalOffset(content, strippedPos)
      const origEnd   = strippedToOriginalOffset(content, strippedPos + t.value.length)
      let addedText = ''
      let j = i + 1
      while (j < tokens.length && tokens[j].added) { addedText += tokens[j].value; j++ }
      const wsNorm = (s: string): string => s.replace(/\s+/g, ' ').trim()
      if (wsNorm(t.value) === wsNorm(addedText)) { strippedPos += t.value.length; continue }
      ranges.push({ origStart, origEnd, tokenIdx: i, removedText: t.value, addedText })
    }

    strippedPos += t.value.length
  }

  return ranges
}

/**
 * Apply a suggestion: replace the `removed` token (and consume adjacent `added` tokens)
 * in the XML-tagged content. XML tags inside the removed range are preserved.
 */
export function acceptSuggestion(content: string, tokens: DiffTokens, removedIdx: number): string {
  const token = tokens[removedIdx]
  if (!token.removed) return content

  let strippedStart = 0
  for (let i = 0; i < removedIdx; i++) {
    if (!tokens[i].added) strippedStart += tokens[i].value.length
  }

  const origStart = strippedToOriginalOffset(content, strippedStart)
  const origEnd   = strippedToOriginalOffset(content, strippedStart + token.value.length)

  let addedText = ''
  for (let j = removedIdx + 1; j < tokens.length && tokens[j].added; j++) {
    addedText += tokens[j].value
  }

  const cleaned = removeTextInRange(content, origStart, origEnd)
  return cleaned.slice(0, origStart) + addedText + cleaned.slice(origStart)
}

export function computeDiff(current: string, kraken: string): DiffTokens {
  return diffChars(stripXml(current).normalize('NFKC'), kraken.normalize('NFKC'))
}
