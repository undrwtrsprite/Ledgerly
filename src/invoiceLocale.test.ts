import { describe, expect, it } from 'vitest'
import { formatInvoiceDate, invoiceCopy, invoiceLocale, organizationPaymentDetails } from './invoiceLocale'

describe('invoice document localization', () => {
  it('uses the language saved on the invoice', () => {
    const locale = invoiceLocale({ documentLocale: 'de-DE' })
    expect(locale).toBe('de-DE')
    expect(invoiceCopy(locale).invoice).toBe('RECHNUNG')
    expect(invoiceCopy(locale).balanceDue).toBe('Offener Betrag')
  })

  it('uses the organization default for older invoices', () => {
    expect(invoiceLocale({}, { locale: 'en-GB', defaultInvoiceLocale: 'de-DE' })).toBe('de-DE')
    expect(invoiceLocale({}, { locale: 'de-DE' })).toBe('de-DE')
  })

  it('formats German invoice dates in German order', () => {
    expect(formatInvoiceDate('2026-09-04', 'de-DE')).toBe('04.09.2026')
  })

  it('formats reusable bank details for German invoices', () => {
    expect(organizationPaymentDetails({ accountHolder: 'Muster GmbH', bankName: 'Hausbank', iban: 'DE00 1234', bic: 'TESTDE00', bankInstructions: 'Bitte Rechnungsnummer angeben.' }, 'de-DE')).toBe(
      'Kontoinhaber: Muster GmbH\nBank: Hausbank\nIBAN: DE00 1234\nBIC/SWIFT: TESTDE00\nBitte Rechnungsnummer angeben.'
    )
  })
})
