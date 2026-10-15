import { ProviderRow, ProviderSkeleton } from './components/ProviderRow'
import { Onboarding } from './components/Onboarding'
import { SettingsView } from './components/SettingsView'
import { api } from './api'
import { formatAgo, lastUpdated } from './lib/format'
import { useAppState } from './hooks/useAppState'
import { useNow, useSnapshots } from './hooks/useSnapshots'

export default function App() {
  const { appState, reload } = useAppState()

  if (appState === null) {
    return (
      <main className="h-screen space-y-2 bg-slate-100 p-3 dark:bg-slate-900">
        <ProviderSkeleton />
        <ProviderSkeleton />
      </main>
    )
  }
  if (new URLSearchParams(location.search).get('view') === 'settings') {
    return <SettingsView state={appState} onChanged={reload} />
  }
  if (!appState.settings.onboardingDone) {
    return <Onboarding state={appState} onChanged={reload} />
  }
  return <Popup onChanged={reload} />
}

function Popup({ onChanged }: { onChanged: () => void }) {
  const { snapshots, refreshing, refresh } = useSnapshots()
  const nowMs = useNow()
  const updated = snapshots ? lastUpdated(snapshots) : null

  async function disconnect(id: string) {
    await api.disconnectProvider(id)
    onChanged()
    void refresh()
  }

  return (
    <main className="flex h-screen flex-col bg-slate-100 p-3 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex-1 space-y-2 overflow-y-auto">
        {snapshots === null ? (
          <>
            <ProviderSkeleton />
            <ProviderSkeleton />
          </>
        ) : snapshots.length === 0 ? (
          <p className="p-4 text-center text-sm text-slate-500">Looking for your AI tools…</p>
        ) : (
          snapshots.map((s) => (
            <ProviderRow
              key={s.provider}
              snapshot={s}
              nowMs={nowMs}
              onRetry={refresh}
              onConnected={() => {
                onChanged()
                void refresh()
              }}
              onDisconnect={disconnect}
            />
          ))
        )}
      </div>
      <footer className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{updated === null ? 'Not updated yet' : `Updated ${formatAgo(updated, nowMs)}`}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={() => void api.openSettings()}
            className="rounded-md px-2 py-1 text-base leading-none text-slate-700 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            &#9881;
          </button>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="rounded-md px-2 py-1 font-medium text-slate-700 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        </div>
      </footer>
    </main>
  )
}
