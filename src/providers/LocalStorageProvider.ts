import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StorageProvider, Memory, MemoryEntry } from '../types/index.js';

export class LocalStorageProvider implements StorageProvider {
  private filePath: string;
  private initialized = false;

  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = customPath;
      console.error('[LocalStorageProvider] Using custom path:', this.filePath);
    } else {
      const homeDir = os.homedir();
      const memoryDir = path.join(homeDir, '.deepmemory');
      this.filePath = path.join(memoryDir, 'memory.json');
      console.error('[LocalStorageProvider] Using legacy home path (no customPath provided):', this.filePath);
    }
  }

  async initialize(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      
      try {
        await fs.access(this.filePath);
      } catch {
        // File doesn't exist, create empty memory file
        const emptyMemory: Memory = {
          entries: [],
          totalEntries: 0,
          lastModified: new Date()
        };
        
        // Write initial file directly without calling saveMemory to avoid recursion
        const data = JSON.stringify({
          ...emptyMemory,
          lastModified: new Date(),
          entries: emptyMemory.entries.map(entry => ({
            ...entry,
            timestamp: entry.timestamp.toISOString(),
            lastAccessed: entry.lastAccessed.toISOString()
          }))
        }, null, 2);
        
        await fs.writeFile(this.filePath, data, 'utf8');
      }
      
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize local storage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async saveMemory(memory: Memory): Promise<void> {
    const startTime = Date.now();
    console.error(`[${startTime}] LocalStorageProvider.saveMemory started`);
    console.error(`[${Date.now()}] File path: ${this.filePath}`);
    console.error(`[${Date.now()}] Entries to save: ${memory.entries.length}`);
    
    if (!this.initialized) {
      console.error(`[${Date.now()}] Initializing storage provider`);
      await this.initialize();
      console.error(`[${Date.now()}] Storage provider initialized`);
    }

    try {
      console.error(`[${Date.now()}] Creating JSON data`);
      const data = JSON.stringify({
        ...memory,
        lastModified: new Date(),
        entries: memory.entries.map(entry => ({
          ...entry,
          timestamp: entry.timestamp.toISOString(),
          lastAccessed: entry.lastAccessed.toISOString()
        }))
      }, null, 2);

      console.error(`[${Date.now()}] JSON data created, size: ${data.length} characters`);

      // Créer le répertoire s'il n'existe pas
      const dir = path.dirname(this.filePath);
      console.error(`[${Date.now()}] Ensuring directory exists: ${dir}`);
      await fs.mkdir(dir, { recursive: true });
      console.error(`[${Date.now()}] Directory ensured`);

      // Écriture directe simple (pas d'atomic write pour éviter les blocages)
      console.error(`[${Date.now()}] Writing file directly: ${this.filePath}`);
      await fs.writeFile(this.filePath, data, 'utf8');
      console.error(`[${Date.now()}] File written successfully`);
      
      const totalTime = Date.now() - startTime;
      console.error(`[${Date.now()}] Memory saved successfully: ${memory.entries.length} entries in ${totalTime}ms`);
    } catch (error) {
      console.error(`[${Date.now()}] Error in saveMemory:`, error);
      throw new Error(`Failed to save memory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async loadMemory(): Promise<Memory> {
    const startTime = Date.now();
    console.error(`[${startTime}] LocalStorageProvider.loadMemory started`);
    
    if (!this.initialized) {
      console.error(`[${Date.now()}] Initializing storage provider`);
      await this.initialize();
      console.error(`[${Date.now()}] Storage provider initialized`);
    }

    try {
      console.error(`[${Date.now()}] Reading file: ${this.filePath}`);
      const data = await fs.readFile(this.filePath, 'utf8');
      console.error(`[${Date.now()}] File read, parsing JSON`);
      
      // Vérifier que le fichier n'est pas vide
      if (!data.trim()) {
        console.error(`[${Date.now()}] Memory file is empty, creating new memory`);
        return {
          entries: [],
          totalEntries: 0,
          lastModified: new Date()
        };
      }
      
      const parsed = JSON.parse(data);
      console.error(`[${Date.now()}] JSON parsed, processing entries`);
      
      const result = {
        ...parsed,
        lastModified: new Date(parsed.lastModified),
        entries: parsed.entries.map((entry: any) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
          lastAccessed: new Date(entry.lastAccessed)
        }))
      };
      
      const totalTime = Date.now() - startTime;
      console.error(`[${Date.now()}] LoadMemory completed: ${result.entries.length} entries in ${totalTime}ms`);
      return result;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        console.error(`[${Date.now()}] Memory file not found, creating new memory`);
        return {
          entries: [],
          totalEntries: 0,
          lastModified: new Date()
        };
      }
      
      if (error instanceof SyntaxError) {
        console.error(`[${Date.now()}] Invalid JSON in memory file, creating new memory:`, error.message);
        return {
          entries: [],
          totalEntries: 0,
          lastModified: new Date()
        };
      }
      
      throw new Error(`Failed to load memory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  isConfigured(): boolean {
    return this.initialized;
  }

  getStorageInfo(): string {
    return `Local storage at: ${this.filePath}`;
  }
}