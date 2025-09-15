import sqlite3 from 'sqlite3';
import { MemoryEntry, SearchOptions, SearchResult } from '../types/index.js';
import { randomUUID } from 'crypto';

export class SQLiteProvider {
  private db: sqlite3.Database | null = null;
  private dbPath: string;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.isInitializing || this.db) {
      return;
    }

    this.isInitializing = true;
    this.initPromise = new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          this.isInitializing = false;
          reject(err);
          return;
        }

        console.error(`SQLite database connected: ${this.dbPath}`);
        this.createTables()
          .then(() => {
            this.isInitializing = false;
            resolve();
          })
          .catch((error) => {
            this.isInitializing = false;
            reject(error);
          });
      });
    });

    return this.initPromise;
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = `
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        context TEXT NOT NULL DEFAULT '',
        importance INTEGER NOT NULL DEFAULT 5,
        timestamp TEXT NOT NULL,
        lastAccessed TEXT NOT NULL,
        accessCount INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `;

    return new Promise((resolve, reject) => {
      this.db!.run(sql, (err) => {
        if (err) {
          console.error('Error creating tables:', err);
          reject(err);
          return;
        }

        const indexes = [
          'CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp)',
          'CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)',
          'CREATE INDEX IF NOT EXISTS idx_memories_context ON memories(context)',
          'CREATE INDEX IF NOT EXISTS idx_memories_lastAccessed ON memories(lastAccessed)'
        ];

        let indexCount = 0;
        const createNextIndex = () => {
          if (indexCount >= indexes.length) {
            console.error('Database tables and indexes created');
            resolve();
            return;
          }

          this.db!.run(indexes[indexCount], (err) => {
            if (err) {
              console.error(`Error creating index ${indexCount}:`, err);
              reject(err);
              return;
            }
            indexCount++;
            createNextIndex();
          });
        };

        createNextIndex();
      });
    });
  }

  async addMemory(memory: Omit<MemoryEntry, 'id' | 'timestamp' | 'lastAccessed' | 'accessCount'>, id?: string): Promise<MemoryEntry> {
    if (!this.db) throw new Error('Database not initialized');

    const entry: MemoryEntry = {
      id: id || randomUUID(),
      content: memory.content,
      tags: memory.tags || [],
      context: memory.context || '',
      importance: memory.importance || 5,
      timestamp: new Date(),
      lastAccessed: new Date(),
      accessCount: 0,
      metadata: memory.metadata || {}
    };

    const sql = `
      INSERT INTO memories (id, content, tags, context, importance, timestamp, lastAccessed, accessCount, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      entry.id,
      entry.content,
      JSON.stringify(entry.tags),
      entry.context,
      entry.importance,
      entry.timestamp.toISOString(),
      entry.lastAccessed.toISOString(),
      entry.accessCount,
      JSON.stringify(entry.metadata)
    ];

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function(err) {
        if (err) {
          console.error('Error adding memory:', err);
          reject(err);
          return;
        }
        resolve(entry);
      });
    });
  }

  async searchMemories(options: SearchOptions): Promise<SearchResult> {
    if (!this.db) throw new Error('Database not initialized');

    const startTime = Date.now();
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params: any[] = [];

    if (options.query) {
      sql += ' AND content LIKE ?';
      params.push(`%${options.query}%`);
    }

    if (options.tags && options.tags.length > 0) {
      const tagConditions = options.tags.map(() => 'tags LIKE ?').join(' OR ');
      sql += ` AND (${tagConditions})`;
      options.tags.forEach(tag => params.push(`%"${tag}"%`));
    }

    if (options.contextFilter) {
      sql += ' AND context LIKE ?';
      params.push(`%${options.contextFilter}%`);
    }

    if (options.importanceThreshold) {
      sql += ' AND importance >= ?';
      params.push(options.importanceThreshold);
    }

    const sortBy = options.sortBy || 'timestamp';
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortBy} ${sortOrder}`;

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows: any[]) => {
        if (err) {
          console.error('Error searching memories:', err);
          reject(err);
          return;
        }

        const entries: MemoryEntry[] = rows.map(row => ({
          id: row.id,
          content: row.content,
          tags: JSON.parse(row.tags),
          context: row.context,
          importance: row.importance,
          timestamp: new Date(row.timestamp),
          lastAccessed: new Date(row.lastAccessed),
          accessCount: row.accessCount,
          metadata: JSON.parse(row.metadata)
        }));

        const searchTime = Date.now() - startTime;

        if (entries.length > 0) {
          this.updateAccessCount(entries.map(e => e.id)).catch(err => {
            console.error('Error updating access count:', err);
          });
        }

        resolve({
          entries,
          totalFound: entries.length,
          searchTime
        });
      });
    });
  }

  async getRecentMemories(limit: number = 20): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = 'SELECT * FROM memories ORDER BY timestamp DESC LIMIT ?';

    return new Promise((resolve, reject) => {
      this.db!.all(sql, [limit], (err, rows: any[]) => {
        if (err) {
          console.error('Error getting recent memories:', err);
          reject(err);
          return;
        }

        const entries: MemoryEntry[] = rows.map(row => ({
          id: row.id,
          content: row.content,
          tags: JSON.parse(row.tags),
          context: row.context,
          importance: row.importance,
          timestamp: new Date(row.timestamp),
          lastAccessed: new Date(row.lastAccessed),
          accessCount: row.accessCount,
          metadata: JSON.parse(row.metadata)
        }));

        resolve(entries);
      });
    });
  }

  async getAllMemories(): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = 'SELECT * FROM memories ORDER BY timestamp DESC';

    return new Promise((resolve, reject) => {
      this.db!.all(sql, [], (err, rows: any[]) => {
        if (err) {
          console.error('Error getting all memories:', err);
          reject(err);
          return;
        }

        const entries: MemoryEntry[] = rows.map(row => ({
          id: row.id,
          content: row.content,
          tags: JSON.parse(row.tags),
          context: row.context,
          importance: row.importance,
          timestamp: new Date(row.timestamp),
          lastAccessed: new Date(row.lastAccessed),
          accessCount: row.accessCount,
          metadata: JSON.parse(row.metadata)
        }));

        resolve(entries);
      });
    });
  }

  async getStats(): Promise<{ totalEntries: number; lastModified: Date | null }> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = 'SELECT COUNT(*) as count, MAX(timestamp) as lastModified FROM memories';

    return new Promise((resolve, reject) => {
      this.db!.get(sql, [], (err, row: any) => {
        if (err) {
          console.error('Error getting stats:', err);
          reject(err);
          return;
        }

        resolve({
          totalEntries: row.count,
          lastModified: row.lastModified ? new Date(row.lastModified) : null
        });
      });
    });
  }

  /**
   * Delete memories by id or by a set of filter options.
   * Returns the number of deleted rows.
   */
  async deleteMemories(options: { id?: string; tags?: string[]; context?: string; query?: string; importanceLessThan?: number; before?: string; force?: boolean }): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    const hasFilters = !!(options.id || (options.tags && options.tags.length > 0) || options.context || options.query || typeof options.importanceLessThan === 'number' || options.before);
    if (!hasFilters && !options.force) {
      throw new Error('Refusing to delete all memories without filters. Provide at least one filter or set force=true.');
    }

    let sql = 'DELETE FROM memories WHERE 1=1';
    const params: any[] = [];

    if (options.id) {
      sql = 'DELETE FROM memories WHERE id = ?';
      params.push(options.id);
    } else {
      if (options.query) {
        sql += ' AND content LIKE ?';
        params.push(`%${options.query}%`);
      }

      if (options.tags && options.tags.length > 0) {
        const tagConditions = options.tags.map(() => 'tags LIKE ?').join(' OR ');
        sql += ` AND (${tagConditions})`;
        options.tags.forEach(tag => params.push(`%"${tag}"%`));
      }

      if (options.context) {
        sql += ' AND context LIKE ?';
        params.push(`%${options.context}%`);
      }

      if (typeof options.importanceLessThan === 'number') {
        sql += ' AND importance < ?';
        params.push(options.importanceLessThan);
      }

      if (options.before) {
        const beforeIso = new Date(options.before).toISOString();
        sql += ' AND timestamp < ?';
        params.push(beforeIso);
      }
    }

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function(this: any, err: any) {
        if (err) {
          console.error('Error deleting memories:', err);
          reject(err);
          return;
        }
        // sqlite3 exposes number of affected rows as 'this.changes'
        resolve(typeof this.changes === 'number' ? this.changes : 0);
      });
    });
  }

  /**
   * Update memories by id or by filters. Returns number of updated rows.
   * Fields that can be updated: content, tags, context, importance, metadata.
   */
  async updateMemories(options: { id?: string; filters?: { tags?: string[]; query?: string; context?: string; importanceLessThan?: number; before?: string }; update: { content?: string; tags?: string[]; context?: string; importance?: number; metadata?: Record<string, any> }; force?: boolean }): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const { id, filters = {}, update, force } = options;

    if (!id) {
      const hasFilters = !!(filters.query || filters.context || (filters.tags && filters.tags.length > 0) || typeof filters.importanceLessThan === 'number' || filters.before);
      if (!hasFilters && !force) {
        throw new Error('Refusing to update all memories without filters. Provide filters or set force=true.');
      }
    }

    const setParts: string[] = [];
    const params: any[] = [];

    if (typeof update.content === 'string') {
      setParts.push('content = ?');
      params.push(update.content);
    }

    if (Array.isArray(update.tags)) {
      setParts.push('tags = ?');
      params.push(JSON.stringify(update.tags));
    }

    if (typeof update.context === 'string') {
      setParts.push('context = ?');
      params.push(update.context);
    }

    if (typeof update.importance === 'number') {
      setParts.push('importance = ?');
      params.push(update.importance);
    }

    if (update.metadata && typeof update.metadata === 'object') {
      setParts.push('metadata = ?');
      params.push(JSON.stringify(update.metadata));
    }

    if (setParts.length === 0) {
      throw new Error('No update fields provided');
    }

    let sql = `UPDATE memories SET ${setParts.join(', ')} WHERE 1=1`;

    if (id) {
      sql += ' AND id = ?';
      params.push(id);
    } else {
      if (filters.query) {
        sql += ' AND content LIKE ?';
        params.push(`%${filters.query}%`);
      }

      if (filters.tags && filters.tags.length > 0) {
        const tagConditions = filters.tags.map(() => 'tags LIKE ?').join(' OR ');
        sql += ` AND (${tagConditions})`;
        filters.tags.forEach(tag => params.push(`%"${tag}"%`));
      }

      if (filters.context) {
        sql += ' AND context LIKE ?';
        params.push(`%${filters.context}%`);
      }

      if (typeof filters.importanceLessThan === 'number') {
        sql += ' AND importance < ?';
        params.push(filters.importanceLessThan);
      }

      if (filters.before) {
        const beforeIso = new Date(filters.before).toISOString();
        sql += ' AND timestamp < ?';
        params.push(beforeIso);
      }
    }

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function(this: any, err: any) {
        if (err) {
          console.error('Error updating memories:', err);
          reject(err);
          return;
        }
        resolve(typeof this.changes === 'number' ? this.changes : 0);
      });
    });
  }

  private async updateAccessCount(ids: string[]): Promise<void> {
    if (!this.db || ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    const sql = `
      UPDATE memories 
      SET accessCount = accessCount + 1, lastAccessed = ? 
      WHERE id IN (${placeholders})
    `;

    const params = [new Date().toISOString(), ...ids];

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function(err) {
        if (err) {
          console.error('Error updating access count:', err);
        }
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      this.db!.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
          reject(err);
          return;
        }
        console.error('SQLite database connection closed');
        this.db = null;
        this.initPromise = null;
        this.isInitializing = false;
        resolve();
      });
    });
  }

  getStorageInfo(): string {
    return `SQLite Database: ${this.dbPath}`;
  }
}
