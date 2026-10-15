import type { AppStateDto, ConnectResult, Settings } from './types'

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

/** In a plain browser (design/dev work) there is no backend, so use a small in-memory fake. */
const fake: AppStateDto = {
  settings: {
    consentAccepted: !location.search.includes('onboarding'),
    onboardingDone: !location.search.includes('onboarding'),
    connected: ['codex'],
    openAtLogin: false,
    alertsEnabled: true,
    lowThreshold: 20,
    quietStart: null,
    quietEnd: null,
    refreshMinutes: 5,
  },
  providers: [
    { id: 'codex', displayName: 'Codex', state: 'connected', hint: 'Connected.' },
    { id: 'claude', displayName: 'Claude', state: 'ready', hint: 'Claude Code found.' },
    { id: 'gemini', displayName: 'Gemini', state: 'comingSoon', hint: 'Gemini app usage cannot be read automatically yet.' },
  ],
  v1Found: location.search.includes('onboarding'),
}

export const api = {
  getAppState: (): Promise<AppStateDto> =>
    inTauri ? call('get_app_state') : Promise.resolve(structuredClone(fake)),

  acceptConsent: async (): Promise<void> => {
    if (inTauri) return call('accept_consent')
    fake.settings.consentAccepted = true
  },

  connectProvider: async (id: string, force: boolean): Promise<ConnectResult> => {
    if (inTauri) return call('connect_provider', { id, force })
    fake.settings.connected.push(id)
    const p = fake.providers.find((x) => x.id === id)
    if (p) p.state = 'connected'
    return { ok: true, status: 'connected', message: 'Connected.' }
  },

  disconnectProvider: async (id: string): Promise<void> => {
    if (inTauri) return call('disconnect_provider', { id })
    fake.settings.connected = fake.settings.connected.filter((c) => c !== id)
    const p = fake.providers.find((x) => x.id === id)
    if (p) p.state = 'ready'
  },

  completeOnboarding: async (openAtLogin: boolean): Promise<void> => {
    if (inTauri) return call('complete_onboarding', { openAtLogin })
    fake.settings.onboardingDone = true
    fake.settings.openAtLogin = openAtLogin
  },

  saveSettings: async (edits: Settings): Promise<Settings> => {
    if (inTauri) return call('save_settings', { edits })
    fake.settings = { ...fake.settings, ...edits, consentAccepted: fake.settings.consentAccepted }
    return structuredClone(fake.settings)
  },

  openSettings: async (): Promise<void> => {
    if (inTauri) return call('open_settings')
    window.open('/?view=settings', '_blank')
  },
}
