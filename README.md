# CLLG Desktop

![CLLG Desktop](cllg.png)

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Web demo](https://img.shields.io/badge/try_it-web_demo-8b3a2a.svg)](https://cllg-project.github.io/cllg-scanner/)

A desktop application that turns scans of ancient Greek and Latin scholarly editions — PDFs, DjVu files, image folders, or ALTO exports — into structured TEI XML, through a guided seven-step workflow.

Text recognition runs locally with [Kraken](https://kraken.re/) models (through [kraken-js](https://github.com/cllg-project/kraken-js) and ONNX Runtime). Nothing to install besides the application (the models are downloaded on first launch), and no data leaves your machine.

**[Try the interactive demo in your browser →](https://cllg-project.github.io/cllg-scanner/)** A guided tour of the interface on a sample project (Galen, *De propriis placitis*). Masking, zone drawing, text correction and TEI generation work in the demo; OCR and file import need the desktop app.

---

## Installation

No technical skills or build tools are required. Pre-built executables for Windows, macOS, and Linux are available on the [GitHub Releases](../../releases) page.

| Platform | File |
|---|---|
| Windows | `CLLG.Desktop.*.exe` — portable: run it directly, nothing to install |
| macOS (Apple Silicon) | `CLLG.Desktop-*-arm64.dmg` — open and drag to Applications |
| Linux | `CLLG.Desktop-*.AppImage`, `cllg-desktop_*_amd64.deb`, or `cllg-desktop-*.tar.gz` — see below |

The `.js_mlmodel` files attached to a release are the Kraken models: the application downloads them by itself on first launch, there is no need to download them by hand.

**Linux — which file to pick:**

- **`.deb`** (recommended for Debian/Ubuntu): installs via your package manager,
  which resolves all required shared libraries automatically.
  ```bash
  sudo apt install ./cllg-desktop_*_amd64.deb
  ```
- **`.AppImage`**: run directly, but requires `libfuse2`, which is no longer
  preinstalled on Ubuntu ≥ 22.04 / Debian ≥ 12 (they ship FUSE3 by default). If you see
  an error about a missing dependency or FUSE when launching it, either install
  `libfuse2`:
  ```bash
  sudo apt install libfuse2
  chmod +x CLLG.Desktop-*.AppImage
  ./CLLG.Desktop-*.AppImage
  ```
  or bypass FUSE entirely:
  ```bash
  chmod +x CLLG.Desktop-*.AppImage
  ./CLLG.Desktop-*.AppImage --appimage-extract-and-run
  ```
- **`.tar.gz`**: works on any distribution, no packaging system required. Extract
  and run the `cllg-desktop` binary inside.

On a minimal, server, or cloud Ubuntu image, any of the three formats may also need
a handful of Chromium/Electron runtime libraries that a desktop install already has:
```bash
sudo apt install libnss3 libgtk-3-0 libasound2 libatk-bridge2.0-0 libgbm1 libxss1 libxtst6
```

If the application fails to start with a sandbox error, add the `--no-sandbox` flag:

```bash
./CLLG.Desktop-*.AppImage --no-sandbox
```

---

## Requirements

- A scanned document: PDF, DjVu, a folder of page images (PNG, JPEG, TIFF…), or ALTO XML files with their images (e.g. exported from eScriptorium)
- An internet connection on first launch: the built-in Kraken models (Ancient Greek segmentation and recognition, and the CLLG and LADaS layout models, ~190 MB) are downloaded once from the GitHub release, checked against their SHA-256, and kept in the app's user-data folder. Importing and masking work while they download. The models are published in their own repository, [kraken-js-models](https://github.com/PonteIneptique/kraken-js-models). Your own Kraken models (`.js_mlmodel`) can be loaded instead.

A guided tour (home screen or sidebar) walks through every step on a demo project.

---

## Workflow

### 1. Import

Create a project from a PDF or DjVu (choose the pages: ranges, «Skip covers», odd/even pages…), from a folder of images, or from ALTO files with their images. Each page is stored as a PNG under `pages/`. ALTO import keeps every line's geometry; when the ALTO carries LADaS zone types, paragraphs, quotes and headings are recognised automatically.

### 2. Document

Say what kind of document the project is:

- **Greek (CLLG)** — a Greek scholarly edition: the section markers in the margins (Stephanus, Bekker, chapter numbers…) are merged into the text as `<ref>`, longer margin text as an inline `<note>`;
- **Latin (LADaS)** — a Latin or general document typed with the LADaS zone vocabulary: margin text stays a `<note>` of its own.

The choice picks the layout model that detects the zones of each page (9 zone types for CLLG, 37 for LADaS). For every zone type, choose what the transcription keeps: **Annotate** (text kept and tagged, e.g. `<p zone="r3">`, zone editable in Review), **Keep text** (plain lines) or **Drop** (left out; the line boxes are kept). By default running titles, page and quire numbers, stamps, decorations and noise are dropped, everything else is annotated. All of this can be changed later.

### 3. Mask

Draw white rectangles over what should not be read — running heads, line numbers, footnotes, critical apparatus, marginalia. Masked regions are whited out before recognition. Masks can be copied to all pages, generated from ALTO regions, or exported as COCO JSON. Pages can be skipped (e.g. a cover page) from the thumbnail list.

Shortcuts: **D** draw, **S** select, **Delete** remove.

### 4. OCR

Kraken segments each page into lines and recognises them, one page at a time; with «Detect regions», a D-FINE layout model also finds the page's zones and the lines are grouped into them as chosen in the Document step. Duplicate detections (two zones overlapping by more than 80%) are dropped. Results are cached per page (`pages/page_NNNN.md`; the first pass is also kept, untouched, in `page_NNNN.orig.md`), so runs can be stopped and resumed; «Force reprocess» redoes chosen pages. Every line is anchored with `<lb n="…"/>`, which keeps the text linked to its position on the image.

The three steps can also be run separately — **Zones** (layout), **Lines** (segmentation), **Text** (recognition) — on any selected pages, including pages already reviewed: each changes only its own layer and keeps the corrected text (the Zones step, for instance, adds or updates the zones without touching a word). Review offers the same for the current page.

The **CPU threads** setting (saved per computer) controls how much of the machine OCR may use.

### 5. Structure

Describe the document's metadata, its reference hierarchy (e.g. book → chapter → section) and its bibliography (TEI `sourceDesc`). The hierarchy is optional: without it, the TEI is cited by page only. Each level has a numbering format — Roman, Arabic, Alpha, Greek, Stephanus, or a custom regular expression — and options: `missing_first` (the first number is not printed), `allow_gaps`, and `milestone` (a marker inside the text rather than a division).

### 6. Review

The page image and the transcription side by side (the image pane can be hidden). Edits are saved per page with Ctrl/Cmd S; the combined `ocr_output.md` is rebuilt on every save.

- **Structure tags:** `<ref>` for reference numbers (with their hierarchy level; level 1 directly when only one level is declared), `<note>`, `<quote>`, `<cit>`, `<bibl>`, `<lb/>`. Click inside a tag to edit or convert it.
- **Zones:** «Zones» shows the page's zones — detected by the layout model (dashed) or drawn by hand with «Draw Zone» (solid). Each zone is linked to its tag in the text (`<p zone="r3">`): putting the caret in the text selects its zone, and moving, resizing, retyping or deleting a zone rewrites its tag. To change a zone's type, click its label (on the image or in the zone list) or press **T**: a searchable list of the zone types (type to filter — «head», «mzh»…; the types dropped in the Document step are left out).
- **Re-OCR:** rebuild the page from scratch, or run a single step (Zones, Lines or Text) on it without losing corrections.
- **Lines:** «Show line boxes» outlines every line — click one to jump to it. A selected line can be redrawn (**R**) and re-read on its own («Re-OCR line»).
- **Checking:** «2nd read» (Kraken re-read with differences underlined), «Line» (image of the current line above the caret), in-page search, detection of Latin letters inside Greek, «Fix hyphens», «Scan refs».
- **Greek typing:** a betacode keyboard (diacritics before the letter: `)/a` → ἄ), with `:` → · (ano teleia), `?` → ; (Greek question mark) and `<` `>` → ⟨ ⟩ (Leiden brackets).

| Action | Shortcut |
|---|---|
| Save page | Ctrl/Cmd S |
| Undo / Redo | Ctrl/Cmd Z / Ctrl/Cmd Y or Ctrl/Cmd Shift Z |
| Previous / next page | Ctrl ↑ / Ctrl ↓ |
| Find in page | Ctrl/Cmd F |
| Betacode keyboard on/off | Ctrl/Cmd K |
| Wrap in `<ref>` / `<note>` / `<quote>` / `<cit>` / `<bibl>` | Ctrl/Cmd R / M / Q / I / B |
| Draw Zone mode on/off *(pointer over the image)* | G |
| Zone type list *(zone selected, or in Draw Zone mode)* | T |
| Paragraph / Quote / Heading / Continued *(in Draw Zone mode)* | P, Q, H, C |
| Redraw the selected line *(pointer over the image)* | R |
| Delete the selected zone | Delete |

### 7. TEI Export

«Generate» builds one TEI P5 file for the whole document; the converter runs inside the application, with no external tools or network access. It works with or without a reference hierarchy. The output includes:

- nested `<div>` elements following the reference hierarchy, and `<milestone>` elements for milestone levels
- `<head>`, `<p>` and `<quote>` from zones and tags; Continued zones merged into the paragraph they continue, across the page break
- `<pb>` page breaks, `<lb n="…"/>` line anchors, and `<lb break="no"/>` for words split at the line end
- `<note>`, `<cit>`, `<bibl>`, and `<citeStructure>` in the header for machine-readable citation paths: always by page (`<refsDecl type="physical">`, on `//pb`), and by the reference hierarchy when there is one

The text is normalised to Unicode NFC. The Per-page tab exports plain text, text with LADaS tags, ALTO or pre-TEI; a searchable PDF and a zip of the whole project can also be exported.

---

## Project file format

Each project is a directory containing:

```
my_project/
  project.cllg.json      metadata, pages (masks, status, line geometry, zones), hierarchy, bibliography,
                         Kraken settings (document type, zone choices)
  pages/
    page_0001.png         original page image
    page_0001_masked.png  masked version (when the page has masks)
    page_0001.md          reviewed transcription
    page_0001.orig.md     first OCR pass, kept untouched for reference
    ...
  ocr_output.md           all pages combined, rebuilt on every save
```

The TEI file is saved wherever you choose. The project file is plain JSON and can be version-controlled or shared. Per-computer settings (such as CPU threads) and the downloaded Kraken models live in the application's user-data folder, not in the project.

---

## Hierarchy configuration

The hierarchy is defined in the Structure step and stored in `project.cllg.json`; it is compiled to YAML for the converter (with no hierarchy, `structure` is left out and the TEI is cited by page only):

```yaml
metadata:
  title: "Commentarii"
  author: "Caesar"
  source: "Teubner 1900"

structure:
  name: book
  format: Roman          # Roman | Arabic | Alpha | Greek | Stephanus | <regex>
  missing_first: false
  child:
    name: chapter
    format: Arabic
    child:
      name: section
      format: Arabic
      is_milestone: true  # <milestone> instead of <div>
```

---

## Building from source

```bash
cd cllg-desktop
npm install
npm run dev        # development mode with hot reload
npm run build      # compile
npm run package    # compile + electron-builder -> dist/
npm test           # unit tests (vitest)
```

Requires Node 20+ and npm 10+.

The Kraken models are not in this repository. `npm run dev` downloads them on first launch like the released application; to work offline, put the `.js_mlmodel` files from [kraken-js-models](https://github.com/PonteIneptique/kraken-js-models) (Git LFS) in `resources/models/`, where they are used as they are. `resources/models.json` pins the models release and their checksums; the release workflow attaches the models to every application release.

---

## Architecture notes

Electron 31, React 18 and TypeScript. PDF pages are rendered with pdfjs-dist (DjVu with djvu.js) in the renderer; masking uses Konva. Recognition runs in the main process with kraken-js on ONNX Runtime; each run uses only the full-page pipeline (segmentation + recognition), including single-line re-reads, which isolate the line on a blank page. Layout zones come from a D-FINE model (kraken-js `DFineSegmenter`) run on the whole page; lines are assigned to the zone covering them. TEI conversion is a pure TypeScript implementation with no native dependencies.

---

## License

CLLG Desktop is released under the [Apache License 2.0](LICENSE).

You are free to use, modify, and redistribute this software. Attribution is required; the names of the contributors and the project may not be used to endorse or promote derived works without explicit permission.

---

## Acknowledgments

The project *« Corpus Liberatum Linguae Graecae »* was supported by the French National Research Agency (ANR) under the France 2030 grant reference number *« ANR-24-RRII-0002 »* operated by the Inria Quadrant Program.

**Project Leader:** Thibault Clérice  
**Project Members:** Nicolas Angleraud, Antonia Karamolegkou, Benoît Sagot

---

## Open-source dependencies

| Library | Author | License |
|---|---|---|
| [Electron](https://github.com/electron/electron) | OpenJS Foundation | MIT |
| [React](https://github.com/facebook/react) | Meta Platforms | MIT |
| [kraken-js](https://github.com/cllg-project/kraken-js) | CLLG project | Apache 2.0 |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | Microsoft | MIT |
| [sharp](https://github.com/lovell/sharp) | Lovell Fuller | Apache 2.0 |
| [PDF.js](https://github.com/mozilla/pdf.js) | Mozilla Foundation | Apache 2.0 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | Andrew Dillon | MIT |
| [Konva](https://github.com/konvajs/konva) | Anton Lavrenov | MIT |
| [@xmldom/xmldom](https://github.com/xmldom/xmldom) | xmldom contributors | MIT |
| [yaml](https://github.com/eemeli/yaml) | Eemeli Aro | ISC |
| [i18next](https://github.com/i18next/i18next) / [react-i18next](https://github.com/i18next/react-i18next) | Jan Mühlemann | MIT |
| [archiver](https://github.com/archiverjs/node-archiver) | Chris Talkington | MIT |
| [react-router](https://github.com/remix-run/react-router) | Remix Software | MIT |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | Tailwind Labs | MIT |
| [electron-vite](https://github.com/alex8088/electron-vite) | Alex Wei | MIT |

The guided tour's demo pages come from V. Boudon-Millot & A. Pietrobelli, « Galien ressuscité : édition princeps du texte grec du *De propriis placitis* », *Revue des Études Grecques* 118 (2005), p. 168-213 ([doi:10.3406/reg.2005.4610](https://doi.org/10.3406/reg.2005.4610)), distributed by [Persée](https://www.persee.fr/doc/reg_0035-2039_2005_num_118_1_4610) under CC BY-NC-ND; they are included unmodified.
