export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  context: string;
  importance: number;
  timestamp: Date;
  lastAccessed: Date;
  accessCount: number;
  metadata?: Record<string, any>;
}

export interface Memory {
  entries: MemoryEntry[];
  totalEntries: number;
  lastModified: Date;
}

export interface SearchOptions {
  query?: string;
  tags?: string[];
  contextFilter?: string;
  importanceThreshold?: number;
  limit?: number;
  sortBy?: 'timestamp' | 'importance' | 'accessCount' | 'lastAccessed';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResult {
  entries: MemoryEntry[];
  totalFound: number;
  searchTime: number;
}

export interface StorageConfig {
  type: 'local' | 'googledrive';
  localPath?: string;
  googleDrive?: {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
    folderId?: string;
  };
}

export interface DeepMemoryConfig {
  storage: StorageConfig;
  maxEntries?: number;
  autoCleanup?: boolean;
  cleanupThreshold?: number;
}

export interface StorageProvider {
  initialize(): Promise<void>;
  saveMemory(memory: Memory): Promise<void>;
  loadMemory(): Promise<Memory>;
  isConfigured(): boolean;
  getStorageInfo(): string;
}

export interface AddMemoryOptions {
  tags?: string[];
  context?: string;
  importance?: number;
  metadata?: Record<string, any>;
}