import { normalizeAppearance } from './appearance'
import { blankData } from './seed'
import type { AppData } from './types'

export const STORAGE_KEY = 'ledgerly-data'
export const RECOVERY_KEY = 'ledgerly-data-recovery'
export const LEGACY_STORAGE_KEYS = ['ledgerly-data-v2', 'ledgerly-data-v1'] as const
export const SCHEMA_VERSION = 1

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

interface StorageEnvelope {
  schemaVersion: number
  savedAt: string
  data: AppData
}

export const normalizeData = (input: Partial<AppData>): AppData => ({
  ...structuredClone(blankData),
  ...input,
  organization: {
    ...structuredClone(blankData.organization),
    ...(input.organization || {}),
    reminders: { ...blankData.organization.reminders, ...(input.organization?.reminders || {}) },
    taxRates: input.organization?.taxRates?.length ? input.organization.taxRates : structuredClone(blankData.organization.taxRates),
    invoiceAppearanceDefaults: input.organization?.invoiceAppearanceDefaults ? normalizeAppearance(input.organization.invoiceAppearanceDefaults) : undefined,
  },
  clients: Array.isArray(input.clients) ? input.clients : [],
  products: Array.isArray(input.products) ? input.products : [],
  invoices: Array.isArray(input.invoices) ? input.invoices.map(invoice => ({
    ...invoice,
    documentLocale: invoice.documentLocale || input.organization?.defaultInvoiceLocale || (input.organization?.locale?.startsWith('de') ? 'de-DE' : 'en-GB'),
    appearance: invoice.appearance ? normalizeAppearance(invoice.appearance) : undefined,
    snapshot: invoice.snapshot ? { ...invoice.snapshot, appearance: invoice.snapshot.appearance ? normalizeAppearance(invoice.snapshot.appearance) : undefined } : undefined,
  })) : [],
  payments: Array.isArray(input.payments) ? input.payments : [],
  audit: Array.isArray(input.audit) ? input.audit : [],
})

const decode = (raw: string | null): AppData | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AppData> | Partial<StorageEnvelope>
    const candidate = 'data' in parsed && parsed.data ? parsed.data : parsed
    if (!candidate || typeof candidate !== 'object' || !('organization' in candidate)) return null
    return normalizeData(candidate as Partial<AppData>)
  } catch {
    return null
  }
}

const encode = (data: AppData): string => JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), data } satisfies StorageEnvelope)

export function loadPersistedData(storage: StorageLike): AppData {
  const current = decode(storage.getItem(STORAGE_KEY))
  if (current) return current

  const recovery = decode(storage.getItem(RECOVERY_KEY))
  if (recovery) {
    storage.setItem(STORAGE_KEY, encode(recovery))
    return recovery
  }

  for (const key of LEGACY_STORAGE_KEYS) {
    const raw = storage.getItem(key)
    const legacy = decode(raw)
    if (!legacy || !raw) continue
    storage.setItem(RECOVERY_KEY, raw)
    storage.setItem(STORAGE_KEY, encode(legacy))
    return legacy
  }

  return structuredClone(blankData)
}

export function persistData(storage: StorageLike, data: AppData) {
  const currentRaw = storage.getItem(STORAGE_KEY)
  if (decode(currentRaw)) storage.setItem(RECOVERY_KEY, currentRaw!)
  storage.setItem(STORAGE_KEY, encode(normalizeData(data)))
}

export const recoveryAvailable = (storage: StorageLike) => Boolean(decode(storage.getItem(RECOVERY_KEY)))

export const loadRecoveryData = (storage: StorageLike): AppData | null => decode(storage.getItem(RECOVERY_KEY))

export const workspaceScore = (data: AppData) => {
  const records = data.clients.length + data.products.length + data.invoices.length + data.payments.length + data.audit.length
  const identity = [data.organization.legalName, data.organization.tradingName, data.organization.address, data.organization.email, data.organization.taxId].filter(value => value?.trim()).length
  return records * 100 + identity
}

export const chooseMigrationSource = (local: AppData, native: AppData) => workspaceScore(local) >= workspaceScore(native) ? normalizeData(local) : normalizeData(native)
