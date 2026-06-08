import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell,
  BellOff,
  CirclePlus,
  Database,
  Edit3,
  Gauge,
  Lock,
  Plus,
  RefreshCcw,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react'
import './App.css'
import { createProvider, createInitialState } from './data/seed'
import { createResetRule, getDefaultTimezone } from './domain/reset'
import type { AppState, LimitUnit, Provider, ProviderDraft, ProviderPlan, ResetFrequency, UsageSource } from './domain/types'
import { applyDueResets, formatUnit, summarizeProviders } from './domain/usage'
import { notifyLowUsage } from './notifications/notifications'
import { createStorageDriver, type StorageDriver } from './storage/storage'

const EMPTY_DRAFT: ProviderDraft = {
  name: '',
  plan: 'Custom',
  source: 'manual',
  limitUnit: 'messages',
  maxQuota: 100,
  usedQuota: 0,
  resetFrequency: 'daily',
  timezone: getDefaultTimezone(),
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  warningThresholdPercent: 20,
}

function App() {
  const [state, setState] = useState<AppState>(() => createInitialState())
  const [ready, setReady] = useState(false)
  const [providerModal, setProviderModal] = useState<ProviderDraft | null>(null)
  const [usageModalOpen, setUsageModalOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const storageRef = useRef<StorageDriver | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const storage = await createStorageDriver()
      const savedState = await storage.load()
      if (cancelled) return
      storageRef.current = storage
      setState(savedState ?? createInitialState())
      setReady(true)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    storageRef.current?.save(state)
  }, [ready, state])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setState((current) => applyDueResets(current))
    }, 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!ready) return
    notifyLowUsage(state, setState)
  }, [ready, state])

  useEffect(() => {
    if (!isTauriRuntime()) return

    let unlisten: undefined | (() => void)
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<string>('tray-action', (event) => {
          if (event.payload === 'add-usage') setUsageModalOpen(true)
          if (event.payload === 'settings') setSettingsOpen(true)
          if (event.payload === 'reset-first-provider') {
            setState((current) => {
              const firstProvider = current.providers[0]
              return firstProvider ? resetProvider(current, firstProvider.id) : current
            })
          }
        }),
      )
      .then((cleanup) => {
        unlisten = cleanup
      })
      .catch((error) => console.warn('Tray event listener unavailable.', error))

    return () => unlisten?.()
  }, [])

  const summaries = useMemo(() => summarizeProviders(state), [state])
  const globalStatus = summaries.some((summary) => summary.status === 'red')
    ? 'red'
    : summaries.some((summary) => summary.status === 'yellow')
      ? 'yellow'
      : 'green'

  function saveProvider(draft: ProviderDraft) {
    setState((current) => {
      if (draft.id) {
        return {
          ...current,
          providers: current.providers.map((provider) =>
            provider.id === draft.id ? updateProviderFromDraft(provider, draft) : provider,
          ),
          notificationRules: current.notificationRules.map((rule) =>
            rule.providerId === draft.id ? { ...rule, thresholdPercent: draft.warningThresholdPercent } : rule,
          ),
        }
      }

      const provider = createProviderFromDraft(draft)
      return {
        ...current,
        providers: [...current.providers, provider],
        notificationRules: [
          ...current.notificationRules,
          {
            id: crypto.randomUUID(),
            providerId: provider.id,
            enabled: true,
            thresholdPercent: draft.warningThresholdPercent,
            cooldownMinutes: 180,
          },
        ],
      }
    })
    setProviderModal(null)
  }

  function addUsage(providerId: string, amount: number) {
    setState((current) => {
      const provider = current.providers.find((item) => item.id === providerId)
      const limit = provider?.models[0]?.limits[0]
      if (!provider || !limit || !Number.isFinite(amount) || amount <= 0) return current

      return {
        ...current,
        providers: current.providers.map((item) =>
          item.id === providerId
            ? {
                ...item,
                updatedAt: new Date().toISOString(),
                models: item.models.map((model, index) =>
                  index === 0
                    ? {
                        ...model,
                        limits: model.limits.map((modelLimit, limitIndex) =>
                          limitIndex === 0
                            ? { ...modelLimit, usedQuota: Math.min(modelLimit.maxQuota, modelLimit.usedQuota + amount) }
                            : modelLimit,
                        ),
                      }
                    : model,
                ),
              }
            : item,
        ),
        usageRecords: [
          {
            id: crypto.randomUUID(),
            providerId,
            modelId: limit.modelId,
            limitId: limit.id,
            amount,
            unit: limit.unit,
            source: 'manual' as const,
            note: 'Manual entry',
            occurredAt: new Date().toISOString(),
          },
          ...current.usageRecords,
        ].slice(0, 500),
      }
    })
  }

  function toggleNotifications() {
    setState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        notificationsEnabled: !current.settings.notificationsEnabled,
      },
    }))
  }

  function resetAllData() {
    setState(createInitialState())
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className={`app-mark status-${globalStatus}`} aria-hidden="true">
            <Gauge size={20} />
          </div>
          <div>
            <h1>LLM Usage Tray</h1>
            <p>Local quota tracking for the AI tools you actually use.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" type="button" onClick={toggleNotifications} title="Toggle notifications">
            {state.settings.notificationsEnabled ? <Bell size={18} /> : <BellOff size={18} />}
          </button>
          <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} title="Settings">
            <Settings size={18} />
          </button>
          <button className="primary-button" type="button" onClick={() => setProviderModal(EMPTY_DRAFT)}>
            <CirclePlus size={18} />
            Add provider
          </button>
        </div>
      </header>

      <section className="summary-strip" aria-label="Overall usage summary">
        <SummaryItem label="Tracked tools" value={String(state.providers.length)} />
        <SummaryItem label="Low usage" value={String(summaries.filter((summary) => summary.status === 'yellow').length)} />
        <SummaryItem label="Exhausted" value={String(summaries.filter((summary) => summary.status === 'red').length)} />
        <SummaryItem label="Records" value={String(state.usageRecords.length)} />
      </section>

      <section className="provider-grid" aria-label="Provider usage">
        {summaries.map((summary) => {
          const limit = summary.limits[0]
          return (
            <article className={`provider-card status-${summary.status}`} key={summary.provider.id}>
              <div className="provider-card-header">
                <div>
                  <div className="provider-title-row">
                    <h2>{summary.provider.name}</h2>
                    <span className={`status-dot status-${summary.status}`}></span>
                  </div>
                  <p>{summary.provider.plan} plan</p>
                </div>
                <SourceBadge source={summary.provider.source} />
              </div>

              {limit ? (
                <>
                  <div className="usage-meter">
                    <div>
                      <span className="meter-value">{limit.remainingPercent}%</span>
                      <span className="meter-label">remaining</span>
                    </div>
                    <div className="meter-track" aria-hidden="true">
                      <span style={{ width: `${limit.remainingPercent}%` }}></span>
                    </div>
                  </div>

                  <dl className="usage-facts">
                    <div>
                      <dt>Used</dt>
                      <dd>
                        {formatUnit(limit.used, limit.limit.unit)} / {formatUnit(limit.limit.maxQuota, limit.limit.unit)}
                      </dd>
                    </div>
                    <div>
                      <dt>Next reset</dt>
                      <dd>{limit.resetCountdown}</dd>
                    </div>
                    <div>
                      <dt>Unit</dt>
                      <dd>{limit.limit.unit}</dd>
                    </div>
                    <div>
                      <dt>Warning</dt>
                      <dd>{limit.limit.warningThresholdPercent}%</dd>
                    </div>
                  </dl>

                  <div className="card-actions">
                    <button type="button" onClick={() => addUsage(summary.provider.id, 1)}>
                      <Plus size={16} />1
                    </button>
                    <button type="button" onClick={() => addUsage(summary.provider.id, 10)}>
                      <Plus size={16} />
                      10
                    </button>
                    <button type="button" onClick={() => setProviderModal(providerToDraft(summary.provider))}>
                      <Edit3 size={16} />
                      Edit
                    </button>
                    <button type="button" onClick={() => setState((current) => resetProvider(current, summary.provider.id))}>
                      <RefreshCcw size={16} />
                      Reset
                    </button>
                  </div>
                </>
              ) : (
                <p className="empty-note">No usage limits configured.</p>
              )}
            </article>
          )
        })}
      </section>

      <section className="privacy-note">
        <ShieldCheck size={18} />
        <span>
          This MVP stores quota data locally and never asks for ChatGPT, Claude, Gemini, Perplexity, Cursor, or Codex
          passwords.
        </span>
      </section>

      {providerModal && (
        <ProviderModal
          draft={providerModal}
          onClose={() => setProviderModal(null)}
          onSave={saveProvider}
        />
      )}
      {usageModalOpen && (
        <UsageModal
          providers={state.providers}
          onAdd={addUsage}
          onClose={() => setUsageModalOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          state={state}
          onClose={() => setSettingsOpen(false)}
          onReset={resetAllData}
          onToggleNotifications={toggleNotifications}
        />
      )}
    </main>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span>{value}</span>
      <p>{label}</p>
    </div>
  )
}

function SourceBadge({ source }: { source: UsageSource }) {
  return <span className={`source-badge source-${source}`}>{source}</span>
}

function ProviderModal({
  draft,
  onClose,
  onSave,
}: {
  draft: ProviderDraft
  onClose: () => void
  onSave: (draft: ProviderDraft) => void
}) {
  const [form, setForm] = useState(draft)

  function update<K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <Modal title={form.id ? 'Edit provider' : 'Add provider'} onClose={onClose}>
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault()
          onSave({ ...form, name: form.name.trim() || 'Custom provider' })
        }}
      >
        <label>
          Provider name
          <input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="ChatGPT" />
        </label>
        <div className="form-row">
          <label>
            Plan
            <select value={form.plan} onChange={(event) => update('plan', event.target.value as ProviderPlan)}>
              {['Free', 'Plus', 'Pro', 'Team', 'API', 'Custom'].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Data label
            <select value={form.source} onChange={(event) => update('source', event.target.value as UsageSource)}>
              <option value="manual">Manual</option>
              <option value="estimated">Estimated</option>
              <option value="official" disabled>
                Official (future adapter)
              </option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Limit type
            <select value={form.limitUnit} onChange={(event) => update('limitUnit', event.target.value as LimitUnit)}>
              {['messages', 'tokens', 'credits', 'requests', 'dollars'].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Warning at
            <input
              type="number"
              min="1"
              max="99"
              value={form.warningThresholdPercent}
              onChange={(event) => update('warningThresholdPercent', Number(event.target.value))}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Max quota
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.maxQuota}
              onChange={(event) => update('maxQuota', Number(event.target.value))}
            />
          </label>
          <label>
            Used quota
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.usedQuota}
              onChange={(event) => update('usedQuota', Number(event.target.value))}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Reset frequency
            <select
              value={form.resetFrequency}
              onChange={(event) => update('resetFrequency', event.target.value as ResetFrequency)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="customHours">Custom hours</option>
            </select>
          </label>
          <label>
            Timezone
            <input value={form.timezone} onChange={(event) => update('timezone', event.target.value)} />
          </label>
        </div>
        {form.resetFrequency === 'customHours' && (
          <label>
            Custom reset hours
            <input
              type="number"
              min="1"
              value={form.customHours ?? 24}
              onChange={(event) => update('customHours', Number(event.target.value))}
            />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            Save provider
          </button>
        </div>
      </form>
    </Modal>
  )
}

function UsageModal({
  providers,
  onAdd,
  onClose,
}: {
  providers: Provider[]
  onAdd: (providerId: string, amount: number) => void
  onClose: () => void
}) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '')
  const [amount, setAmount] = useState(1)

  return (
    <Modal title="Add usage" onClose={onClose}>
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault()
          onAdd(providerId, amount)
          onClose()
        }}
      >
        <label>
          Provider
          <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount used
          <input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            Add usage
          </button>
        </div>
      </form>
    </Modal>
  )
}

function SettingsModal({
  state,
  onClose,
  onReset,
  onToggleNotifications,
}: {
  state: AppState
  onClose: () => void
  onReset: () => void
  onToggleNotifications: () => void
}) {
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings-stack">
        <div className="settings-row">
          <div>
            <h3>Notifications</h3>
            <p>Alert once a provider reaches its warning threshold.</p>
          </div>
          <button className="secondary-button" type="button" onClick={onToggleNotifications}>
            {state.settings.notificationsEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
        <div className="settings-row">
          <div>
            <h3>Storage</h3>
            <p>Desktop builds use local SQLite. Browser dev mode uses localStorage fallback.</p>
          </div>
          <Database size={20} />
        </div>
        <div className="settings-row">
          <div>
            <h3>Privacy</h3>
            <p>No passwords, browser cookies, or cloud backend. API keys will use secure storage in a later adapter phase.</p>
          </div>
          <Lock size={20} />
        </div>
        <button type="button" className="danger-button" onClick={onReset}>
          Reset sample data
        </button>
      </div>
    </Modal>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function createProviderFromDraft(draft: ProviderDraft): Provider {
  return createProvider(
    draft.name,
    draft.plan,
    draft.source,
    draft.limitUnit,
    draft.maxQuota,
    draft.usedQuota,
    draft.resetFrequency,
    draft.timezone,
    draft.warningThresholdPercent,
    draft.customHours,
  )
}

function updateProviderFromDraft(provider: Provider, draft: ProviderDraft): Provider {
  const model = provider.models[0]
  const limit = model?.limits[0]
  const resetRule = createResetRule(draft.resetFrequency, draft.timezone, {
    customHours: draft.customHours,
    weeklyResetDay: draft.weeklyResetDay,
    monthlyResetDay: draft.monthlyResetDay,
  })

  return {
    ...provider,
    name: draft.name,
    plan: draft.plan,
    source: draft.source,
    adapterId: draft.source === 'official' ? `${draft.name.toLowerCase()}-api` : 'manual',
    updatedAt: new Date().toISOString(),
    models: [
      {
        id: model?.id ?? crypto.randomUUID(),
        providerId: provider.id,
        name: model?.name ?? 'Default',
        enabled: true,
        limits: [
          {
            id: limit?.id ?? crypto.randomUUID(),
            providerId: provider.id,
            modelId: model?.id,
            unit: draft.limitUnit,
            maxQuota: draft.maxQuota,
            usedQuota: Math.min(draft.usedQuota, draft.maxQuota),
            resetRule,
            warningThresholdPercent: draft.warningThresholdPercent,
            source: draft.source,
          },
        ],
      },
    ],
  }
}

function providerToDraft(provider: Provider): ProviderDraft {
  const limit = provider.models[0]?.limits[0]
  return {
    id: provider.id,
    name: provider.name,
    plan: provider.plan,
    source: provider.source,
    limitUnit: limit?.unit ?? 'messages',
    maxQuota: limit?.maxQuota ?? 100,
    usedQuota: limit?.usedQuota ?? 0,
    resetFrequency: limit?.resetRule.frequency ?? 'daily',
    customHours: limit?.resetRule.customHours,
    timezone: limit?.resetRule.timezone ?? getDefaultTimezone(),
    weeklyResetDay: limit?.resetRule.weeklyResetDay,
    monthlyResetDay: limit?.resetRule.monthlyResetDay,
    warningThresholdPercent: limit?.warningThresholdPercent ?? 20,
  }
}

function resetProvider(state: AppState, providerId: string): AppState {
  return {
    ...state,
    providers: state.providers.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            updatedAt: new Date().toISOString(),
            models: provider.models.map((model) => ({
              ...model,
              limits: model.limits.map((limit) => ({
                ...limit,
                usedQuota: 0,
                resetRule: createResetRule(limit.resetRule.frequency, limit.resetRule.timezone, {
                  customHours: limit.resetRule.customHours,
                  weeklyResetDay: limit.resetRule.weeklyResetDay,
                  monthlyResetDay: limit.resetRule.monthlyResetDay,
                }),
              })),
            })),
          }
        : provider,
    ),
  }
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export default App
