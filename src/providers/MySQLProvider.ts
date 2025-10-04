import mysql from 'mysql2/promise';
import { EmbeddingService } from '../embedding/EmbeddingService.js';
import { MemoryEntry, SearchOptions, SearchResult, MemoryEntryWithCluster, DetailsCluster, ClusterDetail, CreateClusterOptions, UpdateClusterOptions, ClusterSearchOptions, BaseProvider } from '../types/index.js';
import { randomUUID } from 'crypto';
import type { DocEntry, DocSearchOptions, DocSearchResult } from '../types/index.js';

export class MySQLProvider implements BaseProvider {
  private pool: mysql.Pool | null = null;
  private config: mysql.PoolOptions;

  constructor(config: mysql.PoolOptions) {
    this.config = config;
  }
  async searchDocs(options: import("../types/index.js").DocSearchOptions): Promise<import("../types/index.js").DocSearchResult> {
    if (!this.pool) throw new Error('Database not initialized');
    const limit = typeof options.limit === 'number' ? options.limit : 20;
    const offset = typeof (options as any).offset === 'number' ? (options as any).offset : 0;

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (options.query) {
      const q = `%${options.query}%`;
      whereClauses.push('(title LIKE ? OR content LIKE ? OR url LIKE ?)');
      params.push(q, q, q);
    }

    if (options.tags && Array.isArray(options.tags) && options.tags.length > 0) {
      for (const t of options.tags) {
        whereClauses.push('JSON_CONTAINS(tags, ?)');
        params.push(JSON.stringify(t));
      }
    }

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const conn = await this.pool.getConnection();
    try {
      const countSql = `SELECT COUNT(*) as total FROM docs ${whereSql}`;
      const [countRows]: any = await conn.query(countSql, params);
      const total = (countRows as any[])[0]?.total || 0;

      let orderSql = 'ORDER BY timestamp DESC';
      const sortBy: any = (options as any).sortBy;
      const order = (options as any).order === 'asc' ? 'ASC' : 'DESC';
      if (sortBy === 'title') orderSql = `ORDER BY title ${order}`;
      else if (sortBy === 'lastFetched') orderSql = `ORDER BY lastFetched ${order}`;
      else if (sortBy === 'accessCount') orderSql = `ORDER BY accessCount ${order}`;
      else if (sortBy === 'timestamp') orderSql = `ORDER BY timestamp ${order}`;

      const sql = `SELECT * FROM docs ${whereSql} ${orderSql} LIMIT ? OFFSET ?`;
      const finalParams = params.concat([limit, offset]);
      const [rows]: any = await conn.query(sql, finalParams);

      const results: import("../types/index.js").DocEntry[] = (rows as any[]).map(r => ({
        id: r.id,
        url: r.url,
        title: r.title,
        content: r.content,
        tags: Array.isArray(r.tags) ? r.tags : JSON.parse(r.tags || '[]'),
        timestamp: new Date(r.timestamp),
        lastFetched: new Date(r.lastFetched),
        accessCount: r.accessCount,
        metadata: r.metadata ? (typeof r.metadata === 'object' ? r.metadata : JSON.parse(r.metadata)) : {}
      }));

      return { results, total } as unknown as import("../types/index.js").DocSearchResult;
    } finally {
      conn.release();
    }
  }
  getRecentDocs(limit?: number): Promise<import("../types/index.js").DocEntry[]> {
    throw new Error('Method not implemented.');
  }
  getAllDocs(): Promise<import("../types/index.js").DocEntry[]> {
    throw new Error('Method not implemented.');
  }
  deleteDocs(options: any): Promise<number> {
    throw new Error('Method not implemented.');
  }
  updateDocs(options: any): Promise<number> {
    throw new Error('Method not implemented.');
  }

  async initialize(): Promise<void> {
    if (this.pool) return;
    this.pool = mysql.createPool(this.config);

    const conn = await this.pool.getConnection();
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS memories (
          id VARCHAR(36) PRIMARY KEY,
          content TEXT NOT NULL,
          tags JSON NOT NULL,
          context VARCHAR(255) NOT NULL DEFAULT '',
          importance INT NOT NULL DEFAULT 5,
          timestamp DATETIME NOT NULL,
          lastAccessed DATETIME NOT NULL,
          accessCount INT NOT NULL DEFAULT 0,
          metadata JSON NOT NULL,
          clusterId VARCHAR(36)
        )
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS details_clusters (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT NOT NULL,
          tags JSON NOT NULL,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL,
          metadata JSON NOT NULL
        )
      `);

      await conn.query(`
    CREATE TABLE IF NOT EXISTS cluster_details (
          id VARCHAR(36) PRIMARY KEY,
          clusterId VARCHAR(36) NOT NULL,
          ` + "`key` VARCHAR(255) NOT NULL," + `
          value TEXT NOT NULL,
          type VARCHAR(32) NOT NULL DEFAULT 'text',
          importance INT NOT NULL DEFAULT 5,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL
        )
  `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS docs (
          id VARCHAR(36) PRIMARY KEY,
          url TEXT,
          title TEXT,
          content LONGTEXT NOT NULL,
          tags JSON NOT NULL,
          timestamp DATETIME NOT NULL,
          lastFetched DATETIME NOT NULL,
          accessCount INT NOT NULL DEFAULT 0,
          metadata JSON NOT NULL,
          embedding JSON DEFAULT NULL
        )
      `);
        // Migrate schema: add missing embedding columns and backfill
        await this.migrateSchema();
    } finally {
      conn.release();
    }
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    await this.pool.end();
    this.pool = null;
  }

  getStorageInfo(): string {
    return `MySQL pool: ${this.pool ? 'connected' : 'not connected'}`;
  }

  // Migrate schema: add embedding columns and backfill existing data
  private async migrateSchema(): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');
    const conn = await this.pool.getConnection();
    try {
      // Check and add embedding column for memories
      let [rows]: any = await conn.query("SHOW COLUMNS FROM memories LIKE 'embedding'");
      if ((rows as any[]).length === 0) {
        await conn.query('ALTER TABLE memories ADD COLUMN embedding JSON DEFAULT NULL');
        console.error('Added embedding column to memories table');
      }
      // Check and add embedding column for docs
      [rows] = await conn.query("SHOW COLUMNS FROM docs LIKE 'embedding'");
      if ((rows as any[]).length === 0) {
        await conn.query('ALTER TABLE docs ADD COLUMN embedding JSON DEFAULT NULL');
        console.error('Added embedding column to docs table');
      }
      // Initialize embedding service
      const embedSvc = EmbeddingService.getInstance();
      try {
        await embedSvc.initialize();
      } catch (err) {
        console.error('Embedding service unavailable for migration:', err);
        return;
      }
      // Backfill memories embeddings
      const [memRows]: any = await conn.query("SELECT id, content FROM memories WHERE embedding IS NULL");
      for (const row of memRows as any[]) {
        try {
          const vec = await embedSvc.generateEmbedding(row.content);
          await conn.query('UPDATE memories SET embedding = ? WHERE id = ?', [JSON.stringify(vec), row.id]);
        } catch (err) {
          console.error(`Failed to backfill memory ${row.id}:`, err);
        }
      }
      // Backfill docs embeddings
      const [docRows]: any = await conn.query("SELECT id, content FROM docs WHERE embedding IS NULL");
      for (const row of docRows as any[]) {
        try {
          const vec = await embedSvc.generateEmbedding(row.content);
          await conn.query('UPDATE docs SET embedding = ? WHERE id = ?', [JSON.stringify(vec), row.id]);
        } catch (err) {
          console.error(`Failed to backfill doc ${row.id}:`, err);
        }
      }
      console.error('MySQL schema migration and embedding backfill completed');
    } finally {
      conn.release();
    }
  }

  async createCluster(options: CreateClusterOptions): Promise<DetailsCluster> {
    if (!this.pool) throw new Error('Database not initialized');
    const id = randomUUID();
    const now = new Date();
    const conn = await this.pool.getConnection();
    try {
      await conn.query('INSERT INTO details_clusters (id, name, description, tags, createdAt, updatedAt, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, options.name, options.description, JSON.stringify(options.tags || []), now.toISOString().slice(0,19).replace('T',' '), now.toISOString().slice(0,19).replace('T',' '), JSON.stringify(options.metadata || {})]);

      const cluster: DetailsCluster = { id, name: options.name, description: options.description, tags: options.tags || [], createdAt: now, updatedAt: now, details: [], metadata: options.metadata || {} };

      if (options.details && options.details.length > 0) {
        for (const d of options.details) {
          const detail = await this.addClusterDetail(id, { key: d.key, value: d.value, type: d.type || 'text', importance: d.importance || 5 });
          cluster.details.push(detail);
        }
      }

      return cluster;
    } finally {
      conn.release();
    }
  }

  async getClusterById(id: string): Promise<DetailsCluster | null> {
    if (!this.pool) throw new Error('Database not initialized');
    const conn = await this.pool.getConnection();
    try {
      const [rows]: any = await conn.query('SELECT * FROM details_clusters WHERE id = ?', [id]);
      if ((rows as any[]).length === 0) return null;
      const row = (rows as any[])[0];
      const details = await this.getClusterDetails(id);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        tags: JSON.parse(row.tags),
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        metadata: JSON.parse(row.metadata),
        details
      };
    } finally {
      conn.release();
    }
  }

  async getClusterDetails(clusterId: string): Promise<ClusterDetail[]> {
    if (!this.pool) throw new Error('Database not initialized');
    const conn = await this.pool.getConnection();
    try {
      const [rows]: any = await conn.query('SELECT * FROM cluster_details WHERE clusterId = ? ORDER BY importance DESC, createdAt ASC', [clusterId]);
      return (rows as any[]).map(r => ({ id: r.id, key: r.key, value: r.value, type: r.type, importance: r.importance, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) } as ClusterDetail));
    } finally {
      conn.release();
    }
  }

  async addClusterDetail(clusterId: string, detail: { key: string; value: string; type: string; importance: number }): Promise<ClusterDetail> {
    if (!this.pool) throw new Error('Database not initialized');
    const id = randomUUID();
    const now = new Date();
    const conn = await this.pool.getConnection();
    try {
      await conn.query('INSERT INTO cluster_details (id, clusterId, `key`, value, type, importance, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, clusterId, detail.key, detail.value, detail.type, detail.importance, now.toISOString().slice(0,19).replace('T',' '), now.toISOString().slice(0,19).replace('T',' ')]);
      await conn.query('UPDATE details_clusters SET updatedAt = ? WHERE id = ?', [now.toISOString().slice(0,19).replace('T',' '), clusterId]);
      return { id, key: detail.key, value: detail.value, type: detail.type as any, importance: detail.importance, createdAt: now, updatedAt: now };
    } finally {
      conn.release();
    }
  }

  async searchClusters(options: ClusterSearchOptions): Promise<DetailsCluster[]> {
    if (!this.pool) throw new Error('Database not initialized');
    let sql = 'SELECT * FROM details_clusters WHERE 1=1';
    const params: any[] = [];
    if (options.query) { sql += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${options.query}%`, `%${options.query}%`); }
    if (options.limit) { sql += ' LIMIT ?'; params.push(options.limit); }
    const conn = await this.pool.getConnection();
    try {
      const [rows]: any = await conn.query(sql, params);
      const clusters: DetailsCluster[] = [];
      for (const row of rows) {
        const details = await this.getClusterDetails(row.id);
        clusters.push({ id: row.id, name: row.name, description: row.description, tags: JSON.parse(row.tags), createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt), metadata: JSON.parse(row.metadata), details });
      }
      return clusters;
    } finally {
      conn.release();
    }
  }

  async addMemory(memory: Omit<MemoryEntry, 'id' | 'timestamp' | 'lastAccessed' | 'accessCount'>, id?: string): Promise<MemoryEntry> {
    if (!this.pool) throw new Error('Database not initialized');
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
    const conn = await this.pool.getConnection();
    try {
      await conn.query('INSERT INTO memories (id, content, tags, context, importance, timestamp, lastAccessed, accessCount, metadata, clusterId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [entry.id, entry.content, JSON.stringify(entry.tags), entry.context, entry.importance, entry.timestamp.toISOString().slice(0,19).replace('T',' '), entry.lastAccessed.toISOString().slice(0,19).replace('T',' '), entry.accessCount, JSON.stringify(entry.metadata), entry.clusterId || null]);
      return entry;
    } finally {
      conn.release();
    }
  }

  async getMemoriesByCluster(clusterId: string): Promise<MemoryEntry[]> {
    if (!this.pool) throw new Error('Database not initialized');
    const conn = await this.pool.getConnection();
    try {
      const [rows]: any = await conn.query('SELECT * FROM memories WHERE clusterId = ? ORDER BY importance DESC', [clusterId]);
      return (rows as any[]).map(r => ({ id: r.id, content: r.content, tags: JSON.parse(r.tags), context: r.context, importance: r.importance, timestamp: new Date(r.timestamp), lastAccessed: new Date(r.lastAccessed), accessCount: r.accessCount, metadata: JSON.parse(r.metadata), clusterId: r.clusterId }));
    } finally {
      conn.release();
    }
  }

  async searchMemories(options: SearchOptions): Promise<SearchResult> { throw new Error('Not implemented in MySQLProvider'); }
  async getRecentMemories(limit: number = 20): Promise<MemoryEntry[]> { throw new Error('Not implemented in MySQLProvider'); }
  async getAllMemories(): Promise<MemoryEntry[]> { throw new Error('Not implemented in MySQLProvider'); }
  async getStats(): Promise<{ totalEntries: number; lastModified: Date | null; totalClusters: number }> { throw new Error('Not implemented in MySQLProvider'); }
  async deleteMemories(options: any): Promise<number> { throw new Error('Not implemented in MySQLProvider'); }
  async updateMemories(options: any): Promise<number> { throw new Error('Not implemented in MySQLProvider'); }
  async updateCluster(clusterId: string, options: UpdateClusterOptions): Promise<DetailsCluster | null> { throw new Error('Not implemented in MySQLProvider'); }
  async updateClusterDetail(detailId: string, update: any): Promise<ClusterDetail | null> { throw new Error('Not implemented in MySQLProvider'); }
  async deleteClusterDetail(detailId: string): Promise<number> { throw new Error('Not implemented in MySQLProvider'); }
  async deleteCluster(clusterId: string): Promise<number> { throw new Error('Not implemented in MySQLProvider'); }
  async linkMemoryToCluster(memoryId: string, clusterId: string): Promise<boolean> { throw new Error('Not implemented in MySQLProvider'); }
  async unlinkMemoryFromCluster(memoryId: string): Promise<boolean> { throw new Error('Not implemented in MySQLProvider'); }

  // Docs APIs
  async addDoc(doc: Omit<DocEntry, 'id' | 'timestamp' | 'lastFetched' | 'accessCount'>, id?: string): Promise<DocEntry> {
    if (!this.pool) throw new Error('Database not initialized');
    const entry: DocEntry = {
      id: id || randomUUID(),
      url: doc.url,
      title: doc.title,
      content: doc.content,
      tags: doc.tags || [],
      timestamp: new Date(),
      lastFetched: new Date(),
      accessCount: 0,
      metadata: doc.metadata || {},
      embedding: doc.embedding
    };
    const conn = await this.pool.getConnection();
    try {
      await conn.query(
        'INSERT INTO docs (id, url, title, content, tags, timestamp, lastFetched, accessCount, metadata, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          entry.id,
          entry.url,
          entry.title,
          entry.content,
          JSON.stringify(entry.tags),
          entry.timestamp.toISOString().slice(0,19).replace('T',' '),
          entry.lastFetched.toISOString().slice(0,19).replace('T',' '),
          entry.accessCount,
          JSON.stringify(entry.metadata),
          entry.embedding ? JSON.stringify(entry.embedding) : null
        ]
      );
      return entry;
    } finally {
      conn.release();
    }
  }

  // Semantic Search (not implemented for MySQL)
  async semanticSearchMemories(queryEmbedding: number[], options: import('../types/index.js').SemanticSearchOptions): Promise<import('../types/index.js').SemanticSearchResult> {
    throw new Error('Semantic search is not implemented for MySQLProvider. Please use SQLiteProvider for this feature.');
  }

  async semanticSearchDocs(queryEmbedding: number[], options: import('../types/index.js').SemanticSearchOptions): Promise<import('../types/index.js').DocSemanticSearchResult> {
    throw new Error('Semantic search is not implemented for MySQLProvider. Please use SQLiteProvider for this feature.');
  }
}