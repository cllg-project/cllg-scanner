export interface CrfModel {
  labels: string[]
  attrs: Record<string, [number, number][]>
  trans: [number, number, number][]
}
export interface TaggedSpan {
  start: number
  end: number
  label: string
  text: string
}
export interface NoteSpan extends TaggedSpan {
  kind: 'NOTE' | 'NOTEBIBL' | 'NOTEREF'
}
export class Tagger {
  constructor(model: CrfModel)
  tag(text: string): TaggedSpan[]
}
export class LayeredTagger {
  constructor(noteModel: CrfModel, citeModel: CrfModel)
  annotate(text: string): { notes: NoteSpan[]; cites: TaggedSpan[] }
}
export function tokenize(text: string): string[]
