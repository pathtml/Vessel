import Database from '@tauri-apps/plugin-sql'
import type { AppState } from '../domain/types'
import type { StorageDriver } from './storage'

interface StateRow {
  id: string
  payload: string
  updated_at: string
}

export async function createSqliteStorageDriver(): Promise<StorageDriver> {
  const db = await Database.load('sqlite:ai_usage_dock.db')
  const legacyDb = await Database.load('sqlite:llm_usage_tray.db')
  await db.execute(
    `CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  )
  await legacyDb.execute(
    `CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  )
  return new TauriSqliteStorageDriver(db, legacyDb)
}

class TauriSqliteStorageDriver implements StorageDriver {
  private db: Database
  private legacyDb: Database

  constructor(db: Database, legacyDb: Database) {
    this.db = db
    this.legacyDb = legacyDb
  }

  async load() {
    const rows = await this.db.select<StateRow[]>('SELECT * FROM app_state WHERE id = $1 LIMIT 1', ['main'])
    if (!rows[0]) {
      const legacyRows = await this.legacyDb.select<StateRow[]>('SELECT * FROM app_state WHERE id = $1 LIMIT 1', ['main'])
      if (!legacyRows[0]) return null
      try {
        return JSON.parse(legacyRows[0].payload) as AppState
      } catch {
        return null
      }
    }

    try {
      return JSON.parse(rows[0].payload) as AppState
    } catch {
      return null
    }
  }

  async save(state: AppState) {
    await this.db.execute(
      `INSERT INTO app_state (id, payload, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      ['main', JSON.stringify(state), new Date().toISOString()],
    )
  }
}
