import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { defaultAppearance } from './appearance'
import { buildInvoicePdf } from './pdf'
import type { Client, Invoice, InvoiceTemplate, Organization } from './types'

const dir = mkdtempSync(join(tmpdir(), 'ledgerly-pdf-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const org = (overrides: Partial<Organization> = {}): Organization => ({
  id: 'org-1', ownerName: '', legalName: 'Legal', tradingName: 'Trade', email: '', phone: '', website: '',
  address: '', taxId: '', currency: 'EUR', locale: 'en-GB', timeZone: 'Europe/Berlin', paymentTermsDays: 14,
  invoicePrefix: 'INV-', nextInvoiceNumber: 1, bankInstructions: '', defaultNotes: '', brandColor: '#2c5847',
  defaultTaxRateBps: 1900, taxRates: [], reminders: { enabled: true, dueSoonDays: 3, overdueFollowUpDays: 7, includeDueToday: true },
  ...overrides,
})

const client: Client = {
  id: 'c-1', company: 'Example Client', contact: '', email: 'example-client@example.invalid',
  phone: '', address: '', taxId: '', currency: 'EUR',
  notes: '', archived: false, createdAt: '', updatedAt: '',
}

const invoice = (lines: number, reference = 'PO-2026-048'): Invoice => ({
  id: 'i-1', number: 'INV-1', clientId: 'c-1', status: 'sent', paymentStatus: 'unpaid',
  issueDate: '2026-09-08', dueDate: '2026-09-22', currency: 'EUR', reference,
  lineItems: Array.from({ length: lines }, (_, i) => ({
    id: `l-${i}`, description: `Line item ${i + 1} with a reasonably long description to exercise wrapping`, quantityMilli: 2000, unitPrice: 120000, taxRateBps: 1900, discountBps: 0,
  })),
  invoiceDiscountBps: 0, additionalCharges: 0, notes: 'Thank you.', paymentTerms: '',
  paymentInstructions: 'IBAN DE00 1234', createdAt: '', updatedAt: '',
})

describe('invoice PDF parity', () => {
  const templates: InvoiceTemplate[] = ['classic', 'modern', 'minimal', 'editorial', 'bold']

  it('renders every template to a single page without throwing', async () => {
    for (const template of templates) {
      const organization = org({ invoiceAppearanceDefaults: { ...defaultAppearance(), template } })
      const { doc, pages } = await buildInvoicePdf(invoice(3), client, organization, [])
      expect(pages).toBe(1)
      doc.save(join(dir, `${template}.pdf`))
    }
  })

  it('paginates long invoices and repeats the table treatment', async () => {
    const organization = org({ invoiceAppearanceDefaults: { ...defaultAppearance(), template: 'editorial' } })
    const { pages } = await buildInvoicePdf(invoice(14), client, organization, [])
    expect(pages).toBeGreaterThan(1)
  })

  it('renders accent, density, locale, and visibility variants without throwing', async () => {
    const variants = [
      { ...defaultAppearance(), template: 'minimal' as const, accentStyle: 'none' as const },
      { ...defaultAppearance(), template: 'bold' as const, accentStyle: 'block' as const },
      { ...defaultAppearance(), template: 'modern' as const, accentStyle: 'rule' as const, density: 'compact' as const },
      { ...defaultAppearance(), template: 'classic' as const, showFooter: false, showReference: false, showClientTaxId: false, showNotes: false, showPaymentDetails: false },
    ]
    for (const appearance of variants) {
      const organization = org({ invoiceAppearanceDefaults: appearance, locale: 'de-DE', defaultInvoiceLocale: 'de-DE' as const })
      const { pages } = await buildInvoicePdf(invoice(3, ''), client, organization, [])
      expect(pages).toBe(1)
    }
  })
})
