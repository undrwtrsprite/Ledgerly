import { describe, expect, it } from 'vitest'
import { defaultAppearance } from './appearance'
import { LEGACY_STORAGE_KEYS, RECOVERY_KEY, STORAGE_KEY, chooseMigrationSource, loadPersistedData, loadRecoveryData, normalizeData, persistData } from './persistence'
import { blankData } from './seed'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const workspace = (name: string) => ({
  ...structuredClone(blankData),
  organization: { ...structuredClone(blankData.organization), tradingName: name },
})

describe('durable local persistence', () => {
  it('migrates the current versioned key without deleting it', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_STORAGE_KEYS[0], JSON.stringify(workspace('Existing studio')))

    const loaded = loadPersistedData(storage)

    expect(loaded.organization.tradingName).toBe('Existing studio')
    expect(storage.getItem(STORAGE_KEY)).toContain('Existing studio')
    expect(storage.getItem(LEGACY_STORAGE_KEYS[0])).toContain('Existing studio')
    expect(storage.getItem(RECOVERY_KEY)).toContain('Existing studio')
  })

  it('keeps the previous valid save as an automatic recovery copy', () => {
    const storage = new MemoryStorage()
    persistData(storage, workspace('Before update'))
    persistData(storage, workspace('After update'))

    expect(loadPersistedData(storage).organization.tradingName).toBe('After update')
    expect(loadRecoveryData(storage)?.organization.tradingName).toBe('Before update')
  })

  it('recovers from a damaged primary value', () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, '{damaged')
    storage.setItem(RECOVERY_KEY, JSON.stringify(workspace('Recovered studio')))

    expect(loadPersistedData(storage).organization.tradingName).toBe('Recovered studio')
    expect(storage.getItem(STORAGE_KEY)).toContain('Recovered studio')
  })

  it('fills new settings when loading an older workspace shape', () => {
    const storage = new MemoryStorage()
    const older = workspace('Older studio') as unknown as Record<string, unknown>
    older.organization = { id: 'old', tradingName: 'Older studio' }
    storage.setItem(LEGACY_STORAGE_KEYS[1], JSON.stringify(older))

    const loaded = loadPersistedData(storage)

    expect(loaded.organization.tradingName).toBe('Older studio')
    expect(loaded.organization.taxRates.length).toBeGreaterThan(0)
    expect(loaded.organization.reminders).toBeDefined()
  })

  it('gives older invoices a stable document language', () => {
    const storage = new MemoryStorage()
    const older = workspace('Deutsches Studio')
    older.organization.locale = 'de-DE'
    older.organization.defaultInvoiceLocale = undefined
    older.invoices.push({ id: 'invoice-old', number: 'RE-1', clientId: '', status: 'draft', paymentStatus: 'unpaid', issueDate: '2026-09-01', dueDate: '2026-09-15', currency: 'EUR', reference: '', lineItems: [], invoiceDiscountBps: 0, additionalCharges: 0, notes: '', paymentTerms: '', paymentInstructions: '', createdAt: '', updatedAt: '' })
    storage.setItem(STORAGE_KEY, JSON.stringify(older))

    expect(loadPersistedData(storage).invoices[0].documentLocale).toBe('de-DE')
  })

  it('chooses the richer workspace during first native-file migration', () => {
    const local = workspace('Installed workspace')
    local.clients.push({ id: 'client-1', company: 'Kept client', contact: '', email: '', phone: '', address: '', taxId: '', currency: 'EUR', notes: '', archived: false, createdAt: '', updatedAt: '' })
    const accidentalEmptyNative = workspace('')

    expect(chooseMigrationSource(local, accidentalEmptyNative).clients[0].company).toBe('Kept client')
  })

  it('fills appearance defaults without touching legacy snapshots', () => {
    const older = workspace('Legacy studio') as unknown as Record<string, unknown>
    older.organization = { id: 'old', tradingName: 'Legacy studio', brandColor: '#112233' }
    older.invoices = [{ id: 'inv-old', number: 'INV-9', clientId: '', status: 'sent', paymentStatus: 'unpaid', issueDate: '2026-01-01', dueDate: '2026-01-15', currency: 'EUR', reference: '', lineItems: [], invoiceDiscountBps: 0, additionalCharges: 0, notes: '', paymentTerms: '', paymentInstructions: '', createdAt: '', updatedAt: '', snapshot: { businessName: 'Legacy studio', businessAddress: '', businessEmail: '', businessTaxId: '', brandColor: '#112233', clientName: '', clientContact: '', clientAddress: '', clientEmail: '', clientTaxId: '' } }]
    const loaded = normalizeData(older as never)
    expect(loaded.organization.invoiceAppearanceDefaults).toBeUndefined()
    expect(loaded.invoices[0].appearance).toBeUndefined()
    expect(loaded.invoices[0].snapshot?.brandColor).toBe('#112233')
    expect(loaded.invoices[0].snapshot?.appearance).toBeUndefined()
  })

  it('normalizes stored appearance records', () => {
    const snap = workspace('Appearance studio')
    snap.organization.invoiceAppearanceDefaults = { ...defaultAppearance(), template: 'bold' }
    snap.invoices = [{ id: 'inv-a', number: 'Draft 1', clientId: '', status: 'draft', paymentStatus: 'unpaid', issueDate: '2026-01-01', dueDate: '2026-01-15', currency: 'EUR', reference: '', lineItems: [], invoiceDiscountBps: 0, additionalCharges: 0, notes: '', paymentTerms: '', paymentInstructions: '', createdAt: '', updatedAt: '', appearance: { template: 'modern' } }]
    const loaded = normalizeData(snap as never)
    expect(loaded.organization.invoiceAppearanceDefaults?.template).toBe('bold')
    expect(loaded.organization.invoiceAppearanceDefaults?.fontPair).toBe('clean')
    expect(loaded.invoices[0].appearance?.template).toBe('modern')
    expect(loaded.invoices[0].appearance?.density).toBe('comfortable')
  })
})
