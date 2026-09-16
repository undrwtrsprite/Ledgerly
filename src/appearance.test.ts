import { describe, expect, it } from 'vitest'
import { accessibilityIssues, contrastRatio, defaultAppearance, INVOICE_PALETTES, legacyAppearanceFromColor, makeAccessible, normalizeAppearance, readableTextOn, resolveAccent, resolveAppearance, resolveTokens, templateDefinition } from './appearance'
import type { Organization } from './types'

const org = (overrides: Partial<Organization> = {}): Organization => ({
  id: 'org-1', ownerName: '', legalName: 'Legal', tradingName: 'Trade', email: '', phone: '', website: '',
  address: '', taxId: '', currency: 'EUR', locale: 'en-GB', timeZone: 'Europe/Berlin', paymentTermsDays: 14,
  invoicePrefix: 'INV-', nextInvoiceNumber: 1, bankInstructions: '', defaultNotes: '', brandColor: '#2c5847',
  defaultTaxRateBps: 1900, taxRates: [], reminders: { enabled: true, dueSoonDays: 3, overdueFollowUpDays: 7, includeDueToday: true },
  ...overrides,
})

describe('appearance defaults', () => {
  it('creates a complete appearance from the first palette', () => {
    const appearance = defaultAppearance()
    expect(appearance.template).toBe('classic')
    expect(appearance.paletteId).toBe(INVOICE_PALETTES[0].id)
    expect(appearance.primaryColor).toBe(INVOICE_PALETTES[0].primary)
    expect(appearance.showFooter).toBe(true)
  })

  it('normalizes partial records without erasing custom colors', () => {
    const appearance = normalizeAppearance({ primaryColor: '#123456', template: 'bold' })
    expect(appearance.primaryColor).toBe('#123456')
    expect(appearance.template).toBe('bold')
    expect(appearance.fontPair).toBe('clean')
  })
})

describe('appearance precedence', () => {
  it('prefers snapshot, then invoice, then organization defaults, then legacy brand color', () => {
    const snapshotAppearance = { ...defaultAppearance(), template: 'bold' as const }
    const invoiceAppearance = { ...defaultAppearance(), template: 'minimal' as const }
    const orgAppearance = { ...defaultAppearance(), template: 'modern' as const }
    const organization = org({ invoiceAppearanceDefaults: orgAppearance })
    expect(resolveAppearance({ appearance: invoiceAppearance, snapshot: { appearance: snapshotAppearance } }, organization).template).toBe('bold')
    expect(resolveAppearance({ appearance: invoiceAppearance }, organization).template).toBe('minimal')
    expect(resolveAppearance({}, organization).template).toBe('modern')
    expect(resolveAppearance({}, org()).primaryColor).toBe('#2c5847')
  })

  it('derives a legacy fallback from brandColor', () => {
    const appearance = legacyAppearanceFromColor('#112233')
    expect(appearance.primaryColor).toBe('#112233')
    expect(appearance.accentColor).toBe('#112233')
    expect(appearance.paletteId).toBe('custom')
  })
})

describe('contrast helpers', () => {
  it('computes contrast and picks readable text', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeGreaterThan(15)
    expect(readableTextOn('#2c5847')).toBe('#ffffff')
    expect(readableTextOn('#f4f2ec')).toBe('#111814')
  })

  it('flags poor combinations and corrects them', () => {
    expect(accessibilityIssues(defaultAppearance())).toHaveLength(0)
    const poor = { ...defaultAppearance(), primaryColor: '#7d7d7d', accentColor: '#7d7d7d' }
    expect(accessibilityIssues(poor).length).toBeGreaterThan(0)
    const fixed = makeAccessible(poor)
    expect(accessibilityIssues(fixed)).toHaveLength(0)
    expect(defaultAppearance().primaryColor).toBe('#2c5847')
  })
})

describe('template definitions', () => {
  const ids = ['classic', 'modern', 'minimal', 'editorial', 'bold'] as const

  it('resolves a complete definition for every template id', () => {
    for (const id of ids) {
      const def = templateDefinition(id)
      expect(def.id).toBe(id)
      expect(def.header).toBeTruthy()
      expect(def.metadata).toBeTruthy()
      expect(def.table).toBeTruthy()
      expect(def.totals).toBeTruthy()
      expect(def.titleScale).toBeTruthy()
    }
  })

  it('gives every template a distinct structural recipe', () => {
    const defs = ids.map(templateDefinition)
    expect(new Set(defs.map(def => def.header)).size).toBe(5)
    const recipe = (d: ReturnType<typeof templateDefinition>) => `${d.header}/${d.metadata}/${d.table}/${d.totals}`
    expect(new Set(defs.map(recipe)).size).toBe(5)
  })

  it('keeps modern and minimal structurally apart from classic', () => {
    const classic = templateDefinition('classic')
    const modern = templateDefinition('modern')
    const minimal = templateDefinition('minimal')
    expect([modern.header, modern.metadata, modern.totals].filter(value => value !== classic.header && value !== classic.metadata && value !== classic.totals).length).toBeGreaterThan(0)
    expect(modern.header).not.toBe(classic.header)
    expect(minimal.header).not.toBe(classic.header)
    expect(minimal.totals).not.toBe(classic.totals)
  })

  it('normalizes and preserves every template id', () => {
    for (const template of ids) {
      expect(normalizeAppearance({ template }).template).toBe(template)
    }
  })

  it('resolves tokens deterministically', () => {
    const invoice = { appearance: { ...defaultAppearance(), template: 'editorial' as const } }
    const organization = { brandColor: '#2c5847' }
    expect(resolveTokens(invoice, organization)).toEqual(resolveTokens(invoice, organization))
  })
})

describe('accent contract', () => {
  it('maps rule and block to distinct treatments', () => {
    const rule = resolveAccent({ ...defaultAppearance(), accentStyle: 'rule' })
    const block = resolveAccent({ ...defaultAppearance(), accentStyle: 'block' })
    expect(rule).toEqual({ rail: false, accentRule: true, totalsBar: false, balanceFilled: true })
    expect(block).toEqual({ rail: false, accentRule: false, totalsBar: true, balanceFilled: true })
  })

  it('migrates the removed bar style to rule', () => {
    expect(normalizeAppearance({ accentStyle: 'bar' }).accentStyle).toBe('rule')
    expect(resolveAccent({ ...defaultAppearance(), accentStyle: 'bar' })).toEqual(resolveAccent({ ...defaultAppearance(), accentStyle: 'rule' }))
  })

  it('leaves none unfilled and undecorated', () => {
    expect(resolveAccent({ ...defaultAppearance(), accentStyle: 'none' })).toEqual({ rail: false, accentRule: false, totalsBar: false, balanceFilled: false })
  })

  it('never fills the balance block in minimal', () => {
    for (const accentStyle of ['bar', 'rule', 'block', 'none'] as const) {
      expect(resolveAccent({ ...defaultAppearance(), template: 'minimal', accentStyle }).balanceFilled).toBe(false)
    }
    expect(resolveAccent({ ...defaultAppearance(), template: 'minimal', accentStyle: 'bar' }).accentRule).toBe(true)
  })
})
