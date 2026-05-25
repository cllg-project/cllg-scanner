# CLLG Desktop

![CLLG Desktop](cllg.png)

A desktop application for OCR processing of ancient Greek and Latin scholarly texts. It converts scanned documents — PDFs, DjVu files, or image folders — into structured TEI XML through a guided five-step workflow.

Inference is delegated to a local [LM Studio](https://lmstudio.ai/) server running a vision model (Qwen2.5-VL or compatible). No data leaves your machine.

---

## Installation

No technical skills or build tools are required. Pre-built executables for Windows, macOS, and Linux are available on the [GitHub Releases](../../releases) page.

| Platform | File |
|---|---|
| Windows | `CLLG-Desktop-Setup-*.exe` — run the installer |
| macOS | `CLLG-Desktop-*.dmg` — open and drag to Applications |
| Linux | `CLLG-Desktop-*.AppImage` — run directly |

**Linux note:** After downloading the AppImage, mark it as executable before running:

```bash
chmod +x CLLG-Desktop-*.AppImage
./CLLG-Desktop-*.AppImage
```

If the application fails to start with a sandbox error, add the `--no-sandbox` flag:

```bash
./CLLG-Desktop-*.AppImage --no-sandbox
```

---

## Requirements

### LM Studio (required)

Download and install [LM Studio](https://lmstudio.ai/) separately. CLLG Desktop does not bundle an inference engine — it sends pages to a local LM Studio server running on your machine.

1. Open LM Studio and download a vision-capable model (Qwen2.5-VL 7B or compatible).
2. Start the local server from the "Local Server" tab (default port: 1234).
3. Keep LM Studio running while using CLLG Desktop.

### Documents and configuration

- A scanned document: PDF, DjVu, or a folder of page images (JPEG, PNG, TIFF)
- A YAML configuration file describing the document's reference hierarchy (see below)

---

## Workflow

The application guides work through five sequential steps.

### 1. Import

Open an existing project or create a new one by loading a PDF, DjVu file, or a folder of images. Each page is rendered as a PNG and stored in the project directory under `pages/`.

### 2. Mask

Draw rectangular masks over regions that should be hidden from the OCR model — critical apparatus, footnotes, marginal annotations you wish to exclude. Masks are stored per page in the project file and applied automatically when OCR runs.

White masks blank out the region; black masks can be used for contrast correction. Masked images are generated at OCR time.

### 3. OCR

Configure the LM Studio endpoint, model identifier, and context length, then run OCR. Each page is sent to the model with a transcription prompt; the response is normalised and cached to `pages/page_NNNN.md`.

Progress is displayed live with per-page status, token counts, elapsed time, and an estimated time remaining once at least one page has completed. OCR can be stopped and resumed; completed pages are skipped on re-run.

### 4. Review

A side-by-side editor showing the page image alongside the OCR output. Changes are saved back to the per-page cache files and the combined `ocr_output.md` is rebuilt automatically.

Toolbar shortcuts:

| Action | Shortcut |
|---|---|
| Save page | Ctrl/Cmd S |
| Wrap in `<ref level="">` | Ctrl/Cmd R |
| Wrap in `<note>` | Ctrl/Cmd M |
| Insert `<tab/>` | Tab |
| Undo | Ctrl/Cmd Z |
| Redo | Ctrl/Cmd Y or Ctrl Shift Z |

Syntax highlighting distinguishes classified references (`<ref level="N">`), unclassified references (`<ref>`), notes, line-break markers, and structural tags. Clicking inside any tag opens a context bar for editing or converting it in place. Unclassified `<ref>` tags can be assigned a level using the buttons drawn from the TEI hierarchy configuration.

Trailing hyphens at the end of a line are highlighted in green: they will be converted to `<lb break="no"/>` automatically during TEI export.

### 5. TEI Export

Define the document hierarchy (book, chapter, section, etc.) with the pattern type for each level's reference markers. Supported formats: Roman numerals, Arabic numerals, Greek numerals, Latin alphabet, Stephanus pagination, or a custom regular expression.

The hierarchy is compiled to a YAML configuration which drives the converter. Click "Generate TEI XML" to produce the output file. The converter runs entirely within the application — no external tools or network access required.

The generated TEI XML includes:

- Nested `<div>` elements structured according to the reference hierarchy
- `<milestone>` elements for non-hierarchical reference levels (e.g. Stephanus pages)
- Inline `<note>` elements for margin notes
- `<lb break="no"/>` for line-break hyphens
- `<pb>` page-break markers
- `<citeStructure>` in the TEI header for machine-readable citation paths

---

## Project file format

Each project is a directory containing:

```
my_project/
  project.cllg.json     project metadata, page list, masks, LM config, hierarchy
  pages/
    page_0001.png        original page image
    page_0001_masked.png masked version (created when masks are present)
    page_0001.md         per-page OCR output
    ...
  ocr_output.md          combined OCR output, rebuilt on every page save
  output.xml             TEI XML (written by the export step)
```

The project file is plain JSON and can be version-controlled or shared.

---

## Hierarchy configuration

The reference hierarchy is defined in the Export step and stored inside `project.cllg.json`. It can also be written by hand as YAML for use with the command-line tools:

```yaml
metadata:
  title: "Commentarii"
  author: "Caesar"
  edition: "Teubner 1900"
  language: "lat"

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
      is_milestone: false
```

`format` values: `Roman` (uppercase), `roman` (lowercase), `Arabic`, `Greek`, `greek`, `Alpha` (uppercase), `alpha` (lowercase), `Stephanus`, or any regular expression anchored to the full token.

Setting `is_milestone: true` on a level produces `<milestone>` elements instead of `<div>` elements.

---

## Building from source

```bash
cd cllg-desktop
npm install
npm run dev        # development mode with hot reload
npm run build      # compile
npm run package    # compile + electron-builder -> dist/
```

Requires Node 20+ and npm 10+.

---

## Architecture notes

The application is built with Electron 31, React 18, and TypeScript. PDF rendering uses pdfjs-dist in the renderer process. Canvas masking uses Konva. TEI conversion runs in the main process using a pure TypeScript implementation with no external tools or native dependencies.

LM Studio is called via its native HTTP API at `{endpoint}/api/v1/chat`. The application also accepts the OpenAI-compatible response format as a fallback.

---

## Acknowledgments

The project *« Corpus Liberatum Linguae Graecae »* was supported by the French National Research Agency (ANR) under the France 2030 grant reference number *« ANR-24-RRII-0002 »* operated by the Inria Quadrant Program.

**Project Leader:** Thibault Clérice  
**Project Members:** Nicolas Angleraud, Antonia Karamolegkou, Benoît Sagot
