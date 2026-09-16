import type { AppData, AuditEvent, Invoice, InvoiceStatus, LineItem, Payment } from './types'

export const currencyDigits = (currency: string) => ['JPY', 'KRW', 'VND'].includes(currency) ? 0 : 2

export function formatMoney(minor: number, currency = 'EUR', locale = 'en-GB') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / (10 ** currencyDigits(currency)))
}

export function parseMoney(input: string, currency = 'EUR') {
  const digits = currencyDigits(currency)
  let cleaned = input.trim().replace(/[^0-9,.-]/g, '')
  if (!cleaned) return 0
  const negative = cleaned.startsWith('-')
  cleaned = cleaned.replace('-', '')
  if (digits === 0) cleaned = cleaned.replace(/[.,]/g, '')
  else {
    const comma = cleaned.lastIndexOf(',')
    const dot = cleaned.lastIndexOf('.')
    const separator = comma > dot ? ',' : '.'
    const index = Math.max(comma, dot)
    const looksDecimal = index >= 0 && cleaned.length - index - 1 <= digits
    if (looksDecimal) {
      const whole = cleaned.slice(0, index).replace(/[.,]/g, '')
      const fraction = cleaned.slice(index + 1).replace(/[.,]/g, '')
      cleaned = `${whole}.${fraction}`
    } else cleaned = cleaned.replace(/[.,]/g, '')
    if (separator === ',' && !looksDecimal) cleaned = cleaned.replace(',', '')
  }
  if (!Number.isFinite(Number(cleaned))) return 0
  const [wholeRaw, decimalRaw = ''] = cleaned.split('.')
  const whole = Number(wholeRaw || '0') * 10 ** digits
  const decimal = Number((decimalRaw + '0'.repeat(digits)).slice(0, digits) || '0')
  return (whole + decimal) * (negative ? -1 : 1)
}

const roundDiv = (numerator: number, denominator: number) => Math.round(numerator / denominator)

export function lineTotals(line: LineItem) {
  const gross = roundDiv(line.quantityMilli * line.unitPrice, 1000)
  const discount = roundDiv(gross * line.discountBps, 10_000)
  const net = gross - discount
  const tax = roundDiv(net * line.taxRateBps, 10_000)
  return { gross, discount, net, tax, total: net + tax }
}

export function invoiceTotals(invoice: Invoice, payments: Payment[] = []) {
  const lines = invoice.lineItems.map(lineTotals)
  const subtotal = lines.reduce((sum, line) => sum + line.gross, 0)
  const lineDiscount = lines.reduce((sum, line) => sum + line.discount, 0)
  const preInvoiceDiscount = subtotal - lineDiscount
  const invoiceDiscount = roundDiv(preInvoiceDiscount * invoice.invoiceDiscountBps, 10_000)
  const scale = preInvoiceDiscount ? (preInvoiceDiscount - invoiceDiscount) / preInvoiceDiscount : 1
  const tax = lines.reduce((sum, line) => sum + Math.round(line.tax * scale), 0)
  const total = preInvoiceDiscount - invoiceDiscount + tax + invoice.additionalCharges
  const paid = payments.filter(p => p.invoiceId === invoice.id).reduce((sum, p) => sum + p.amount, 0)
  return { subtotal, lineDiscount, invoiceDiscount, discount: lineDiscount + invoiceDiscount, tax, additionalCharges: invoice.additionalCharges, total, paid, due: Math.max(0, total - paid) }
}

export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export const monthKeyLocal = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

export interface CurrencyTotal { currency: string; amount: number }

export function sumByCurrency(items: Array<{ amount: number; currency: string }>): CurrencyTotal[] {
  const sums = new Map<string, number>()
  for (const item of items) sums.set(item.currency, (sums.get(item.currency) || 0) + item.amount)
  return [...sums.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency))
}

export function formatCurrencyTotals(parts: CurrencyTotal[], fallbackCurrency = 'EUR', locale = 'en-GB') {
  if (!parts.length) return formatMoney(0, fallbackCurrency, locale)
  return parts.map(part => formatMoney(part.amount, part.currency, locale)).join(' + ')
}

export function paymentCurrency(payment: Pick<Payment, 'invoiceId'>, invoices: Array<Pick<Invoice, 'id' | 'currency'>>, fallback: string) {
  return invoices.find(invoice => invoice.id === payment.invoiceId)?.currency || fallback
}

export function convertMinorUnits(amount: number, from: string, to: string) {
  const shift = currencyDigits(to) - currencyDigits(from)
  if (shift === 0) return amount
  return Math.round(amount * 10 ** shift)
}

export function nextDraftNumber(existing: string[]) {
  let max = 0
  for (const number of existing) {
    const match = /^Draft (\d+)$/.exec(number)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `Draft ${max + 1}`
}

const TERMINAL_FOR_PAYMENTS: InvoiceStatus[] = ['draft', 'void', 'cancelled']

export function validatePaymentAmount(amount: number, due: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(amount)) return { ok: false, error: 'Enter a valid amount.' }
  if (amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' }
  if (amount > due) return { ok: false, error: 'Amount exceeds the remaining balance.' }
  return { ok: true }
}

export function buildPaymentState(snapshot: AppData, input: { invoiceId: string; amount: number; date: string; method: string; reference: string; note: string }, created: { id: string; createdAt: string }): { ok: true; state: AppData } | { ok: false; error: string } {
  const invoice = snapshot.invoices.find(item => item.id === input.invoiceId)
  if (!invoice) return { ok: false, error: 'Invoice not found.' }
  if (TERMINAL_FOR_PAYMENTS.includes(invoice.status)) return { ok: false, error: 'Payments can only be recorded on issued invoices.' }
  const totals = invoiceTotals(invoice, snapshot.payments)
  const amountCheck = validatePaymentAmount(input.amount, totals.due)
  if (!amountCheck.ok) return { ok: false, error: amountCheck.error }
  const nextPayment: Payment = { ...input, id: created.id, source: 'manual', createdAt: created.createdAt }
  const allPayments = [nextPayment, ...snapshot.payments]
  const newStatus = effectiveStatus(invoice, allPayments)
  const audit: AuditEvent = { id: created.id, type: 'payment.recorded', message: `Manual payment recorded for ${invoice.number}`, invoiceId: invoice.id, actor: 'You', at: created.createdAt }
  return {
    ok: true,
    state: {
      ...snapshot,
      payments: allPayments,
      invoices: snapshot.invoices.map(item => item.id === invoice.id ? { ...item, status: newStatus, paymentStatus: newStatus === 'paid' ? 'paid' : 'partial', updatedAt: created.createdAt } : item),
      audit: [audit, ...snapshot.audit],
    },
  }
}

export function buildDeletePaymentState(snapshot: AppData, paymentId: string, at = new Date().toISOString()): AppData {
  const payment = snapshot.payments.find(item => item.id === paymentId)
  if (!payment) return snapshot
  const invoice = snapshot.invoices.find(item => item.id === payment.invoiceId)
  const remaining = snapshot.payments.filter(item => item.id !== paymentId)
  const terminal = invoice && ['void', 'cancelled', 'draft'].includes(invoice.status) ? invoice.status : undefined
  const restored = invoice && !terminal ? effectiveStatus({ ...invoice, status: invoice.sentAt ? 'sent' : 'finalized' }, remaining) : undefined
  const audit: AuditEvent = { id: `${paymentId}-removed`, type: 'payment.removed', message: `Payment removed from ${invoice?.number || 'invoice'}`, invoiceId: invoice?.id, actor: 'You', at }
  return {
    ...snapshot,
    payments: remaining,
    invoices: snapshot.invoices.map(item => item.id === invoice?.id && !terminal ? { ...item, status: restored || item.status, paymentStatus: restored === 'paid' ? 'paid' : restored === 'partial' ? 'partial' : 'unpaid' } : item),
    audit: [audit, ...snapshot.audit],
  }
}

export function effectiveStatus(invoice: Invoice, payments: Payment[], today = localToday()): InvoiceStatus {
  if (invoice.status === 'void' || invoice.status === 'cancelled' || invoice.status === 'draft') return invoice.status
  const { total, paid } = invoiceTotals(invoice, payments)
  if (total > 0 && paid >= total) return 'paid'
  if (invoice.dueDate && invoice.dueDate < today) return 'overdue'
  if (paid > 0) return 'partial'
  return invoice.status
}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus) {
  const allowed: Record<InvoiceStatus, InvoiceStatus[]> = {
    draft: ['finalized', 'cancelled'],
    finalized: ['sent', 'void', 'cancelled'],
    sent: ['partial', 'paid', 'overdue', 'void', 'cancelled'],
    partial: ['paid', 'overdue', 'void'],
    overdue: ['partial', 'paid', 'void'],
    paid: ['partial', 'sent', 'void'],
    void: [],
    cancelled: [],
  }
  return allowed[from].includes(to)
}

export const uid = () => crypto.randomUUID()
