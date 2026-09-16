import type { AppData } from './types'

declare global {
  type UpdatePhase = 'current' | 'checking' | 'available' | 'downloading' | 'ready' | 'failed' | 'disabled'

  interface UpdateStatusInfo {
    supported: boolean
    enabled: boolean
    shell: string
    frontend: string | null
    phase: UpdatePhase
    pending: string | null
    failure: string | null
    lastCheck: string | null
    notes: string[]
    security: boolean
  }

  interface Window {
    ledgerlyStorage?: {
      load: () => Promise<{ established: boolean; data: AppData } | null>
      save: (data: AppData) => Promise<void>
      platform: string
    }
    ledgerlyUpdates?: {
      status: () => Promise<UpdateStatusInfo>
      check: (frontend: string) => Promise<UpdateStatusInfo>
      restart: () => Promise<{ ok: boolean; reason?: string }>
      booted: (version: string) => Promise<{ ok: boolean }>
    }
    __ledgerlyEditorDirty?: boolean
  }
}

export {}
