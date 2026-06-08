import type { AppState } from '../domain/types'

export interface StorageDriver {
  load(): Promise<AppState | null>
  save(state: AppState): Promise<void>
}

export async function createStorageDriver(): Promise<StorageDriver> {
  if (isTauriRuntime()) {
    try {
      const { createSqliteStorageDriver } = await import('./tauriSqliteStorage')
      return await createSqliteStorageDriver()
    } catch (error) {
      console.warn('SQLite storage unavailable; using browser localStorage fallback.', error)
    }
  }

  return new LocalStorageDriver()
}

class LocalStorageDriver implements StorageDriver {
  private key = 'llm-usage-tray-state-v1'

  async load() {
    const raw = localStorage.getItem(this.key)
    if (!raw) return null

    try {
      return JSON.parse(raw) as AppState
    } catch {
      return null
    }
  }

  async save(state: AppState) {
    localStorage.setItem(this.key, JSON.stringify(state))
  }
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
