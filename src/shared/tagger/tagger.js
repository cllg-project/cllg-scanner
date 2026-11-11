// CRF tagger: loads a model exported by `python -m cllg_tagging.export` (plain JSON, no native code), Viterbi decoding.
import { sentFeats, tokenize, TOKEN } from "./features.js";

class Tagger {
  constructor(model) {
    this.labels = model.labels;
    this.attrs = model.attrs;           // attr -> [[labelIndex, weight], ...]
    const L = this.labels.length;
    this.trans = Array.from({ length: L }, () => new Float64Array(L));
    for (const [a, b, w] of model.trans) this.trans[a][b] = w;
  }

  tagTokens(tokens) {
    const L = this.labels.length, n = tokens.length;
    if (!n) return [];
    const feats = sentFeats(tokens);
    const emit = feats.map((fs) => {
      const e = new Float64Array(L);
      for (const f of fs) { const a = this.attrs[f]; if (a) for (const [l, w] of a) e[l] += w; }
      return e;
    });
    let score = Float64Array.from(emit[0]);
    const back = [];
    for (let i = 1; i < n; i++) {
      const next = new Float64Array(L), bp = new Int32Array(L);
      for (let b = 0; b < L; b++) {
        let best = -Infinity, arg = 0;
        for (let a = 0; a < L; a++) { const s = score[a] + this.trans[a][b]; if (s > best) { best = s; arg = a; } }
        next[b] = best + emit[i][b]; bp[b] = arg;
      }
      score = next; back.push(bp);
    }
    let k = 0;
    for (let l = 1; l < L; l++) if (score[l] > score[k]) k = l;
    const path = [k];
    for (let i = n - 2; i >= 0; i--) { k = back[i][k]; path.push(k); }
    return path.reverse().map((l) => this.labels[l]);
  }

  // text -> [{start, end, label, text}] over character offsets of `text`
  tag(text) {
    const toks = [], spans = [];
    const re = new RegExp(TOKEN.source, "gu");
    let m;
    while ((m = re.exec(text))) { toks.push(m[0]); spans.push([m.index, m.index + m[0].length]); }
    const tags = this.tagTokens(toks), out = [];
    let cur = null;
    tags.forEach((t, i) => {
      if (cur && !(t.startsWith("I-") && t.slice(2) === cur.label)) { out.push(cur); cur = null; }
      if (t.startsWith("B-")) cur = { label: t.slice(2), start: spans[i][0], end: spans[i][1] };
      else if (cur) cur.end = spans[i][1];
    });
    if (cur) out.push(cur);
    return out.map((e) => ({ ...e, text: text.slice(e.start, e.end) }));
  }
}

// Two overlapping layers: layer 1 = NOTE spans, layer 2 = BIBL / REF spans. A NOTE that contains a BIBL (REF) is reported as kind NOTEBIBL (NOTEREF).
class LayeredTagger {
  constructor(noteModel, citeModel) { this.note = new Tagger(noteModel); this.cite = new Tagger(citeModel); }
  // text -> {notes: [{start,end,text,kind}], cites: [{start,end,text,label}]} over character offsets
  annotate(text) {
    const notes = this.note.tag(text), cites = this.cite.tag(text);
    for (const n of notes) {
      const inner = new Set(cites.filter((c) => c.start < n.end && c.end > n.start).map((c) => c.label));
      n.kind = inner.has("BIBL") ? "NOTEBIBL" : inner.has("REF") ? "NOTEREF" : "NOTE";
    }
    return { notes, cites };
  }
  tagTokens(tokens) { return { note: this.note.tagTokens(tokens), cite: this.cite.tagTokens(tokens) }; }
}
export { Tagger, LayeredTagger, tokenize };
