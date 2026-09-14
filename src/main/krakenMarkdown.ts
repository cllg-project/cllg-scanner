/**
 * Build a page's markdown cache-file content from Kraken's recognized lines,
 * matching the exact `<pb n="N"/>\n...\n\n` convention `ocr.ts` writes for
 * LM Studio output, so both engines produce interchangeable cache files.
 */
export function krakenLinesToPageMarkdown(pageN: number, lines: { text: string }[]): string {
  const body = lines.map((l) => l.text).join('\n')
  return `<pb n="${pageN}"/>\n${body}\n\n`
}
