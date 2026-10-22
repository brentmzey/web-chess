import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tryCatch, type Result } from '../../utils/fp';
import { logger } from '../../utils/logger';

/**
 * Manages the SQLite database connection, PRAGMAs, migrations and schema creation.
 */
export class SanctuaryDatabase {
  private db: Database;
  private isClosed: boolean = false;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.initPragmas();
    this.applySchema();
  }

  private initPragmas(): void {
    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA synchronous = NORMAL;');
  }

  private applySchema(): void {
    const schemaPath = resolve(__dirname, 'schema.sql');
    const sql = readFileSync(schemaPath, 'utf-8');
    this.db.exec(sql);
    logger.info('[DB] Sanctuary Chess SQL Schema successfully initialized with foreign keys and indices.');
  }

  public getRawDb(): Database {
    return this.db;
  }

  /**
   * Executes an operation inside a transactional boundary.
   * Automatically rolls back on failure and commits on success.
   */
  public transaction<T>(operation: () => T): Result<T, string> {
    const tx = this.db.transaction(operation);
    return tryCatch(() => tx(), err => (err instanceof Error ? err.message : String(err)));
  }

  public close(): void {
    if (!this.isClosed) {
      this.db.close();
      this.isClosed = true;
    }
  }
}
