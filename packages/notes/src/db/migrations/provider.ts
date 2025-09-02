import { Migration, MigrationProvider } from 'kysely'

/**
 * Context Migration Provider
 *
 * Pattern inspired by Bsky's migration system but independent
 * Now simplified for SQLite - no context needed
 */
export class CtxMigrationProvider implements MigrationProvider {
  constructor(
    private migrations: Record<string, Migration>,
  ) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    return this.migrations
  }
}
