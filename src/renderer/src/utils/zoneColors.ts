import { classifyLadasType, regionKind } from '@shared/zones'

export type ManualZoneRole = 'p' | 'quote' | 'head' | 'continuation'

export function manualZoneColor(role: ManualZoneRole): { bg: string; fg: string } {
  switch (role) {
    case 'quote': return { bg: 'rgba(122,79,174,0.10)', fg: '#7a4fae' }
    case 'head': return { bg: 'rgba(176,74,58,0.10)', fg: '#b04a3a' }
    case 'continuation': return { bg: 'rgba(184,140,40,0.10)', fg: '#c89328' }
    default: return { bg: 'rgba(90,140,63,0.08)', fg: '#5a8c3f' }
  }
}

// A zone's colour: block zones by their tag (as hand-drawn zones always were), the
// others by kind — margins teal, drop capitals amber, dropped zones (running titles,
// page numbers, noise…) grey.
export function zoneColor(type: string): { bg: string; fg: string } {
  const role = classifyLadasType(type)
  if (role !== 'unknown') return manualZoneColor(role)
  switch (regionKind(type)) {
    case 'main': return manualZoneColor('p')
    case 'margin': return { bg: 'rgba(13,148,136,0.10)', fg: '#0d9488' }
    case 'dropcap': return { bg: 'rgba(217,119,6,0.10)', fg: '#d97706' }
    case 'skip': return { bg: 'rgba(100,116,139,0.10)', fg: '#64748b' }
    default: return { bg: 'rgba(71,85,105,0.08)', fg: '#475569' }
  }
}
