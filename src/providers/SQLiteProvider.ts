import sqlite3 from 'sqlite3';
import { MemoryEntry, SearchOptions, SearchResult, MemoryEntryWithCluster, DetailsCluster, ClusterDetail, CreateClusterOptions, UpdateClusterOptions, ClusterSearchOptions } from '../types/index.js';
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

    const memoriesTable = `
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        context TEXT NOT NULL DEFAULT '',
        importance INTEGER NOT NULL DEFAULT 5,
        timestamp TEXT NOT NULL,
        lastAccessed TEXT NOT NULL,
        accessCount INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        clusterId TEXT,
        FOREIGN KEY (clusterId) REFERENCES details_clusters(id)
      )
    `;

    const clustersTable = `
      CREATE TABLE IF NOT EXISTS details_clusters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `;

    const clusterDetailsTable = `
      CREATE TABLE IF NOT EXISTS cluster_details (
        id TEXT PRIMARY KEY,
        clusterId TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'text',
        importance INTEGER NOT NULL DEFAULT 5,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (clusterId) REFERENCES details_clusters(id) ON DELETE CASCADE
      )
    `;

    return new Promise((resolve, reject) => {
      let tableCount = 0;
      const tables = [memoriesTable, clustersTable, clusterDetailsTable];

      const createNextTable = () => {
        if (tableCount >= tables.length) {
          this.createIndexes()
            .then(() => {
              console.error('Database tables and indexes created');
              resolve();
            })
            .catch(reject);
          return;
        }

        this.db!.run(tables[tableCount], (err) => {
          if (err) {
            console.error(`Error creating table ${tableCount}:`, err);
            reject(err);
            return;
          }
          tableCount++;
          createNextTable();
        });
      };

      createNextTable();
    });
  }

  private async createIndexes(): Promise<void> {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)',
      'CREATE INDEX IF NOT EXISTS idx_memories_context ON memories(context)',
      'CREATE INDEX IF NOT EXISTS idx_memories_lastAccessed ON memories(lastAccessed)',
      'CREATE INDEX IF NOT EXISTS idx_memories_clusterId ON memories(clusterId)',
      'CREATE INDEX IF NOT EXISTS idx_clusters_name ON details_clusters(name)',
      'CREATE INDEX IF NOT EXISTS idx_clusters_createdAt ON details_clusters(createdAt)',
      'CREATE INDEX IF NOT EXISTS idx_cluster_details_clusterId ON cluster_details(clusterId)',
      'CREATE INDEX IF NOT EXISTS idx_cluster_details_key ON cluster_details(key)'
    ];

    return new Promise((resolve, reject) => {
      let indexCount = 0;
      const createNextIndex = () => {
        if (indexCount >= indexes.length) {
          resolve();
          return;
        }

        const sql = indexes[indexCount];
        this.db!.run(sql, (err) => {
          if (err) {
            const msg = String(err && (err.message || err));
            if (/no such column/i.test(msg) || /no such table/i.test(msg)) {
              console.warn(`Skipping index ${indexCount} due to missing column/table: ${msg}`);
              indexCount++;
              createNextIndex();
              return;
            }

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
  }


  async createCluster(options: CreateClusterOptions): Promise<DetailsCluster> {
    if (!this.db) throw new Error('Database not initialized');

    const cluster: DetailsCluster = {
      id: randomUUID(),
      name: options.name,
      description: options.description,
      tags: options.tags || [],
      createdAt: new Date(),
      updatedAt: new Date(),
      details: [],
      metadata: options.metadata || {}
    };

    const insertClusterSql = `
      INSERT INTO details_clusters (id, name, description, tags, createdAt, updatedAt, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const clusterParams = [
      cluster.id,
      cluster.name,
      cluster.description,
      JSON.stringify(cluster.tags),
      cluster.createdAt.toISOString(),
      cluster.updatedAt.toISOString(),
      JSON.stringify(cluster.metadata)
    ];

    return new Promise((resolve, reject) => {
      this.db!.run(insertClusterSql, clusterParams, async (err) => {
        if (err) {
          console.error('Error creating cluster:', err);
          reject(err);
          return;
        }

        if (options.details && options.details.length > 0) {
          try {
            for (const detail of options.details) {
              await this.addClusterDetail(cluster.id, {
                key: detail.key,
                value: detail.value,
                type: detail.type || 'text',
                importance: detail.importance || 5
              });
            }
            const fullCluster = await this.getClusterById(cluster.id);
            resolve(fullCluster!);
          } catch (error) {
            reject(error);
          }
        } else {
          resolve(cluster);
        }
      });
    });
  }

  async getClusterById(id: string): Promise<DetailsCluster | null> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM details_clusters WHERE id = ?';
      this.db!.get(sql, [id], async (err, row: any) => {
        if (err) {
          console.error('Error getting cluster:', err);
          reject(err);
          return;
        }

        if (!row) {
          resolve(null);
          return;
        }

        try {
          const details = await this.getClusterDetails(id);
          const cluster: DetailsCluster = {
            id: row.id,
            name: row.name,
            description: row.description,
            tags: JSON.parse(row.tags),
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
            metadata: JSON.parse(row.metadata),
            details
          };
          resolve(cluster);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async getClusterDetails(clusterId: string): Promise<ClusterDetail[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM cluster_details WHERE clusterId = ? ORDER BY importance DESC, createdAt ASC';
      this.db!.all(sql, [clusterId], (err, rows: any[]) => {
        if (err) {
          console.error('Error getting cluster details:', err);
          reject(err);
          return;
        }

        const details: ClusterDetail[] = rows.map(row => ({
          id: row.id,
          key: row.key,
          value: row.value,
          type: row.type as any,
          importance: row.importance,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt)
        }));

        resolve(details);
      });
    });
  }

  async addClusterDetail(clusterId: string, detail: {
    key: string;
    value: string;
    type: 'text' | 'number' | 'date' | 'list' | 'json';
    importance: number;
  }): Promise<ClusterDetail> {
    if (!this.db) throw new Error('Database not initialized');

    const clusterDetail: ClusterDetail = {
      id: randomUUID(),
      key: detail.key,
      value: detail.value,
      type: detail.type,
      importance: detail.importance,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const sql = `
      INSERT INTO cluster_details (id, clusterId, key, value, type, importance, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      clusterDetail.id,
      clusterId,
      clusterDetail.key,
      clusterDetail.value,
      clusterDetail.type,
      clusterDetail.importance,
      clusterDetail.createdAt.toISOString(),
      clusterDetail.updatedAt.toISOString()
    ];

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, async (err) => {
        if (err) {
          console.error('Error adding cluster detail:', err);
          reject(err);
          return;
        }

        await this.updateClusterTimestamp(clusterId).catch(console.error);
        resolve(clusterDetail);
      });
    });
  }

  async searchClusters(options: ClusterSearchOptions): Promise<DetailsCluster[]> {
    if (!this.db) throw new Error('Database not initialized');

    let sql = 'SELECT * FROM details_clusters WHERE 1=1';
    const params: any[] = [];

    if (options.query) {
      sql += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${options.query}%`, `%${options.query}%`);
    }

    if (options.tags && options.tags.length > 0) {
      const tagConditions = options.tags.map(() => 'tags LIKE ?').join(' OR ');
      sql += ` AND (${tagConditions})`;
      options.tags.forEach(tag => params.push(`%"${tag}"%`));
    }

    const sortBy = options.sortBy || 'createdAt';
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortBy} ${sortOrder}`;

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, async (err, rows: any[]) => {
        if (err) {
          console.error('Error searching clusters:', err);
          reject(err);
          return;
        }

        try {
          const clusters: DetailsCluster[] = [];
          for (const row of rows) {
            const details = await this.getClusterDetails(row.id);
            clusters.push({
              id: row.id,
              name: row.name,
              description: row.description,
              tags: JSON.parse(row.tags),
              createdAt: new Date(row.createdAt),
              updatedAt: new Date(row.updatedAt),
              metadata: JSON.parse(row.metadata),
              details
            });
          }
          resolve(clusters);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async updateClusterTimestamp(clusterId: string): Promise<void> {
    if (!this.db) return;

    const sql = 'UPDATE details_clusters SET updatedAt = ? WHERE id = ?';
    const params = [new Date().toISOString(), clusterId];

    return new Promise((resolve) => {
      this.db!.run(sql, params, (err) => {
        if (err) {
          console.error('Error updating cluster timestamp:', err);
        }
        resolve();
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
      metadata: memory.metadata || {},
      clusterId: memory.clusterId
    };

    const sql = `
      INSERT INTO memories (id, content, tags, context, importance, timestamp, lastAccessed, accessCount, metadata, clusterId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(entry.metadata),
      entry.clusterId || null
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
      this.db!.all(sql, params, async (err, rows: any[]) => {
        if (err) {
          console.error('Error searching memories:', err);
          reject(err);
          return;
        }

        try {
          const entries: MemoryEntryWithCluster[] = [];
          
          for (const row of rows) {
            const entry: MemoryEntryWithCluster = {
              id: row.id,
              content: row.content,
              tags: JSON.parse(row.tags),
              context: row.context,
              importance: row.importance,
              timestamp: new Date(row.timestamp),
              lastAccessed: new Date(row.lastAccessed),
              accessCount: row.accessCount,
              metadata: JSON.parse(row.metadata),
              clusterId: row.clusterId
            };

            if (options.includeClusterDetails && row.clusterId) {
              const cluster = await this.getClusterById(row.clusterId);
              entry.cluster = cluster ?? undefined;
            }

            entries.push(entry);
          }

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
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async getRecentMemories(limit: number = 20): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = 'SELECT * FROM memories ORDER BY importance DESC LIMIT ?';

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
          metadata: JSON.parse(row.metadata),
          clusterId: row.clusterId
        }));

        resolve(entries);
      });
    });
  }

  async getAllMemories(): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = 'SELECT * FROM memories ORDER BY importance DESC';

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
          metadata: JSON.parse(row.metadata),
          clusterId: row.clusterId
        }));

        resolve(entries);
      });
    });
  }

  async getStats(): Promise<{ totalEntries: number; lastModified: Date | null; totalClusters: number }> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const memoriesSql = 'SELECT COUNT(*) as count, MAX(timestamp) as lastModified FROM memories';
      const clustersSql = 'SELECT COUNT(*) as count FROM details_clusters';

      this.db!.get(memoriesSql, [], (err, memoriesRow: any) => {
        if (err) {
          console.error('Error getting memories stats:', err);
          reject(err);
          return;
        }

        this.db!.get(clustersSql, [], (err, clustersRow: any) => {
          if (err) {
            console.error('Error getting clusters stats:', err);
            reject(err);
            return;
          }

          resolve({
            totalEntries: memoriesRow.count,
            lastModified: memoriesRow.lastModified ? new Date(memoriesRow.lastModified) : null,
            totalClusters: clustersRow.count
          });
        });
      });
    });
  }

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
        resolve(typeof this.changes === 'number' ? this.changes : 0);
      });
    });
  }

  async updateMemories(options: { id?: string; filters?: { tags?: string[]; query?: string; context?: string; importanceLessThan?: number; before?: string }; update: { content?: string; tags?: string[]; context?: string; importance?: number; metadata?: Record<string, any>; clusterId?: string }; force?: boolean }): Promise<number> {
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

    if (update.clusterId !== undefined) {
      setParts.push('clusterId = ?');
      params.push(update.clusterId || null);
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


  async deleteCluster(clusterId: string): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const updateMemoriesSql = 'UPDATE memories SET clusterId = NULL WHERE clusterId = ?';
      this.db!.run(updateMemoriesSql, [clusterId], (err) => {
        if (err) {
          console.error('Error updating memories cluster association:', err);
          reject(err);
          return;
        }

        const deleteClusterSql = 'DELETE FROM details_clusters WHERE id = ?';
        this.db!.run(deleteClusterSql, [clusterId], function(this: any, err: any) {
          if (err) {
            console.error('Error deleting cluster:', err);
            reject(err);
            return;
          }
          resolve(typeof this.changes === 'number' ? this.changes : 0);
        });
      });
    });
  }

  async updateCluster(clusterId: string, options: UpdateClusterOptions): Promise<DetailsCluster | null> {
    if (!this.db) throw new Error('Database not initialized');

    const setParts: string[] = [];
    const params: any[] = [];

    if (typeof options.name === 'string') {
      setParts.push('name = ?');
      params.push(options.name);
    }

    if (typeof options.description === 'string') {
      setParts.push('description = ?');
      params.push(options.description);
    }

    if (Array.isArray(options.tags)) {
      setParts.push('tags = ?');
      params.push(JSON.stringify(options.tags));
    }

    if (options.metadata && typeof options.metadata === 'object') {
      setParts.push('metadata = ?');
      params.push(JSON.stringify(options.metadata));
    }

    if (setParts.length === 0) {
      throw new Error('No update fields provided');
    }

    setParts.push('updatedAt = ?');
    params.push(new Date().toISOString());
    params.push(clusterId);

    const sql = `UPDATE details_clusters SET ${setParts.join(', ')} WHERE id = ?`;

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, async function(this: any, err: any) {
        if (err) {
          console.error('Error updating cluster:', err);
          reject(err);
          return;
        }

        if (this.changes === 0) {
          resolve(null);
          return;
        }

        try {
          const updatedCluster = await this.getClusterById(clusterId);
          resolve(updatedCluster);
        } catch (error) {
          reject(error);
        }
      }.bind(this));
    });
  }

  async updateClusterDetail(detailId: string, update: {
    key?: string;
    value?: string;
    type?: 'text' | 'number' | 'date' | 'list' | 'json';
    importance?: number;
  }): Promise<ClusterDetail | null> {
    if (!this.db) throw new Error('Database not initialized');

    const setParts: string[] = [];
    const params: any[] = [];

    if (typeof update.key === 'string') {
      setParts.push('key = ?');
      params.push(update.key);
    }

    if (typeof update.value === 'string') {
      setParts.push('value = ?');
      params.push(update.value);
    }

    if (update.type) {
      setParts.push('type = ?');
      params.push(update.type);
    }

    if (typeof update.importance === 'number') {
      setParts.push('importance = ?');
      params.push(update.importance);
    }

    if (setParts.length === 0) {
      throw new Error('No update fields provided');
    }

    setParts.push('updatedAt = ?');
    params.push(new Date().toISOString());
    params.push(detailId);

    const sql = `UPDATE cluster_details SET ${setParts.join(', ')} WHERE id = ?`;

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, async function(this: any, err: any) {
        if (err) {
          console.error('Error updating cluster detail:', err);
          reject(err);
          return;
        }

        if (this.changes === 0) {
          resolve(null);
          return;
        }

        const getDetailSql = 'SELECT * FROM cluster_details WHERE id = ?';
        this.db!.get(getDetailSql, [detailId], async (err: any, row: any) => {
          if (err) {
            reject(err);
            return;
          }

          if (!row) {
            resolve(null);
            return;
          }

          await this.updateClusterTimestamp(row.clusterId).catch(console.error);

          const detail: ClusterDetail = {
            id: row.id,
            key: row.key,
            value: row.value,
            type: row.type,
            importance: row.importance,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt)
          };

          resolve(detail);
        });
      }.bind(this));
    });
  }

  async deleteClusterDetail(detailId: string): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const getClusterIdSql = 'SELECT clusterId FROM cluster_details WHERE id = ?';
      this.db!.get(getClusterIdSql, [detailId], (err, row: any) => {
        if (err) {
          console.error('Error getting cluster ID for detail:', err);
          reject(err);
          return;
        }

        const clusterId = row?.clusterId;

        const sql = 'DELETE FROM cluster_details WHERE id = ?';
        this.db!.run(sql, [detailId], async function(this: any, err: any) {
          if (err) {
            console.error('Error deleting cluster detail:', err);
            reject(err);
            return;
          }

          if (clusterId && this.changes > 0) {
            await this.updateClusterTimestamp(clusterId).catch(console.error);
          }

          resolve(typeof this.changes === 'number' ? this.changes : 0);
        }.bind(this));
      });
    });
  }

  async linkMemoryToCluster(memoryId: string, clusterId: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = 'UPDATE memories SET clusterId = ? WHERE id = ?';

    return new Promise((resolve, reject) => {
      this.db!.run(sql, [clusterId, memoryId], function(this: any, err: any) {
        if (err) {
          console.error('Error linking memory to cluster:', err);
          reject(err);
          return;
        }
        resolve(this.changes > 0);
      });
    });
  }

  async unlinkMemoryFromCluster(memoryId: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = 'UPDATE memories SET clusterId = NULL WHERE id = ?';

    return new Promise((resolve, reject) => {
      this.db!.run(sql, [memoryId], function(this: any, err: any) {
        if (err) {
          console.error('Error unlinking memory from cluster:', err);
          reject(err);
          return;
        }
        resolve(this.changes > 0);
      });
    });
  }

  async getMemoriesByCluster(clusterId: string): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = 'SELECT * FROM memories WHERE clusterId = ? ORDER BY importance DESC';

    return new Promise((resolve, reject) => {
      this.db!.all(sql, [clusterId], (err, rows: any[]) => {
        if (err) {
          console.error('Error getting memories by cluster:', err);
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
          metadata: JSON.parse(row.metadata),
          clusterId: row.clusterId
        }));

        resolve(entries);
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
        this.db = null;
        resolve();
      });
    });
  }

  getStorageInfo(): string {
    try {
      return `Path: ${this.dbPath}`;
    } catch (err) {
      return 'Unknown storage info';
    }
  }
}