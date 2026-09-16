import { describe, expect, it } from 'vitest'
import { buildDeletePaymentState, buildPaymentState, canTransition, convertMinorUnits, currencyDigits, effectiveStatus, formatCurrencyTotals, formatMoney, invoiceTotals, lineTotals, monthKeyLocal, nextDraftNumber, parseMoney, sumByCurrency } from './domain'
import { blankData } from './seed'
import type { AppData, Invoice, LineItem, Payment } from './types'

const line: LineItem = { id: 'l1', description: 'Work', quantityMilli: 1500, unitPrice: 1999, taxRateBps: 1900, discountBps: 1000 }
const invoice: Invoice = { id: 'i1', number: 'INV-1', clientId: 'c1', status: 'sent', paymentStatus: 'unpaid', issueDate: '2026-01-01', dueDate: '2026-01-15', currency: 'EUR', reference: '', lineItems: [line], invoiceDiscountBps: 0, additionalCharges: 0, notes: '', paymentTerms: '', paymentInstructions: '', createdAt: '', updatedAt: '' }

describe('decimal-safe money', () => {
  it('parses currencies into integer minor units', () => {
    expect(parseMoney('1,234.56', 'EUR')).toBe(123456)
    expect(parseMoney('¥1234', 'JPY')).toBe(1234)
    expect(currencyDigits('JPY')).toBe(0)
  })

  it('rounds each line deterministically', () => {
    expect(lineTotals(line)).toEqual({ gross: 2999, discount: 300, net: 2699, tax: 513, total: 3212 })
  })

  it('calculates partial and complete balances', () => {
    const partial: Payment = { id: 'p1', invoiceId: 'i1', amount: 1200, date: '2026-01-05', method: 'Bank', reference: '', note: '', source: 'manual', createdAt: '' }
    expect(invoiceTotals(invoice, [partial]).due).toBe(2012)
    expect(effectiveStatus(invoice, [partial], '2026-01-10')).toBe('partial')
    expect(effectiveStatus(invoice, [{ ...partial, amount: 3212 }], '2026-01-10')).toBe('paid')
  })

  it('marks unpaid issued invoices overdue after due date', () => {
    expect(effectiveStatus(invoice, [], '2026-01-16')).toBe('overdue')
  })

  it('flags partially paid invoices overdue after due date', () => {
    const partial: Payment = { id: 'p2', invoiceId: 'i1', amount: 1200, date: '2026-01-05', method: 'Bank', reference: '', note: '', source: 'manual', createdAt: '' }
    expect(effectiveStatus(invoice, [partial], '2026-01-20')).toBe('overdue')
  })
})

describe('invoice lifecycle', () => {
  it('allows controlled transitions and locks terminal states', () => {
    expect(canTransition('draft', 'finalized')).toBe(true)
    expect(canTransition('draft', 'paid')).toBe(false)
    expect(canTransition('void', 'sent')).toBe(false)
  })
})

const workspace = (): AppData => {
  const snap = { ...structuredClone(blankData), invoices: [structuredClone(invoice)], payments: [], audit: [] }
  snap.invoices[0].dueDate = '2099-12-31'
  return snap
}
const paymentInput = { invoiceId: 'i1', amount: 1200, date: '2026-01-05', method: 'Bank transfer', reference: '', note: '' }
const paymentCreated = { id: 'pay-1', createdAt: '2026-01-05T00:00:00.000Z' }

describe('payment state builder', () => {
  it('commits a valid payment with derived status', () => {
    const result = buildPaymentState(workspace(), paymentInput, paymentCreated)
    if (!result.ok) throw new Error('expected payment to be accepted')
    expect(result.state.payments[0]).toMatchObject({ id: 'pay-1', source: 'manual' })
    expect(result.state.invoices[0].status).toBe('partial')
    expect(result.state.invoices[0].paymentStatus).toBe('partial')
  })

  it('marks the invoice paid on full payment', () => {
    const result = buildPaymentState(workspace(), { ...paymentInput, amount: 3212 }, paymentCreated)
    if (!result.ok) throw new Error('expected payment to be accepted')
    expect(result.state.invoices[0].status).toBe('paid')
  })

  it('rejects non-finite, zero, negative, and over-balance amounts', () => {
    for (const amount of [NaN, 0, -5, 99999]) {
      expect(buildPaymentState(workspace(), { ...paymentInput, amount }, paymentCreated).ok).toBe(false)
    }
  })

  it('rejects missing, draft, void, and cancelled invoices', () => {
    expect(buildPaymentState(workspace(), { ...paymentInput, invoiceId: 'missing' }, paymentCreated).ok).toBe(false)
    for (const status of ['draft', 'void', 'cancelled'] as const) {
      const snap = workspace()
      snap.invoices[0].status = status
      expect(buildPaymentState(snap, paymentInput, paymentCreated).ok).toBe(false)
    }
  })

  it('rejects a payment that no longer fits changed state', () => {
    const first = buildPaymentState(workspace(), { ...paymentInput, amount: 3000 }, paymentCreated)
    if (!first.ok) throw new Error('expected first payment to be accepted')
    const second = buildPaymentState(first.state, { ...paymentInput, amount: 3000 }, { ...paymentCreated, id: 'pay-2' })
    expect(second.ok).toBe(false)
  })
})

describe('delete payment state', () => {
  it('preserves void status when deleting a payment', () => {
    const snap = workspace()
    snap.invoices[0].status = 'void'
    snap.payments = [{ id: 'p1', invoiceId: 'i1', amount: 500, date: '2026-01-05', method: 'Bank', reference: '', note: '', source: 'manual', createdAt: '' }]
    const next = buildDeletePaymentState(snap, 'p1')
    expect(next.payments).toHaveLength(0)
    expect(next.invoices[0].status).toBe('void')
  })
})

describe('mixed-currency totals', () => {
  it('aggregates by currency and labels each part', () => {
    const parts = sumByCurrency([{ amount: 100, currency: 'EUR' }, { amount: 200, currency: 'GBP' }, { amount: 50, currency: 'EUR' }])
    expect(parts).toEqual([{ currency: 'EUR', amount: 150 }, { currency: 'GBP', amount: 200 }])
    const text = formatCurrencyTotals(parts)
    expect(text).toContain('€')
    expect(text).toContain('£')
  })

  it('falls back to the given currency for empty totals', () => {
    expect(formatCurrencyTotals([], 'USD')).toBe(formatMoney(0, 'USD'))
  })
})

describe('local calendar boundaries', () => {
  it('builds month keys from local date parts', () => {
    expect(monthKeyLocal(new Date(2026, 0, 1))).toBe('2026-01')
    expect(monthKeyLocal(new Date(2026, 11, 31))).toBe('2026-12')
  })
})

describe('draft numbers', () => {
  it('derives the next unused draft number', () => {
    expect(nextDraftNumber(['Draft', 'Draft 1', 'Draft 3', 'INV-5'])).toBe('Draft 4')
    expect(nextDraftNumber([])).toBe('Draft 1')
  })
})

describe('product currency rescale', () => {
  it('preserves the major-unit amount across digit counts', () => {
    expect(convertMinorUnits(1250, 'EUR', 'JPY')).toBe(13)
    expect(convertMinorUnits(1300, 'JPY', 'EUR')).toBe(130000)
    expect(convertMinorUnits(1250, 'EUR', 'USD')).toBe(1250)
  })
})
