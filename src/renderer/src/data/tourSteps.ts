// Illustrations are the demo's own pages (assets/tour/galien_p*.png), shown unmodified
// — the source is CC BY-NC-ND — and framed at display time with `illustrationView`.
import page1 from '../assets/tour/galien_p1.png'
import page2 from '../assets/tour/galien_p2.png'
import page3 from '../assets/tour/galien_p3.png'

export interface TourStep {
  id: string
  /** CSS selector for data-tour attribute, or null for centred modal */
  selector: string | null
  /** Preferred tooltip side relative to spotlight */
  position: 'top' | 'bottom' | 'left' | 'right' | 'center'
  /** Route where the target element lives */
  route?: string
  /** Optional page image shown in the tooltip */
  illustration?: string
  /**
   * Which part of the illustration to show (display only, the file is not altered):
   * `zoom` = image width relative to the panel, `position` = CSS background-position.
   * Default: whole width, top of the page.
   */
  illustrationView?: { zoom: number; position: string }
  /** Short OCR demo snippet shown instead of (or below) the illustration */
  demo?: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    selector: null,
    position: 'center',
    illustration: page1,
    illustrationView: { zoom: 1.1, position: '0% 0%' },
  },
  {
    id: 'home-new-project',
    selector: '[data-tour="home-new-project"]',
    position: 'bottom',
    route: '/',
  },
  {
    id: 'home-sources',
    selector: '[data-tour="home-sources"]',
    position: 'bottom',
    route: '/',
  },
  {
    id: 'document-type',
    selector: '[data-tour="document-type"]',
    position: 'bottom',
    route: '/document',
  },
  {
    id: 'document-zones',
    selector: '[data-tour="document-zones"]',
    position: 'top',
    route: '/document',
    illustration: page2,
    illustrationView: { zoom: 1.1, position: '0% 0%' },
  },
  {
    id: 'masker-canvas',
    selector: '[data-tour="masker-canvas"]',
    position: 'left',
    route: '/masker',
    illustration: page2,
    illustrationView: { zoom: 1.8, position: '4.5% 7.6%' },
  },
  {
    id: 'masker-tools',
    selector: '[data-tour="masker-tools"]',
    position: 'bottom',
    route: '/masker',
  },
  {
    id: 'ocr-models',
    selector: '[data-tour="ocr-models"]',
    position: 'bottom',
    route: '/ocr',
  },
  {
    id: 'ocr-run',
    selector: '[data-tour="ocr-run"]',
    position: 'bottom',
    route: '/ocr',
    // Raw Kraken output for the demo's page 2, before review
    demo: '<pb n="2"/>\n<lb n="k0"/>ΓΑΛΗνΟΥ\n<lb n="k1"/>Περὶ τῶν ἑαυτῷ δοκούντων\n<lb n="k2"/> Παραπλήσιόν τί μοι συμβεβηκέναι δοκεῖ τῷ γενομένῳ\n<lb n="k3"/>υποθ\', ὥς φασιν, Παρθενίῳ τῷ ποιητῇ· ζῶντος γὰρ ἔτι τἀνδρὸς\n<lb n="k4"/>ἐξέπεσεν εἰς πόλλα τῶν ἐθνῶν τὰ ποιήματα αὐτοῦ. καί ποτε\n<lb n="k5"/>διερχόμενος πόλιν ἐπέστη δύο γραμματικοῖς διδασκαλία',
  },
  {
    id: 'ocr-steps',
    selector: '[data-tour="ocr-steps"]',
    position: 'bottom',
    route: '/ocr',
  },
  {
    id: 'config-hierarchy',
    selector: '[data-tour="config-hierarchy"]',
    position: 'right',
    route: '/config',
    illustration: page2,
    illustrationView: { zoom: 2, position: '20% 16%' },
  },
  {
    id: 'config-format',
    selector: '[data-tour="config-format"]',
    position: 'right',
    route: '/config',
  },
  {
    id: 'review-editor',
    selector: '[data-tour="review-editor"]',
    position: 'left',
    route: '/review',
    // The same lines as the OCR step, after review
    demo: '<lb n="k0"/>ΓΑΛΗΝΟΥ\n<lb n="k3"/>ποθ\', ὥς φασιν, Παρθενίῳ τῷ ποιητῇ· ζῶντος γὰρ ἔτι τἀνδρὸς\n<lb n="k4"/>ἐξέπεσεν εἰς πόλλα τῶν ἐθνῶν τὰ ποιήματα αὐτοῦ· καί ποτε\n<lb n="k5"/>διερχόμενος πόλιν ἐπέστη δύο γραμματικοῖς (ἐν) διδασκαλίᾳ',
  },
  {
    id: 'review-image',
    selector: '[data-tour="review-image"]',
    position: 'right',
    route: '/review',
    illustration: page3,
    illustrationView: { zoom: 1.25, position: '25% 11.4%' },
    // Demo page 3: the end of section 2, begun on page 2, then section 3
    demo: '<continued zone="…">\n<lb n="k0"/>καὶ περὶ τούτων ὁποῖοι μέν εἰσι τὴν οὐσίαν ἀγνοεῖν, ὅτι δ\'\n…\n<lb n="k11"/>τῶν κατὰ τοὺς θεούς.\n</continued>\n<p zone="…">\n<lb n="k12"/><ref level="1">3</ref> Ὅπως δὲ καὶ περὶ τῶν ἀνθρώπων…',
  },
  {
    id: 'review-tag-ref',
    selector: '[data-tour="review-tag-ref"]',
    position: 'bottom',
    route: '/review',
    demo: '<lb n="k2"/><ref level="1">1</ref> Παραπλήσιόν τί μοι συμβεβηκέναι…\n<lb n="k32"/><ref level="1">2</ref> Πότερον ἀγέννητός ἐστιν ὁ κόσμος…',
  },
  {
    id: 'review-tools',
    selector: '[data-tour="review-tools"]',
    position: 'bottom',
    route: '/review',
    // Betacode keyboard: Leiden brackets and ano teleia
    demo: 'β  <(=wn>   →  ⟨ὧν⟩\nβ  )aei:    →  ἀει·',
  },
  {
    id: 'export-generate',
    selector: '[data-tour="export-generate"]',
    position: 'top',
    route: '/export',
    // Real md2tei output for the demo (trimmed): page 3's Continued zone joins
    // section 2's paragraph across the page break.
    demo: '<div type="section" n="1">\n  <head>ΓΑΛΗΝΟΥ\n    Περὶ τῶν ἑαυτῷ δοκούντων</head>\n  <p>Παραπλήσιόν τί μοι… (ἐν) διδασκαλίᾳ…</p>\n</div>\n<div type="section" n="2">\n  <p>Πότερον ἀγέννητός ἐστιν ὁ κόσμος…\n    …καθάπερ Πρωταγόρας ἔλεγεν ἢ <pb n="3"/>καὶ περὶ\n    τούτων… τῶν κατὰ τοὺς θεούς.</p>\n</div>\n<div type="section" n="3">…',
  },
  {
    id: 'finale',
    selector: null,
    position: 'center',
    illustration: page1,
    illustrationView: { zoom: 1, position: '0% 100%' },
  },
]
