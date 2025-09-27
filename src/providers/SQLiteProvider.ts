import Database from 'better-sqlite3';
import { MemoryEntry, SearchOptions, SearchResult, MemoryEntryWithCluster, DetailsCluster, ClusterDetail, CreateClusterOptions, UpdateClusterOptions, ClusterSearchOptions, BaseProvider } from '../types/index.js';
import { randomUUID } from 'crypto';

export class SQLiteProvider implements BaseProvider {
  private db: any | null = null;
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
      try {
        this.db = new Database(this.dbPath);
        console.error(`SQLite database connected: ${this.dbPath}`);
        
        this.db.pragma('foreign_keys = ON');
        
        this.createTables();
        this.isInitializing = false;
        resolve();
      } catch (err) {
        console.error('Error opening database:', err);
        this.isInitializing = false;
        reject(err);
      }
    });

    return this.initPromise;
  }

  private createTables(): void {
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

    this.db.exec(memoriesTable);
    this.db.exec(clustersTable);
    this.db.exec(clusterDetailsTable);

    const docsTable = `
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY,
        url TEXT,
        title TEXT,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        timestamp TEXT NOT NULL,
        lastFetched TEXT NOT NULL,
        accessCount INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `;

    this.db.exec(docsTable);

    this.createIndexes();
    console.error('Database tables and indexes created');
  }

  private createIndexes(): void {
    if (!this.db) throw new Error('Database not initialized');

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
      , 'CREATE INDEX IF NOT EXISTS idx_docs_timestamp ON docs(timestamp)'
      , 'CREATE INDEX IF NOT EXISTS idx_docs_tags ON docs(tags)'
      , 'CREATE INDEX IF NOT EXISTS idx_docs_lastFetched ON docs(lastFetched)'
    ];

    for (const indexSql of indexes) {
      try {
        this.db.exec(indexSql);
      } catch (err: any) {
        const msg = String(err && (err.message || err));
        if (/no such column/i.test(msg) || /no such table/i.test(msg)) {
          console.warn(`Skipping index due to missing column/table: ${msg}`);
        } else {
          console.error('Error creating index:', err);
          throw err;
        }
      }
    }
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

    const insertClusterStmt = this.db.prepare(`
      INSERT INTO details_clusters (id, name, description, tags, createdAt, updatedAt, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const clusterParams = [
      cluster.id,
      cluster.name,
      cluster.description,
      JSON.stringify(cluster.tags),
      cluster.createdAt.toISOString(),
      cluster.updatedAt.toISOString(),
      JSON.stringify(cluster.metadata)
    ];

    try {
      insertClusterStmt.run(...clusterParams);

      if (options.details && options.details.length > 0) {
        for (const detail of options.details) {
          await this.addClusterDetail(cluster.id, {
            key: detail.key,
            value: detail.value,
            type: detail.type || 'text',
            importance: detail.importance || 5
          });
        }
        const fullCluster = await this.getClusterById(cluster.id);
        return fullCluster!;
      } else {
        return cluster;
      }
    } catch (error) {
      console.error('Error creating cluster:', error);
      throw error;
    }
  }

  async getClusterById(id: string): Promise<DetailsCluster | null> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM details_clusters WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) {
      return null;
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
      return cluster;
    } catch (error) {
      console.error('Error getting cluster:', error);
      throw error;
    }
  }

  async getClusterDetails(clusterId: string): Promise<ClusterDetail[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM cluster_details WHERE clusterId = ? ORDER BY importance DESC, createdAt ASC');
    const rows = stmt.all(clusterId) as any[];

    const details: ClusterDetail[] = rows.map(row => ({
      id: row.id,
      key: row.key,
      value: row.value,
      type: row.type as any,
      importance: row.importance,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt)
    }));

    return details;
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

    const stmt = this.db.prepare(`
      INSERT INTO cluster_details (id, clusterId, key, value, type, importance, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

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

    try {
      stmt.run(...params);
      await this.updateClusterTimestamp(clusterId);
      return clusterDetail;
    } catch (error) {
      console.error('Error adding cluster detail:', error);
      throw error;
    }
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
      options.tags.forEach((tag: string) => params.push(`%"${tag}"%`));
    }

    const sortBy = options.sortBy || 'createdAt';
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortBy} ${sortOrder}`;

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];

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
      return clusters;
    } catch (error) {
      console.error('Error searching clusters:', error);
      throw error;
    }
  }

  private async updateClusterTimestamp(clusterId: string): Promise<void> {
    if (!this.db) return;

    const stmt = this.db.prepare('UPDATE details_clusters SET updatedAt = ? WHERE id = ?');
    const params = [new Date().toISOString(), clusterId];

    try {
      stmt.run(...params);
    } catch (error) {
      console.error('Error updating cluster timestamp:', error);
    }
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

    const stmt = this.db.prepare(`
      INSERT INTO memories (id, content, tags, context, importance, timestamp, lastAccessed, accessCount, metadata, clusterId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

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

    try {
      stmt.run(...params);
      return entry;
    } catch (error) {
      console.error('Error adding memory:', error);
      throw error;
    }
  }

  async addDoc(doc: Omit<import('../types/index.js').DocEntry, 'id' | 'timestamp' | 'lastFetched' | 'accessCount'>, id?: string): Promise<import('../types/index.js').DocEntry> {
    if (!this.db) throw new Error('Database not initialized');

    const entry = {
      id: id || randomUUID(),
      url: doc.url || null,
      title: doc.title || null,
      content: doc.content,
      tags: doc.tags || [],
      timestamp: new Date(),
      lastFetched: new Date(),
      accessCount: 0,
      metadata: doc.metadata || {}
    } as import('../types/index.js').DocEntry;

    const stmt = this.db.prepare(`
      INSERT INTO docs (id, url, title, content, tags, timestamp, lastFetched, accessCount, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const params = [
      entry.id,
      entry.url,
      entry.title,
      entry.content,
      JSON.stringify(entry.tags),
      entry.timestamp.toISOString(),
      entry.lastFetched.toISOString(),
      entry.accessCount,
      JSON.stringify(entry.metadata)
    ];

    try {
      stmt.run(...params);
      return entry;
    } catch (error) {
      console.error('Error adding doc:', error);
      throw error;
    }
  }

  async searchDocs(options: import('../types/index.js').DocSearchOptions): Promise<import('../types/index.js').DocSearchResult> {
    if (!this.db) throw new Error('Database not initialized');

    const startTime = Date.now();
    let sql = 'SELECT * FROM docs WHERE 1=1';
    const params: any[] = [];

    if (options.query) {
      sql += ' AND (content LIKE ? OR title LIKE ?)';
      params.push(`%${options.query}%`, `%${options.query}%`);
    }

    if (options.tags && options.tags.length > 0) {
      const tagConditions = options.tags.map(() => 'tags LIKE ?').join(' OR ');
      sql += ` AND (${tagConditions})`;
      options.tags.forEach(tag => params.push(`%"${tag}"%`));
    }

    const sortBy = options.sortBy || 'timestamp';
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortBy} ${sortOrder}`;

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];

      const entries: import('../types/index.js').DocEntry[] = rows.map(row => ({
        id: row.id,
        url: row.url || undefined,
        title: row.title || undefined,
        content: row.content,
        tags: JSON.parse(row.tags),
        timestamp: new Date(row.timestamp),
        lastFetched: new Date(row.lastFetched),
        accessCount: row.accessCount,
        metadata: JSON.parse(row.metadata)
      }));

      const searchTime = Date.now() - startTime;

      if (entries.length > 0) {
        this.updateDocsAccessCount(entries.map(e => e.id)).catch(err => console.error('Failed to update docs access count', err));
      }

      return { entries, totalFound: entries.length, searchTime };
    } catch (error) {
      console.error('Error searching docs:', error);
      throw error;
    }
  }

  async getRecentDocs(limit: number = 20): Promise<import('../types/index.js').DocEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM docs ORDER BY timestamp DESC LIMIT ?');
    const rows = stmt.all(limit) as any[];

    return rows.map(row => ({ id: row.id, url: row.url || undefined, title: row.title || undefined, content: row.content, tags: JSON.parse(row.tags), timestamp: new Date(row.timestamp), lastFetched: new Date(row.lastFetched), accessCount: row.accessCount, metadata: JSON.parse(row.metadata) }));
  }

  async getAllDocs(): Promise<import('../types/index.js').DocEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM docs ORDER BY timestamp DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => ({ id: row.id, url: row.url || undefined, title: row.title || undefined, content: row.content, tags: JSON.parse(row.tags), timestamp: new Date(row.timestamp), lastFetched: new Date(row.lastFetched), accessCount: row.accessCount, metadata: JSON.parse(row.metadata) }));
  }

  async deleteDocs(options: { id?: string; tags?: string[]; query?: string; before?: string; force?: boolean }): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const hasFilters = !!(options.id || (options.tags && options.tags.length > 0) || options.query || options.before);
    if (!hasFilters && !options.force) {
      throw new Error('Refusing to delete all docs without filters. Provide filters or set force=true.');
    }

    let sql = 'DELETE FROM docs WHERE 1=1';
    const params: any[] = [];

    if (options.id) {
      sql = 'DELETE FROM docs WHERE id = ?';
      params.push(options.id);
    } else {
      if (options.query) { sql += ' AND content LIKE ?'; params.push(`%${options.query}%`); }
  if (options.tags && options.tags.length > 0) { const tagConditions = options.tags.map(() => 'tags LIKE ?').join(' OR '); sql += ` AND (${tagConditions})`; options.tags.forEach((t: string) => params.push(`%"${t}"%`)); }
      if (options.before) { sql += ' AND timestamp < ?'; params.push(new Date(options.before).toISOString()); }
    }

    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return result.changes;
    } catch (error) {
      console.error('Error deleting docs:', error);
      throw error;
    }
  }

  async updateDocs(options: { id?: string; filters?: any; update: any; force?: boolean }): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    const { id, filters = {}, update, force } = options;

    if (!id) {
      const hasFilters = !!(filters.query || (filters.tags && filters.tags.length > 0) || filters.before);
      if (!hasFilters && !force) throw new Error('Refusing to update all docs without filters. Provide filters or set force=true.');
    }

    const setParts: string[] = [];
    const params: any[] = [];

    if (typeof update.content === 'string') { setParts.push('content = ?'); params.push(update.content); }
    if (typeof update.title === 'string') { setParts.push('title = ?'); params.push(update.title); }
    if (Array.isArray(update.tags)) { setParts.push('tags = ?'); params.push(JSON.stringify(update.tags)); }
    if (update.metadata && typeof update.metadata === 'object') { setParts.push('metadata = ?'); params.push(JSON.stringify(update.metadata)); }

    if (setParts.length === 0) throw new Error('No update fields provided');

    let sql = `UPDATE docs SET ${setParts.join(', ')} WHERE 1=1`;

    if (id) { sql += ' AND id = ?'; params.push(id); } else {
      if (filters.query) { sql += ' AND content LIKE ?'; params.push(`%${filters.query}%`); }
  if (filters.tags && filters.tags.length > 0) { const tagConditions = filters.tags.map(() => 'tags LIKE ?').join(' OR '); sql += ` AND (${tagConditions})`; filters.tags.forEach((t: string) => params.push(`%"${t}"%`)); }
      if (filters.before) { sql += ' AND timestamp < ?'; params.push(new Date(filters.before).toISOString()); }
    }

    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return result.changes;
    } catch (error) {
      console.error('Error updating docs:', error);
      throw error;
    }
  }

  private async updateDocsAccessCount(ids: string[]): Promise<void> {
    if (!this.db || ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    const sql = `UPDATE docs SET accessCount = accessCount + 1, lastFetched = ? WHERE id IN (${placeholders})`;
    const params = [new Date().toISOString(), ...ids];
    try { this.db.prepare(sql).run(...params); } catch (err) { console.error('Error updating docs access count', err); }
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

    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];

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
        await this.updateAccessCount(entries.map(e => e.id));
      }

      return {
        entries,
        totalFound: entries.length,
        searchTime
      };
    } catch (error) {
      console.error('Error searching memories:', error);
      throw error;
    }
  }

  async getRecentMemories(limit: number = 20): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM memories ORDER BY importance DESC LIMIT ?');
    const rows = stmt.all(limit) as any[];

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

    return entries;
  }

  async getAllMemories(): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM memories ORDER BY importance DESC');
    const rows = stmt.all() as any[];

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

    return entries;
  }

  async getStats(): Promise<{ totalEntries: number; lastModified: Date | null; totalClusters: number }> {
    if (!this.db) throw new Error('Database not initialized');

    const memoriesStmt = this.db.prepare('SELECT COUNT(*) as count, MAX(timestamp) as lastModified FROM memories');
    const clustersStmt = this.db.prepare('SELECT COUNT(*) as count FROM details_clusters');

    const memoriesRow = memoriesStmt.get() as any;
    const clustersRow = clustersStmt.get() as any;

    return {
      totalEntries: memoriesRow.count,
      lastModified: memoriesRow.lastModified ? new Date(memoriesRow.lastModified) : null,
      totalClusters: clustersRow.count
    };
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

    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return result.changes;
    } catch (error) {
      console.error('Error deleting memories:', error);
      throw error;
    }
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

    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return result.changes;
    } catch (error) {
      console.error('Error updating memories:', error);
      throw error;
    }
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

    try {
      const stmt = this.db.prepare(sql);
      stmt.run(...params);
    } catch (error) {
      console.error('Error updating access count:', error);
    }
  }

  async deleteCluster(clusterId: string): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const updateMemoriesStmt = this.db.prepare('UPDATE memories SET clusterId = NULL WHERE clusterId = ?');
      const deleteClusterStmt = this.db.prepare('DELETE FROM details_clusters WHERE id = ?');

      const transaction = this.db.transaction(() => {
        updateMemoriesStmt.run(clusterId);
        const result = deleteClusterStmt.run(clusterId);
        return result.changes;
      });

      return transaction();
    } catch (error) {
      console.error('Error deleting cluster:', error);
      throw error;
    }
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

    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);

      if (result.changes === 0) {
        return null;
      }

      return await this.getClusterById(clusterId);
    } catch (error) {
      console.error('Error updating cluster:', error);
      throw error;
    }
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

    try {
      const updateStmt = this.db.prepare(sql);
      const result = updateStmt.run(...params);

      if (result.changes === 0) {
        return null;
      }

      const getDetailStmt = this.db.prepare('SELECT * FROM cluster_details WHERE id = ?');
      const row = getDetailStmt.get(detailId) as any;

      if (!row) {
        return null;
      }

      await this.updateClusterTimestamp(row.clusterId);

      const detail: ClusterDetail = {
        id: row.id,
        key: row.key,
        value: row.value,
        type: row.type,
        importance: row.importance,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt)
      };

      return detail;
    } catch (error) {
      console.error('Error updating cluster detail:', error);
      throw error;
    }
  }

  async deleteClusterDetail(detailId: string): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const getClusterIdStmt = this.db.prepare('SELECT clusterId FROM cluster_details WHERE id = ?');
      const row = getClusterIdStmt.get(detailId) as any;
      const clusterId = row?.clusterId;

      const deleteStmt = this.db.prepare('DELETE FROM cluster_details WHERE id = ?');
      const result = deleteStmt.run(detailId);

      if (clusterId && result.changes > 0) {
        await this.updateClusterTimestamp(clusterId);
      }

      return result.changes;
    } catch (error) {
      console.error('Error deleting cluster detail:', error);
      throw error;
    }
  }

  async linkMemoryToCluster(memoryId: string, clusterId: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const stmt = this.db.prepare('UPDATE memories SET clusterId = ? WHERE id = ?');
      const result = stmt.run(clusterId, memoryId);
      return result.changes > 0;
    } catch (error) {
      console.error('Error linking memory to cluster:', error);
      throw error;
    }
  }

  async unlinkMemoryFromCluster(memoryId: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const stmt = this.db.prepare('UPDATE memories SET clusterId = NULL WHERE id = ?');
      const result = stmt.run(memoryId);
      return result.changes > 0;
    } catch (error) {
      console.error('Error unlinking memory from cluster:', error);
      throw error;
    }
  }

  async getMemoriesByCluster(clusterId: string): Promise<MemoryEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM memories WHERE clusterId = ? ORDER BY importance DESC');
    const rows = stmt.all(clusterId) as any[];

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

    return entries;
  }

  async close(): Promise<void> {
    if (!this.db) return;
    
    try {
      this.db.close();
      this.db = null;
    } catch (error) {
      console.error('Error closing database:', error);
      throw error;
    }
  }

  getStorageInfo(): string {
    try {
      return `Path: ${this.dbPath}`;
    } catch (err) {
      return 'Unknown storage info';
    }
  }
}