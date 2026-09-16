import type { Invoice, Organization } from './types'

export type InvoiceDocumentLocale = 'en-GB' | 'de-DE'

export const invoiceLocale = (invoice: Pick<Invoice, 'documentLocale'>, organization?: Pick<Organization, 'locale' | 'defaultInvoiceLocale'>): InvoiceDocumentLocale =>
  invoice.documentLocale === 'de-DE' || (!invoice.documentLocale && (organization?.defaultInvoiceLocale === 'de-DE' || (!organization?.defaultInvoiceLocale && organization?.locale?.startsWith('de')))) ? 'de-DE' : 'en-GB'

export const invoiceCopy = (locale: InvoiceDocumentLocale) => locale === 'de-DE' ? {
  invoice: 'RECHNUNG',
  billTo: 'RECHNUNG AN',
  invoiceNumber: 'RECHNUNGSNUMMER',
  issueDate: 'Rechnungsdatum',
  dueDate: 'Fälligkeitsdatum',
  reference: 'Referenz',
  description: 'BESCHREIBUNG',
  quantity: 'MENGE',
  rate: 'EINZELPREIS',
  tax: 'MWST.',
  amount: 'BETRAG',
  subtotal: 'Zwischensumme',
  discount: 'Rabatt',
  additionalCharges: 'Zusätzliche Kosten',
  total: 'Gesamtbetrag',
  payments: 'Zahlungen',
  balanceDue: 'Offener Betrag',
  notesPayment: 'HINWEISE & ZAHLUNG',
  page: 'Seite',
  of: 'von',
  fallbackClient: 'Kunde',
  selectClient: 'Kunden auswählen',
  fallbackItem: 'Ihre Leistung',
} : {
  invoice: 'INVOICE',
  billTo: 'BILL TO',
  invoiceNumber: 'INVOICE NUMBER',
  issueDate: 'Issue date',
  dueDate: 'Due date',
  reference: 'Reference',
  description: 'DESCRIPTION',
  quantity: 'QTY',
  rate: 'RATE',
  tax: 'TAX',
  amount: 'AMOUNT',
  subtotal: 'Subtotal',
  discount: 'Discount',
  additionalCharges: 'Additional charges',
  total: 'Total',
  payments: 'Payments',
  balanceDue: 'Balance due',
  notesPayment: 'NOTES & PAYMENT',
  page: 'Page',
  of: 'of',
  fallbackClient: 'Client',
  selectClient: 'Select a client',
  fallbackItem: 'Your service',
}

export const formatInvoiceDate = (date: string, locale: InvoiceDocumentLocale, compact = false) => {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat(locale, compact
    ? { day: 'numeric', month: 'short' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' }
  ).format(parsed)
}

export const organizationPaymentDetails = (organization: Pick<Organization, 'accountHolder' | 'bankName' | 'iban' | 'bic' | 'bankInstructions'>, locale: InvoiceDocumentLocale) => {
  const german = locale === 'de-DE'
  return [
    organization.accountHolder && `${german ? 'Kontoinhaber' : 'Account holder'}: ${organization.accountHolder}`,
    organization.bankName && `${german ? 'Bank' : 'Bank'}: ${organization.bankName}`,
    organization.iban && `IBAN: ${organization.iban}`,
    organization.bic && `BIC/SWIFT: ${organization.bic}`,
    organization.bankInstructions,
  ].filter(Boolean).join('\n')
}
