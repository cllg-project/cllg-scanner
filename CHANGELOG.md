# Changelog

All notable changes to the CLLG Desktop app are recorded here.

---

## [0.1.0] — 2026-05-28

### Review — 2nd read (Kraken cross-check)

- New **2nd read** button runs Kraken on the current page and computes a character-level diff against the editor text. Results are cached per image+masks for the session so re-opening the panel is instant.
- Differing spans are marked with **wavy red underlines** in the editor overlay. Clicking a span opens a banner showing the removed text → Kraken's replacement, with **Accept** and **Dismiss** actions.
- When a suggestion is active, the corresponding Kraken line is highlighted on the source image as a semi-transparent red polygon (vertically padded, no border).
- NFKC normalisation applied to both sides before diffing to eliminate spurious Unicode-variant mismatches.
- Suggestions where the only difference is whitespace normalisation are suppressed.
- Tour step added for the 2nd read button.

### Review — Latin character detector

- New **Latin** toggle button scans the page content and marks every A–Z / a–z character outside XML tags with a **blue wavy underline**.
- Clicking a marked character opens a banner proposing its Greek visual lookalike (e.g. `v` → `ν`, `I` → `Ι`). **Replace** applies the suggestion; **Ignore** suppresses it for the session.
- Characters already covered by a 2nd-read diff suggestion are excluded from Latin detection to avoid double-marking.
- Badge on the button shows the count of remaining flagged characters.

### Review — image pane

- **Ctrl/⌘+wheel zoom** on the source image pane.
- **Zoom to pointer** — wheel zoom recenters on the mouse cursor rather than the top-left corner.
- Pixel-based zoom so the image can scale past its natural size without the flex container collapsing it.
- **Resizable split** between the image and editor panes via a draggable handle; the ratio is persisted per project in `localStorage`.

### Masking

- **White-only masking** — the black mask option has been removed. All masks are white rectangles, which is the only meaningful mode for OCR pre-processing.

### Export

- **Export project as ZIP** — new "Share project…" button saves the entire project directory as a `.zip` archive via a save dialog. Default filename is `Author – Title.zip` when metadata is filled, otherwise the project folder name.
- TEI "Save As" default filename also derives from `Author – Title` project metadata.

### Infrastructure

- All fonts (Noto Sans Mono, Noto Serif, etc.) bundled locally; OFL licence acknowledgements included under `resources/licenses/`.

---

[0.1.0]: https://github.com/leponteineptique/cllg-desktop/commits/feature/kraken-compare
