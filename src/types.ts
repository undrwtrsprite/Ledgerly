import type { InvoiceAppearance } from './appearance'

export type InvoiceStatus = 'draft' | 'finalized' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void' | 'cancelled'

export interface Organization {
  id: string
  ownerName: string
  legalName: string
  tradingName: string
  email: string
  phone: string
  website: string
  address: string
  taxId: string
  currency: string
  locale: string
  defaultInvoiceLocale?: 'en-GB' | 'de-DE'
  timeZone: string
  paymentTermsDays: number
  invoicePrefix: string
  nextInvoiceNumber: number
  accountHolder?: string
  bankName?: string
  iban?: string
  bic?: string
  bankInstructions: string
  defaultNotes: string
  brandColor: string
  logoDataUrl?: string
  invoiceAppearanceDefaults?: InvoiceAppearance
  defaultTaxRateBps: number
  taxRates: { id: string; name: string; rateBps: number }[]
  reminders: {
    enabled: boolean
    dueSoonDays: number
    overdueFollowUpDays: number
    includeDueToday: boolean
  }
}

export interface Client {
  id: string
  company: string
  contact: string
  email: string
  phone: string
  address: string
  taxId: string
  currency: string
  notes: string
  logoDataUrl?: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface Product {
  id: string
  name: string
  description: string
  unit: string
  unitPrice: number
  currency: string
  taxRate: number
  active: boolean
}

export interface LineItem {
  id: string
  description: string
  quantityMilli: number
  unitPrice: number
  taxRateBps: number
  discountBps: number
}

export interface Payment {
  id: string
  invoiceId: string
  amount: number
  date: string
  method: string
  reference: string
  note: string
  source: 'manual' | 'reconciled' | 'provider'
  createdAt: string
}

export interface InvoiceSnapshot {
  businessName: string
  businessAddress: string
  businessEmail: string
  businessTaxId: string
  brandColor?: string
  logoDataUrl?: string
  clientName: string
  clientContact: string
  clientAddress: string
  clientEmail: string
  clientTaxId: string
  appearance?: InvoiceAppearance
}

export interface Invoice {
  id: string
  number: string
  clientId: string
  status: InvoiceStatus
  paymentStatus: 'unpaid' | 'partial' | 'paid'
  issueDate: string
  dueDate: string
  currency: string
  documentLocale?: 'en-GB' | 'de-DE'
  reference: string
  lineItems: LineItem[]
  invoiceDiscountBps: number
  additionalCharges: number
  notes: string
  paymentTerms: string
  paymentInstructions: string
  snapshot?: InvoiceSnapshot
  appearance?: InvoiceAppearance
  createdAt: string
  updatedAt: string
  sentAt?: string
}

export interface AuditEvent {
  id: string
  type: string
  message: string
  invoiceId?: string
  actor: 'You' | 'System'
  at: string
}

export interface AppData {
  organization: Organization
  clients: Client[]
  products: Product[]
  invoices: Invoice[]
  payments: Payment[]
  audit: AuditEvent[]
  onboardingComplete: boolean
}

export type View = 'dashboard' | 'invoices' | 'clients' | 'products' | 'payments' | 'reports' | 'settings'
