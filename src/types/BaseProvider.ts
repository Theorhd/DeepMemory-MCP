import type { MemoryEntry, SearchOptions, SearchResult, MemoryEntryWithCluster, DetailsCluster, ClusterDetail, CreateClusterOptions, UpdateClusterOptions, ClusterSearchOptions } from './index.js';

export interface BaseProvider {
  initialize(): Promise<void>;
  close(): Promise<void>;
  getStorageInfo(): string;

  createCluster(options: CreateClusterOptions): Promise<DetailsCluster>;
  getClusterById(id: string): Promise<DetailsCluster | null>;
  getClusterDetails(clusterId: string): Promise<ClusterDetail[]>;
  addClusterDetail(clusterId: string, detail: { key: string; value: string; type: ClusterDetail['type']; importance: number }): Promise<ClusterDetail>;
  searchClusters(options: ClusterSearchOptions): Promise<DetailsCluster[]>;
  updateCluster(clusterId: string, options: UpdateClusterOptions): Promise<DetailsCluster | null>;
  updateClusterDetail(detailId: string, update: Partial<Pick<ClusterDetail, 'key' | 'value' | 'type' | 'importance'>>): Promise<ClusterDetail | null>;
  deleteClusterDetail(detailId: string): Promise<number>;
  deleteCluster(clusterId: string): Promise<number>;

  addMemory(memory: Omit<MemoryEntry, 'id' | 'timestamp' | 'lastAccessed' | 'accessCount'>, id?: string): Promise<MemoryEntry>;
  searchMemories(options: SearchOptions): Promise<SearchResult>;
  getRecentMemories(limit?: number): Promise<MemoryEntry[]>;
  getAllMemories(): Promise<MemoryEntry[]>;
  getStats(): Promise<{ totalEntries: number; lastModified: Date | null; totalClusters: number }>;
  deleteMemories(options: any): Promise<number>;
  updateMemories(options: any): Promise<number>;
  linkMemoryToCluster(memoryId: string, clusterId: string): Promise<boolean>;
  unlinkMemoryFromCluster(memoryId: string): Promise<boolean>;
  getMemoriesByCluster(clusterId: string): Promise<MemoryEntry[]>;

  addDoc(doc: Omit<import('./index.js').DocEntry, 'id' | 'timestamp' | 'lastFetched' | 'accessCount'>, id?: string): Promise<import('./index.js').DocEntry>;
  searchDocs(options: import('./index.js').DocSearchOptions): Promise<import('./index.js').DocSearchResult>;
  getRecentDocs(limit?: number): Promise<import('./index.js').DocEntry[]>;
  getAllDocs(): Promise<import('./index.js').DocEntry[]>;
  deleteDocs(options: any): Promise<number>;
  updateDocs(options: any): Promise<number>;
}
