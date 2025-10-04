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
  clusterId?: string;
  embedding?: number[];
}

export interface DetailsCluster {
  id: string;
  name: string;
  description: string;
  details: ClusterDetail[];
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  metadata?: Record<string, any>;
}

export interface ClusterDetail {
  id: string;
  key: string; 
  value: string;
  type: 'text' | 'number' | 'date' | 'list' | 'json';
  importance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchOptions {
  query?: string;
  tags?: string[];
  contextFilter?: string;
  importanceThreshold?: number;
  limit?: number;
  sortBy?: 'timestamp' | 'importance' | 'accessCount' | 'lastAccessed';
  sortOrder?: 'asc' | 'desc';
  includeClusterDetails?: boolean;
}

export interface SearchResult {
  entries: MemoryEntryWithCluster[];
  totalFound: number;
  searchTime: number;
}

export interface MemoryEntryWithCluster extends MemoryEntry {
  cluster?: DetailsCluster;
}

export interface DocEntry {
  id: string;
  url?: string;
  title?: string;
  content: string;
  tags: string[];
  timestamp: Date;
  lastFetched: Date;
  accessCount: number;
  metadata?: Record<string, any>;
  embedding?: number[];
}

export interface DocSearchOptions {
  query?: string;
  tags?: string[];
  limit?: number;
  sortBy?: 'timestamp' | 'accessCount' | 'lastFetched';
  sortOrder?: 'asc' | 'desc';
}

export interface DocSearchResult {
  entries: DocEntry[];
  totalFound: number;
  searchTime: number;
}

export interface AddMemoryOptions {
  content: string;
  tags?: string[];
  context?: string;
  importance?: number;
  metadata?: Record<string, any>;
  clusterId?: string;
}

export interface CreateClusterOptions {
  name: string;
  description: string;
  tags?: string[];
  details?: Array<{
    key: string;
    value: string;
    type?: 'text' | 'number' | 'date' | 'list' | 'json';
    importance?: number;
  }>;
  metadata?: Record<string, any>;
}

export interface UpdateClusterOptions {
  name?: string;
  description?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface ClusterSearchOptions {
  query?: string;
  tags?: string[];
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export interface SemanticSearchOptions {
  query?: string; // Optional - used at API level, not needed when embedding is already computed
  limit?: number;
  similarityThreshold?: number;
  tags?: string[];
  contextFilter?: string;
}

export interface SemanticSearchResult {
  entries: Array<MemoryEntry & { similarity: number }>;
  totalFound: number;
  searchTime: number;
}

export interface DocSemanticSearchResult {
  entries: Array<DocEntry & { similarity: number }>;
  totalFound: number;
  searchTime: number;
}

export { type BaseProvider } from './BaseProvider.js';