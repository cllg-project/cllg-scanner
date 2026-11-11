// Port of src/cllg_tagging/features.py (variant A, no embeddings). Keep in sync: the parity test compares both.
const LEX = new Set(("cf sch schol fr fort supra infra v vv vgl ed p pp l ll lin cod codd ms om add del sc ad loc cit ib ibid op s sq sqq " +
  "vol cap lib col ann fol app adn n not nota ep or rec corr ex etc cett gloss lemma").split(" "));
const ROMAN = /^[ivxlcdm]+$/;
const GREEK_NUM = /^[α-ω]+ʹ$/;
const OPEN = "([«‘“⟨", CLOSE = ")]»’”⟩";
import { PY_DIGIT, PY_UPPER, PY_WORD, PY_SPACE } from "./unicode_py.js";  // exact Python semantics (str.isdigit, str.isupper, re \w)
const TOKEN = new RegExp("(?:" + PY_WORD.source + ")+|(?!" + PY_WORD.source + ")(?!" + PY_SPACE.source + ")[^]", "gu");

const chars = (s) => Array.from(s);
const lower = (w) => chars(w).map((c) => c.toLowerCase()).join("");
const isDigit = (c) => PY_DIGIT.test(c);
const isAlpha = (c) => /\p{L}/u.test(c);
const isUpper = (c) => PY_UPPER.test(c);

function shape(w) {
  const out = [];
  for (const c of chars(w)) {
    let k;
    if (isDigit(c)) k = "d";
    else if (isAlpha(c)) {
      const greek = (c >= "Ͱ" && c <= "Ͽ") || (c >= "ἀ" && c <= "῿");
      k = greek ? (isUpper(c) ? "G" : "g") : (isUpper(c) ? "A" : "a");
    } else k = c;
    if (!out.length || out[out.length - 1] !== k) out.push(k);
  }
  return out.join("");
}

function tokenFeats(w) {
  const n = w.normalize("NFC");
  const lw = lower(n), lc = chars(lw), nc = chars(n);
  const f = ["w=" + lw, "sh=" + shape(n), "len=" + Math.min(nc.length, 8)];
  for (let k = 1; k <= 4; k++) {
    if (lc.length >= k) f.push("p" + k + "=" + lc.slice(0, k).join(""), "s" + k + "=" + lc.slice(-k).join(""));
  }
  if (nc.length && nc.every(isDigit)) f.push("digit");
  if (ROMAN.test(lw)) f.push("roman");
  if (GREEK_NUM.test(lw)) f.push("gnum");
  if (nc.length && isUpper(nc[0])) f.push("cap");
  if (LEX.has(lw)) f.push("lex");
  return f;
}

function sentFeats(tokens) {
  const base = tokens.map(tokenFeats);
  let depth = 0, since = 99;
  const ctx = [];
  for (const t of tokens) {
    if (OPEN.includes(t)) { depth++; since = 0; }
    ctx.push([Math.min(depth, 3), Math.min(since, 6)]);
    if (CLOSE.includes(t) && depth) depth--;
    since++;
  }
  const lexpos = [];
  tokens.forEach((t, i) => { if (LEX.has(lower(t))) lexpos.push(i); });
  const keep = new Set(["sh", "w=", "p2", "s2", "le", "di", "ro", "gn", "ca"]);
  const rows = [];
  for (let i = 0; i < tokens.length; i++) {
    const f = ["bias", ...base[i], "depth=" + ctx[i][0], "since=" + ctx[i][1]];
    if (lexpos.some((j) => i - j > 0 && i - j <= 6)) f.push("lex6");
    for (const d of [-3, -2, -1, 1, 2, 3]) {
      const j = i + d, tag = (d > 0 ? "+" : "-") + Math.abs(d);
      if (j < 0 || j >= tokens.length) { f.push(tag + ":EDGE"); continue; }
      for (const x of base[j]) {
        const p = x.slice(0, 2);
        if (keep.has(p) && (Math.abs(d) === 1 || p === "sh" || p === "p2" || p === "s2")) f.push(tag + ":" + x);
      }
    }
    rows.push(f);
  }
  return rows;
}

const tokenize = (text) => text.match(TOKEN) || [];
export { tokenFeats, sentFeats, tokenize, lower, shape, TOKEN };
