import type { Invoice, InvoiceSnapshot, Organization } from './types'

export type InvoiceTemplate = 'classic' | 'modern' | 'minimal' | 'editorial' | 'bold'
export type InvoiceFontPair = 'clean' | 'warm' | 'classic' | 'editorial' | 'formal'
export type InvoiceDensity = 'comfortable' | 'compact'
export type InvoiceLogoPosition = 'left' | 'center' | 'right'
export type InvoiceAccentStyle = 'bar' | 'rule' | 'block' | 'none'
export type InvoiceLogoScale = 'small' | 'medium' | 'large'

export interface InvoiceAppearance {
  template: InvoiceTemplate
  paletteId: string
  primaryColor: string
  accentColor: string
  fontPair: InvoiceFontPair
  density: InvoiceDensity
  logoPosition: InvoiceLogoPosition
  logoScale: InvoiceLogoScale
  accentStyle: InvoiceAccentStyle
  showReference: boolean
  showClientTaxId: boolean
  showPaymentDetails: boolean
  showNotes: boolean
  showFooter: boolean
}

export interface InvoicePalette {
  id: string
  name: string
  primary: string
  accent: string
  surface: string
  text: string
  muted: string
  border: string
}

export const INVOICE_PALETTES: InvoicePalette[] = [
  { id: 'forest', name: 'Forest', primary: '#2c5847', accent: '#c9a227', surface: '#ffffff', text: '#1b2420', muted: '#69706c', border: '#e5e2d8' },
  { id: 'navy', name: 'Navy', primary: '#1f3a5f', accent: '#2f6fed', surface: '#ffffff', text: '#1c2430', muted: '#667080', border: '#e2e6ec' },
  { id: 'slate', name: 'Slate', primary: '#334155', accent: '#0e7490', surface: '#ffffff', text: '#1e293b', muted: '#64748b', border: '#e2e8f0' },
  { id: 'plum', name: 'Plum', primary: '#5b2a4a', accent: '#b34a7d', surface: '#ffffff', text: '#2a1c26', muted: '#7a6a75', border: '#eadfe6' },
  { id: 'terracotta', name: 'Terracotta', primary: '#9a4a2e', accent: '#c97b2d', surface: '#ffffff', text: '#2b1f18', muted: '#7d6f64', border: '#eee0d3' },
  { id: 'graphite', name: 'Graphite', primary: '#2b2f33', accent: '#6b7280', surface: '#ffffff', text: '#1f2328', muted: '#6b7280', border: '#e3e5e8' },
]

export const paletteById = (id: string) => INVOICE_PALETTES.find(palette => palette.id === id)

export interface FontPairDef {
  id: InvoiceFontPair
  name: string
  body: string
  heading: string
  pdfBody: 'helvetica' | 'times'
  pdfHeading: 'helvetica' | 'times'
}

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const WARM_SANS = "'Avenir Next', 'Segoe UI', Verdana, Helvetica, Arial, sans-serif"
const SERIF = "Georgia, 'Times New Roman', Times, serif"

export const INVOICE_FONTS: FontPairDef[] = [
  { id: 'clean', name: 'Clean sans', body: SANS, heading: SANS, pdfBody: 'helvetica', pdfHeading: 'helvetica' },
  { id: 'warm', name: 'Warm sans', body: WARM_SANS, heading: WARM_SANS, pdfBody: 'helvetica', pdfHeading: 'helvetica' },
  { id: 'classic', name: 'Classic serif', body: SERIF, heading: SERIF, pdfBody: 'times', pdfHeading: 'times' },
  { id: 'editorial', name: 'Editorial', body: SANS, heading: SERIF, pdfBody: 'helvetica', pdfHeading: 'times' },
  { id: 'formal', name: 'Formal', body: SERIF, heading: SERIF, pdfBody: 'times', pdfHeading: 'times' },
]

export const fontPairById = (id: InvoiceFontPair): FontPairDef => INVOICE_FONTS.find(font => font.id === id) || INVOICE_FONTS[0]

export function defaultAppearance(): InvoiceAppearance {
  const forest = INVOICE_PALETTES[0]
  return {
    template: 'classic',
    paletteId: forest.id,
    primaryColor: forest.primary,
    accentColor: forest.accent,
    fontPair: 'clean',
    density: 'comfortable',
    logoPosition: 'left',
    logoScale: 'medium',
    accentStyle: 'rule',
    showReference: true,
    showClientTaxId: true,
    showPaymentDetails: true,
    showNotes: true,
    showFooter: true,
  }
}

export function legacyAppearanceFromColor(brandColor: string): InvoiceAppearance {
  return { ...defaultAppearance(), paletteId: 'custom', primaryColor: brandColor, accentColor: brandColor }
}

export function normalizeAppearance(input?: Partial<InvoiceAppearance> | null): InvoiceAppearance {
  const merged = { ...defaultAppearance(), ...(input || {}) }
  // Legacy 'bar' (removed side rail) resolves to 'rule' so stored records keep
  // a visible accent and a filled balance instead of a blank select value.
  if (merged.accentStyle === 'bar') merged.accentStyle = 'rule'
  return merged
}

type AppearanceSource = Pick<Invoice, 'appearance'> & { snapshot?: Pick<InvoiceSnapshot, 'appearance'> | null }
type AppearanceOrg = Pick<Organization, 'brandColor' | 'invoiceAppearanceDefaults'>

export function resolveAppearance(invoice: AppearanceSource, organization: AppearanceOrg): InvoiceAppearance {
  if (invoice.snapshot?.appearance) return normalizeAppearance(invoice.snapshot.appearance)
  if (invoice.appearance) return normalizeAppearance(invoice.appearance)
  if (organization.invoiceAppearanceDefaults) return normalizeAppearance(organization.invoiceAppearanceDefaults)
  return legacyAppearanceFromColor(organization.brandColor || '#2c5847')
}

export interface ResolvedTokens {
  appearance: InvoiceAppearance
  palette: InvoicePalette
  fonts: FontPairDef
  foregroundOnPrimary: string
  foregroundOnAccent: string
}

export function resolveTokens(invoice: AppearanceSource, organization: AppearanceOrg): ResolvedTokens {
  const appearance = resolveAppearance(invoice, organization)
  const palette = paletteById(appearance.paletteId) || {
    id: 'custom', name: 'Custom', primary: appearance.primaryColor, accent: appearance.accentColor,
    surface: '#ffffff', text: '#1b2420', muted: '#69706c', border: '#e5e2d8',
  }
  return {
    appearance,
    palette,
    fonts: fontPairById(appearance.fontPair),
    foregroundOnPrimary: readableTextOn(appearance.primaryColor),
    foregroundOnAccent: readableTextOn(appearance.accentColor),
  }
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  return [parseInt(match[1].slice(0, 2), 16), parseInt(match[1].slice(2, 4), 16), parseInt(match[1].slice(4, 6), 16)]
}

const channelLuminance = (channel: number) => {
  const s = channel / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(rgb: [number, number, number]) {
  return 0.2126 * channelLuminance(rgb[0]) + 0.7152 * channelLuminance(rgb[1]) + 0.0722 * channelLuminance(rgb[2])
}

export function contrastRatio(a: string, b: string) {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra || !rb) return 0
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export function readableTextOn(background: string) {
  const white = contrastRatio('#ffffff', background)
  const ink = contrastRatio('#111814', background)
  return white >= ink ? '#ffffff' : '#111814'
}

const mixToward = (hex: string, target: [number, number, number], amount: number) => {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const mixed = rgb.map((channel, i) => Math.round(channel + (target[i] - channel) * amount)) as [number, number, number]
  return `#${mixed.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

function strengthenToText(hex: string, minimum: number) {
  let color = hex
  for (let i = 0; i < 16; i++) {
    const text = readableTextOn(color)
    if (contrastRatio(text, color) >= minimum) break
    color = text === '#ffffff' ? mixToward(color, [0, 0, 0], 0.15) : mixToward(color, [255, 255, 255], 0.15)
  }
  return color
}

export function makeAccessible(appearance: InvoiceAppearance): InvoiceAppearance {
  return { ...appearance, primaryColor: strengthenToText(appearance.primaryColor, 4.5), accentColor: strengthenToText(appearance.accentColor, 3) }
}

export function accessibilityIssues(appearance: InvoiceAppearance): string[] {
  const issues: string[] = []
  if (contrastRatio(readableTextOn(appearance.primaryColor), appearance.primaryColor) < 4.5) {
    issues.push('Primary color contrast is below the 4.5:1 body-text target.')
  }
  if (contrastRatio(readableTextOn(appearance.accentColor), appearance.accentColor) < 3) {
    issues.push('Accent color contrast is below the 3:1 large-text target.')
  }
  return issues
}

export type TemplateHeader = 'split' | 'stacked' | 'quiet' | 'asymmetric' | 'band'
export type TemplateMetadata = 'columns' | 'band' | 'quiet' | 'rail'
export type TemplateTable = 'ruled' | 'open' | 'minimal' | 'editorial' | 'strong'
export type TemplateTotals = 'panel' | 'summary' | 'plain' | 'statement' | 'banner'

export interface TemplateDefinition {
  id: InvoiceTemplate
  header: TemplateHeader
  metadata: TemplateMetadata
  table: TemplateTable
  totals: TemplateTotals
  titleScale: 'small' | 'normal' | 'large' | 'display'
}

export function templateDefinition(template: InvoiceTemplate): TemplateDefinition {
  switch (template) {
    case 'modern': return { id: 'modern', header: 'stacked', metadata: 'band', table: 'open', totals: 'summary', titleScale: 'display' }
    case 'minimal': return { id: 'minimal', header: 'quiet', metadata: 'quiet', table: 'minimal', totals: 'plain', titleScale: 'small' }
    case 'editorial': return { id: 'editorial', header: 'asymmetric', metadata: 'rail', table: 'editorial', totals: 'statement', titleScale: 'display' }
    case 'bold': return { id: 'bold', header: 'band', metadata: 'columns', table: 'strong', totals: 'banner', titleScale: 'large' }
    default: return { id: 'classic', header: 'split', metadata: 'columns', table: 'ruled', totals: 'panel', titleScale: 'normal' }
  }
}

export interface ResolvedAccent {
  rail: boolean
  accentRule: boolean
  totalsBar: boolean
  balanceFilled: boolean
}

export function resolveAccent(appearance: InvoiceAppearance): ResolvedAccent {
  const minimal = appearance.template === 'minimal'
  // Defensive: 'bar' is normalized to 'rule' above; treat any raw survivor the same.
  const style = appearance.accentStyle === 'bar' ? 'rule' : appearance.accentStyle
  return {
    rail: false,
    accentRule: style === 'rule',
    totalsBar: style === 'block',
    balanceFilled: style !== 'none' && !minimal,
  }
}

export interface DensityTokens {
  rowHeight: number
  lineGap: number
  sectionGap: number
  tablePad: number
}

export function densityTokens(density: InvoiceDensity): DensityTokens {
  return density === 'compact'
    ? { rowHeight: 8, lineGap: 3.5, sectionGap: 3, tablePad: 10 }
    : { rowHeight: 11, lineGap: 4.5, sectionGap: 5, tablePad: 14 }
}

export function logoWidthMm(scale: InvoiceLogoScale) {
  return scale === 'small' ? 22 : scale === 'large' ? 48 : 34
}
