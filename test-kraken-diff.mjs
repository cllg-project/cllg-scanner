// Run with: node test-kraken-diff.mjs
// Tests krakenDiff utilities against the real sample texts.

import { diffChars } from 'diff'

// ── replicate the utilities (identical to krakenDiff.ts) ──────────────────

function stripXml(text) {
  return text.replace(/<[^>]+>/g, '')
}

function strippedToOriginalOffset(original, targetStripped) {
  let stripped = 0, orig = 0
  while (orig < original.length) {
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

function removeTextInRange(content, origStart, origEnd) {
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

function computeSuggestionRanges(content, tokens) {
  const ranges = []
  let strippedPos = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.added) continue
    if (t.removed) {
      const origStart = strippedToOriginalOffset(content, strippedPos)
      const origEnd   = strippedToOriginalOffset(content, strippedPos + t.value.length)
      let addedText = '', j = i + 1
      while (j < tokens.length && tokens[j].added) { addedText += tokens[j].value; j++ }
      ranges.push({ origStart, origEnd, tokenIdx: i, removedText: t.value, addedText })
    }
    strippedPos += t.value.length
  }
  return ranges
}

function acceptSuggestion(content, tokens, removedIdx) {
  const token = tokens[removedIdx]
  if (!token.removed) return content
  let strippedStart = 0
  for (let i = 0; i < removedIdx; i++) {
    if (!tokens[i].added) strippedStart += tokens[i].value.length
  }
  const origStart = strippedToOriginalOffset(content, strippedStart)
  const origEnd   = strippedToOriginalOffset(content, strippedStart + token.value.length)
  let addedText = ''
  for (let j = removedIdx + 1; j < tokens.length && tokens[j].added; j++) addedText += tokens[j].value
  const cleaned = removeTextInRange(content, origStart, origEnd)
  return cleaned.slice(0, origStart) + addedText + cleaned.slice(origStart)
}

// ── sample texts ──────────────────────────────────────────────────────────

const OCR = `<pb n="2"/>

<tab/> ΠΟΛ. Ἡράκλεις, ὑπερφυές τε τὸ θέαμα φῂς, καὶ
δεινῶς βίαιον, εἴ γε καὶ Δυκῖνον ἐξέπληξε γυνή τις οὖσα.
σὺ γὰρ ὑπὸ μὲν τῶν μειρακίων <note>f)</note> καὶ πάνυ ῥᾳδίως αὐτὸ
<note>p. 459</note> πάσχεις· ὠςτὲ θᾶττον ἄν τις ὅλον τὸν Σίπυλον μετακινή<lb break="no"/>σειεν, ἢ σὲ τῶν καλῶν ἀπάγοι, μὴ οὐχὶ παρεστάναι αὐ<lb break="no"/>τοῖς κεχηνότα <note>g)</note>, καὶ ἐπιδακρύοντά γε πολλάκις, ὥςπερ ἐκείνην αὐτὴν τὴν τοῦ Ταντάλου. ἀτὰρ εἰπέ μοι, τίς ἡ λιθοποιὸς αὕτη Μέδουσα ἡμῖν ἐστι, καὶ πόθεν; ὣς καὶ ἡμεῖς ἴδοιμεν. οὐ γὰρ, οἶμαι, φθονήσεις <note>h)</note> ἡμῖν τῆς θέας, αὐδὲ ζηλοτυπήσεις, εἰ μέλλοιμεν πλησίον που καὶ αὐτοὶ παραπεπηγέναι σοι ἰδόντες.

<tab/> ATK. Καὶ μὴν εὖ εἰδέναι χρή σε, ὡς, κᾂν ἐκ περιω<lb break="no"/>πῆς <note>i)</note> μόνον ἀπίδῃς <note>k)</note> ἐς αὐτὴν, ἀχανῆ σε, καὶ τῶν ἀν<lb break="no"/>δριάντων ἀκινητότερον ἀποφανεῖ. καίτοι τοῦτο μὲν ἴσως <note>p. 460.</note> εἰρηνικώτερόν ἐστι, καὶ τὸ τραῦμα ἧττον καίριον, εἰ αὐτὸς ἴδοις· εἰ δὲ κᾀκείνη προσβλέψειέ σε <note>*)</note>, τίς ἔσται μηχανὴ`

const KRAKEN = `LUCIANI
ΠΟΑ. Ἡράκλεις, ὑπερφυές τι τὸ θέαμα φῂς, καὶ
δεινῶς βίαιον, εἴ γε καὶ Λυκῖνον ἐξέπληξε γυνή τις οὖσα.
σὺ γὰρ ὑπὸ μὲν τῶν μειρακίων [) καὶ πάνυ ῥᾳδίως αὐτὸ
Ρ.459 πάσχεις· ὥστε θᾶττον ἄν τις ὄλον τὸν Σίπυλον μετακινή‐
σειεν, ἢ σὲ τῶν καλῶν ἀπάγοι, μὴ οὐχὶ παρεστάναι αὐ‐
τοῖς κεχηνότας), καὶ ἐπιδακρύοντά γε πολλάκις, ὥσπερ
ἐκείνην αὐτὴν τὴν τοῦ Ταντάλου. ἀτὰρ εἰπέ μοι, τίς ἡ
λιθοποιὸς αὕτη Μέδουσα ἡμῖν ἐστι, καὶ πόθεν; ὡς καὶ
ἡμεῖς ἴδοιμεν. οὐ γὰρ, οἶμαι, φθονήσεις λ) ἡμῖν τῆς θέας,
οὐδὲ ζηλοτυπήσεις, εἰ μέλλοιμεν πλησίον που καὶ αὐτοὶ
παραπεπηγέναι σοι ἰδόντες.
ἈΥΚ. Χαὶ μὴν εὖ εἰδέναι χρή σε, ὡς, κἆν ἐκ περιω‐
πῆσι〉 μόνον ἀπίδησε〉 ἐς αὐτὴν, ἀχανῆ σε, καὶ τῶν ἀν‐
δριάνιων ἀκινητότερον ἀποφανεῖ. καίτοι τοῦτο μὲν ἴσως
6ο. εἰρηνικώτερόν ἐστι, καὶ τὸ τραῦμα ἦττον καίριον, εἰ αὐτὸς
ἤδοις· εἰ δὲ κᾀκείνη προσβλέψειέ σε), τίς ἔσται μηχανὴ`

// ── unit tests for strippedToOriginalOffset ───────────────────────────────

function assertEqual(label, actual, expected) {
  const ok = actual === expected
  console.log(`  ${ok ? '✓' : '✗'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
  if (!ok) process.exitCode = 1
}

console.log('\n── strippedToOriginalOffset ──')
// "hello" → simple, no tags
assertEqual('hello[0]', strippedToOriginalOffset('hello', 0), 0)
assertEqual('hello[4]', strippedToOriginalOffset('hello', 4), 4)
// "<pb/>hello" → tag at start
assertEqual('<pb/>hello[0]', strippedToOriginalOffset('<pb/>hello', 0), 5)
assertEqual('<pb/>hello[4]', strippedToOriginalOffset('<pb/>hello', 4), 9)
// "he<pb/>llo" → tag in middle
assertEqual('he<pb/>llo[0]', strippedToOriginalOffset('he<pb/>llo', 0), 0)
assertEqual('he<pb/>llo[2]', strippedToOriginalOffset('he<pb/>llo', 2), 7)
assertEqual('he<pb/>llo[4]', strippedToOriginalOffset('he<pb/>llo', 4), 9)
// "he<note>ll</note>o" → wrapping tag
assertEqual('he<note>ll</note>o[2]', strippedToOriginalOffset('he<note>ll</note>o', 2), 8)

// ── diff against samples ──────────────────────────────────────────────────

const ocrStripped = stripXml(OCR)
const tokens = diffChars(ocrStripped, KRAKEN)
const ranges = computeSuggestionRanges(OCR, tokens)

console.log(`\n── diff summary: ${tokens.length} tokens, ${ranges.filter(r=>r.addedText).length} replacements, ${ranges.filter(r=>!r.addedText).length} deletions ──`)

// Show first 12 suggestion ranges with context
console.log('\n── suggestion ranges (first 12) ──')
for (const r of ranges.slice(0, 12)) {
  const ctxBefore = stripXml(OCR.slice(Math.max(0, r.origStart - 15), r.origStart))
  const marked    = OCR.slice(r.origStart, r.origEnd)
  const ctxAfter  = stripXml(OCR.slice(r.origEnd, r.origEnd + 15))
  console.log(`  token[${r.tokenIdx}] pos[${r.origStart}..${r.origEnd}]`)
  console.log(`    context: "…${ctxBefore}[${r.removedText}→${r.addedText}]${ctxAfter}…"`)
  console.log(`    raw OCR slice: ${JSON.stringify(marked)}`)
}

// ── verify acceptSuggestion on a few key replacements ────────────────────

console.log('\n── acceptSuggestion spot-checks ──')

// Find "ΠΟΛ" → "ΠΟΑ" change
const polRange = ranges.find(r => r.removedText === 'Λ' && r.addedText === 'Α')
if (polRange) {
  const result = acceptSuggestion(OCR, tokens, polRange.tokenIdx)
  const hasOld = result.includes('ΠΟΛ')
  const hasNew = result.includes('ΠΟΑ')
  assertEqual('Λ→Α: old removed', hasOld, false)
  assertEqual('Λ→Α: new inserted', hasNew, true)
  // Check that XML tags around the change are preserved
  const pbStillPresent = result.includes('<pb n="2"/>')
  assertEqual('Λ→Α: <pb> preserved', pbStillPresent, true)
} else {
  console.log('  ⚠ Λ→Α range not found (diff may have merged it with surroundings)')
}

// Find "τε" → "τι" change
const teRange = ranges.find(r => r.removedText === 'ε' && r.addedText === 'ι')
if (teRange) {
  const result = acceptSuggestion(OCR, tokens, teRange.tokenIdx)
  assertEqual('ε→ι: old removed', result.includes('τε τὸ'), false)
  assertEqual('ε→ι: new inserted', result.includes('τι τὸ'), true)
} else {
  console.log('  ⚠ τε→τι range not found')
}

// ── verify mark positions visually ───────────────────────────────────────

console.log('\n── annotated OCR (first 500 chars, {removed→added} marks) ──')
let annotated = ''
let ocrPos = 0
const sortedRanges = [...ranges].sort((a, b) => a.origStart - b.origStart)
for (const r of sortedRanges) {
  if (r.origStart < ocrPos) continue  // skip overlapping (shouldn't happen)
  annotated += OCR.slice(ocrPos, r.origStart)
  annotated += `{${r.removedText}→${r.addedText}}`
  ocrPos = r.origEnd
  if (annotated.length > 500) break
}
annotated += OCR.slice(ocrPos, 600)
console.log(annotated)
