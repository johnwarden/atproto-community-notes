import BetterSqlite3 from 'better-sqlite3'
import { Kysely, Migrator, SqliteDialect } from 'kysely'
import { appLogger as log } from '../logger'
import { DatabaseSchema, DatabaseSchemaType } from './database-schema'
import * as migrations from './migrations'
import { CtxMigrationProvider } from './migrations/provider'

export type { DatabaseSchema }

export interface SqliteOptions {
  path: string
  readonly?: boolean
}

/**
 * Community Notes Database
 *
 * Architecture: Unified SQLite database for notes and labeler data
 * - Single database file for all Community Notes data
 * - Uses better-sqlite3 with WAL mode for better concurrency
 * - Follows same migration management patterns as before
 * - Maintains API independence and stability
 */
export class Database {
  db: DatabaseSchema
  migrator: Migrator
  destroyed = false

  get dbPath(): string {
    return this.opts.path
  }

  constructor(public opts: SqliteOptions) {
    const database = new BetterSqlite3(opts.path, {
      readonly: opts.readonly || false,
      fileMustExist: opts.readonly || false, // Read-only databases must exist
    })

    // Only set pragmas for writable databases
    if (!opts.readonly) {
      // Enable WAL mode for better concurrency
      database.pragma('journal_mode = WAL')
      database.pragma('synchronous = NORMAL')
    }
    database.pragma('foreign_keys = ON')

    this.db = new Kysely<DatabaseSchemaType>({
      dialect: new SqliteDialect({ database }),
    })

    this.migrator = new Migrator({
      db: this.db,
      provider: new CtxMigrationProvider(migrations),
    })
  }

  async migrateToLatestOrThrow(): Promise<void> {
    const { error, results } = await this.migrator.migrateToLatest()
    if (error) {
      throw error
    }
    if (results) {
      for (const result of results) {
        if (result.status === 'Error') {
          throw new Error(`Migration ${result.migrationName} failed`)
        }
        log.info(
          {
            migrationName: result.migrationName,
            status: result.status,
          },
          'Migration executed',
        )
      }
    }
  }

  async close(): Promise<void> {
    if (this.destroyed) return
    await this.db.destroy()
    this.destroyed = true
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.db.selectFrom('record').select('uri').limit(1).execute()
      return true
    } catch (err) {
      return false
    }
  }
}
