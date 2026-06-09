import { invoke } from '@tauri-apps/api/core'

export interface CredentialService {
  isSecureStorageAvailable(): boolean
  setApiKey(storageKey: string, apiKey: string): Promise<void>
  hasApiKey(storageKey: string): Promise<boolean>
  removeApiKey(storageKey: string): Promise<void>
}

export function createCredentialService(): CredentialService {
  return isTauriRuntime() ? new TauriCredentialService() : new BrowserNoopCredentialService()
}

class TauriCredentialService implements CredentialService {
  isSecureStorageAvailable() {
    return true
  }

  async setApiKey(storageKey: string, apiKey: string) {
    await invoke('set_api_key', { storageKey, apiKey })
  }

  async hasApiKey(storageKey: string) {
    return invoke<boolean>('has_api_key', { storageKey })
  }

  async removeApiKey(storageKey: string) {
    await invoke('remove_api_key', { storageKey })
  }
}

class BrowserNoopCredentialService implements CredentialService {
  private volatileKeys = new Set<string>()

  isSecureStorageAvailable() {
    return false
  }

  async setApiKey(storageKey: string, apiKey: string) {
    if (apiKey.trim()) this.volatileKeys.add(storageKey)
  }

  async hasApiKey(storageKey: string) {
    return this.volatileKeys.has(storageKey)
  }

  async removeApiKey(storageKey: string) {
    this.volatileKeys.delete(storageKey)
  }
}

export function maskCredential(hasCredential?: boolean) {
  return hasCredential ? '•••••••••••• stored securely' : 'No key stored'
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
