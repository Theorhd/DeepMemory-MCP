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

export interface AddMemoryOptions {
  content: string;
  tags?: string[];
  context?: string;
  importance?: number;
  metadata?: Record<string, any>;
}
