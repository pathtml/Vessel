/** Mirrors the Rust model in src-tauri/src/model.rs (camelCase over the wire). */
export type Health =
  | 'ok'
  | 'signInAgain'
  | 'offline'
  | 'sourceChanged'
  | 'waitingForFirstUse'
  | 'notConnected'
  | 'comingSoon'

export interface UsageWindow {
  label: string
  usedPct: number
  remainingPct: number
  /** Unix seconds. */
  resetsAt: number | null
}

export interface UsageSnapshot {
  provider: string
  displayName: string
  windows: UsageWindow[]
  /** Unix seconds. */
  fetchedAt: number
  health: Health
  message: string | null
}

export type DetectState = 'ready' | 'needsSignIn' | 'notInstalled' | 'connected' | 'comingSoon'

export interface ProviderStatus {
  id: string
  displayName: string
  state: DetectState
  hint: string
}

export interface Settings {
  consentAccepted: boolean
  onboardingDone: boolean
  connected: string[]
  openAtLogin: boolean
  alertsEnabled: boolean
  lowThreshold: number
  quietStart: number | null
  quietEnd: number | null
  refreshMinutes: number
}

export interface AppStateDto {
  settings: Settings
  providers: ProviderStatus[]
  v1Found: boolean
}

export type ConnectStatus = 'connected' | 'conflict' | 'needsSignIn' | 'notInstalled' | 'error'

export interface ConnectResult {
  ok: boolean
  status: ConnectStatus
  message: string
}
