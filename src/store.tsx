import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildDeletePaymentState, buildPaymentState, canTransition, uid } from './domain'
import { resolveAppearance } from './appearance'
import { chooseMigrationSource, loadPersistedData, loadRecoveryData, normalizeData, persistData, recoveryAvailable } from './persistence'
import { FRONTEND_VERSION } from './release'
import type { AppData, AuditEvent, Client, Invoice, Organization, Payment, Product } from './types'

interface StoreValue {
  data: AppData
  hasRecovery: boolean
  saveInvoice: (invoice: Invoice) => void
  deleteDraft: (id: string) => void
  transitionInvoice: (id: string, status: Invoice['status']) => void
  addPayment: (payment: Omit<Payment, 'id' | 'createdAt' | 'source'>) => { ok: boolean; error?: string }
  deletePayment: (id: string) => void
  saveClient: (client: Client) => void
  saveProduct: (product: Product) => void
  saveOrganization: (organization: Organization) => void
  importData: (data: AppData) => void
  restoreRecovery: () => AppData | null
}

const StoreContext = createContext<StoreValue | null>(null)

const load = (): AppData => loadPersistedData(localStorage)

const event = (type: string, message: string, invoiceId?: string): AuditEvent => ({ id: uid(), type, message, invoiceId, actor: 'You', at: new Date().toISOString() })

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(load)
  const [hasRecovery, setHasRecovery] = useState(() => recoveryAvailable(localStorage))
  const [nativeReady, setNativeReady] = useState(() => !window.ledgerlyStorage)
  const initialData = useRef(data)
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])

  useEffect(() => {
    const native = window.ledgerlyStorage
    if (!native) return
    native.load().then(saved => {
      if (!saved) return native.save(initialData.current)
      const resolved = saved.established ? normalizeData(saved.data) : chooseMigrationSource(initialData.current, saved.data)
      setData(resolved)
      if (!saved.established) return native.save(resolved)
    }).catch(() => undefined).finally(() => setNativeReady(true))
  }, [])

  useEffect(() => {
    persistData(localStorage, data)
    setHasRecovery(recoveryAvailable(localStorage))
    if (nativeReady) window.ledgerlyStorage?.save(data).catch(() => undefined)
  }, [data, nativeReady])

  useEffect(() => {
    if (nativeReady) window.ledgerlyUpdates?.booted(FRONTEND_VERSION)?.catch(() => undefined)
  }, [nativeReady])

  const saveInvoice = useCallback((invoice: Invoice) => setData(prev => {
    const exists = prev.invoices.some(item => item.id === invoice.id)
    return { ...prev, invoices: exists ? prev.invoices.map(item => item.id === invoice.id ? invoice : item) : [invoice, ...prev.invoices], audit: [event(exists ? 'invoice.edited' : 'invoice.created', `${invoice.number} ${exists ? 'updated' : 'created'}`, invoice.id), ...prev.audit] }
  }), [])

  const deleteDraft = useCallback((id: string) => setData(prev => {
    const invoice = prev.invoices.find(item => item.id === id)
    if (!invoice || invoice.status !== 'draft') return prev
    return { ...prev, invoices: prev.invoices.filter(item => item.id !== id), audit: [event('invoice.deleted', `${invoice.number} draft deleted`, id), ...prev.audit] }
  }), [])

  const transitionInvoice = useCallback((id: string, status: Invoice['status']) => setData(prev => {
    const target = prev.invoices.find(item => item.id === id)
    if (!target || !canTransition(target.status, status)) return prev
    const client = prev.clients.find(item => item.id === target.clientId)
    const isFinalizing = target.status === 'draft' && status === 'finalized'
    const number = isFinalizing ? `${prev.organization.invoicePrefix}${prev.organization.nextInvoiceNumber}` : target.number
    const snapshot = isFinalizing ? { businessName: prev.organization.tradingName || prev.organization.legalName, businessAddress: prev.organization.address, businessEmail: prev.organization.email, businessTaxId: prev.organization.taxId, brandColor: prev.organization.brandColor, logoDataUrl: prev.organization.logoDataUrl, clientName: client?.company || '', clientContact: client?.contact || '', clientAddress: client?.address || '', clientEmail: client?.email || '', clientTaxId: client?.taxId || '', appearance: structuredClone(resolveAppearance(target, prev.organization)) } : target.snapshot
    const next = { ...target, number, status, snapshot, updatedAt: new Date().toISOString(), sentAt: status === 'sent' ? new Date().toISOString() : target.sentAt }
    return { ...prev, organization: isFinalizing ? { ...prev.organization, nextInvoiceNumber: prev.organization.nextInvoiceNumber + 1 } : prev.organization, invoices: prev.invoices.map(item => item.id === id ? next : item), audit: [event(`invoice.${status}`, `${number} marked ${status}`, id), ...prev.audit] }
  }), [])

  const addPayment = useCallback((payment: Omit<Payment, 'id' | 'createdAt' | 'source'>) => {
    const created = { id: uid(), createdAt: new Date().toISOString() }
    const result = buildPaymentState(dataRef.current, payment, created)
    if (!result.ok) return result
    dataRef.current = result.state
    setData(result.state)
    return { ok: true as const }
  }, [])

  const deletePayment = useCallback((id: string) => {
    const next = buildDeletePaymentState(dataRef.current, id)
    if (next === dataRef.current) return
    dataRef.current = next
    setData(next)
  }, [])

  const saveClient = useCallback((client: Client) => setData(prev => ({ ...prev, clients: prev.clients.some(c => c.id === client.id) ? prev.clients.map(c => c.id === client.id ? client : c) : [client, ...prev.clients] })), [])
  const saveProduct = useCallback((product: Product) => setData(prev => ({ ...prev, products: prev.products.some(p => p.id === product.id) ? prev.products.map(p => p.id === product.id ? product : p) : [product, ...prev.products] })), [])
  const saveOrganization = useCallback((organization: Organization) => setData(prev => ({ ...prev, organization })), [])
  const importData = useCallback((next: AppData) => setData(normalizeData(next)), [])
  const restoreRecovery = useCallback(() => { const recovered = loadRecoveryData(localStorage); if (!recovered) return null; setData(recovered); return recovered }, [])

  const value = useMemo(() => ({ data, hasRecovery, saveInvoice, deleteDraft, transitionInvoice, addPayment, deletePayment, saveClient, saveProduct, saveOrganization, importData, restoreRecovery }), [data, hasRecovery, saveInvoice, deleteDraft, transitionInvoice, addPayment, deletePayment, saveClient, saveProduct, saveOrganization, importData, restoreRecovery])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside StoreProvider')
  return value
}
