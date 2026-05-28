import bnfP127 from '../assets/tour/bnf_p127.png'
import bnfP128 from '../assets/tour/bnf_p128.png'
import bnfP129 from '../assets/tour/bnf_p129.png'
import bnfP130 from '../assets/tour/bnf_p130.png'
import bnfP131 from '../assets/tour/bnf_p131.png'

export interface TourStep {
  id: string
  /** CSS selector for data-tour attribute, or null for centred modal */
  selector: string | null
  /** Preferred tooltip side relative to spotlight */
  position: 'top' | 'bottom' | 'left' | 'right' | 'center'
  /** Route where the target element lives */
  route?: string
  /** Optional page screenshot shown in the tooltip */
  illustration?: string
  /** Short OCR demo snippet shown instead of (or below) the illustration */
  demo?: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    selector: null,
    position: 'center',
    illustration: bnfP127,
  },
  {
    id: 'home-new-project',
    selector: '[data-tour="home-new-project"]',
    position: 'bottom',
    route: '/',
  },
  {
    id: 'home-page-range',
    selector: '[data-tour="home-page-range"]',
    position: 'bottom',
    route: '/',
    illustration: bnfP127,
  },
  {
    id: 'masker-canvas',
    selector: '[data-tour="masker-canvas"]',
    position: 'left',
    route: '/masker',
    illustration: bnfP128,
  },
  {
    id: 'masker-tools',
    selector: '[data-tour="masker-tools"]',
    position: 'bottom',
    route: '/masker',
  },
  {
    id: 'masker-example',
    selector: '[data-tour="masker-example"]',
    position: 'right',
    route: '/masker',
  },
  {
    id: 'ocr-endpoint',
    selector: '[data-tour="ocr-endpoint"]',
    position: 'bottom',
    route: '/ocr',
  },
  {
    id: 'ocr-run',
    selector: '[data-tour="ocr-run"]',
    position: 'bottom',
    route: '/ocr',
    demo: '<ref>1</ref> Voilà que je vous croyez de moi peut-être, amis, frères,\npères, douces choses et doux noms…\n<ref>2</ref> Et vous voilà préparés, les uns à partager mon deuil…\n<ref>3</ref> il faudrait que nous fissions étalage même de notre infortune…',
  },
  {
    id: 'config-hierarchy',
    selector: '[data-tour="config-hierarchy"]',
    position: 'right',
    route: '/config',
    illustration: bnfP130,
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
    illustration: bnfP131,
  },
  {
    id: 'review-tag-ref',
    selector: '[data-tour="review-tag-ref"]',
    position: 'bottom',
    route: '/review',
    demo: '<tab/> <ref level="1">II</ref>Καισαρίῳ πατέρες μέν, ἵν\' ἐντεῦθεν\nἤρξωμαι ὅθεν ἡμῖν πρεπωδέστατον…',
  },
  {
    id: 'review-level',
    selector: '[data-tour="review-level"]',
    position: 'top',
    route: '/review',
    demo: '<!-- discourse II, section 3 -->\n<ref level="1">II</ref>  →  discourse\n<ref level="2">3</ref>   →  section\n<ref>α</ref>            →  unclassified',
  },
  {
    id: 'review-compare',
    selector: '[data-tour="review-compare"]',
    position: 'top',
    route: '/review',
  },
  {
    id: 'export-generate',
    selector: '[data-tour="export-generate"]',
    position: 'top',
    route: '/export',
    demo: '<div type="discourse" n="II">\n  <div type="section" n="1">\n    <p><tab/>Καισαρίῳ πατέρες μέν…</p>\n  </div>\n  <div type="section" n="2">\n    <p>ἐγὼ δὲ τοὺς μὲν ἄλλους…</p>\n  </div>\n</div>',
  },
  {
    id: 'finale',
    selector: null,
    position: 'center',
    illustration: bnfP129,
  },
]
