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

export { type BaseProvider } from './BaseProvider.js';