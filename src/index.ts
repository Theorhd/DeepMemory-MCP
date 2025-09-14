#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { v4 as uuidv4 } from 'uuid';
import Fuse from 'fuse.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

import { 
  Memory, 
  MemoryEntry,
  SearchOptions, 
  SearchResult, 
  StorageProvider, 
  DeepMemoryConfig,
  AddMemoryOptions 
} from './types/index.js';
import { LocalStorageProvider, GoogleDriveProvider } from './providers/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DeepMemoryServer {
  private server: Server;
  private storageProvider!: StorageProvider;
  private config!: DeepMemoryConfig;
  private configPath: string;
  private operationQueue: Promise<any> = Promise.resolve();

  constructor() {
    // Stocker la config à côté du code pour éviter les problèmes de permissions / chemin utilisateur
    this.configPath = path.join(__dirname, 'config.json');
    this.server = new Server(
      {
        name: "deepmemory-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupTools();
    this.setupHandlers();
  }

  private async loadConfig(): Promise<void> {
    try {
      console.error("Loading configuration from:", this.configPath);
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      console.error("Configuration loaded:", this.config.storage.type);
    } catch (error) {
      console.error("Config not found, creating default config in code directory");
      this.config = {
        storage: {
          type: 'local',
          // Chemin du fichier mémoire dans le même dossier que le code (dist au runtime)
          localPath: path.join(__dirname, 'memory.json')
        },
        maxEntries: 10000,
        autoCleanup: false,
        cleanupThreshold: 8000
      };
      await this.saveConfig();
    }

    // Forcer le localPath si storage local et absent ou ancien format
    if (this.config.storage.type === 'local') {
      if (!this.config.storage.localPath || this.config.storage.localPath.includes('.deepmemory')) {
        this.config.storage.localPath = path.join(__dirname, 'memory.json');
        console.error('Updated local storage path to code directory:', this.config.storage.localPath);
        await this.saveConfig();
      }
    }

    try {
      await this.initializeStorageProvider();
      console.error("Storage provider initialized");
    } catch (error) {
      console.error("Storage provider initialization failed:", error);
      throw error;
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  private async initializeStorageProvider(): Promise<void> {
    try {
      console.error("Initializing storage provider:", this.config.storage.type);
      
      if (this.config.storage.type === 'googledrive') {
        if (!this.config.storage.googleDrive) {
          throw new Error('Google Drive configuration is missing');
        }
        this.storageProvider = new GoogleDriveProvider(this.config.storage.googleDrive);
      } else {
        this.storageProvider = new LocalStorageProvider(this.config.storage.localPath);
      }

      console.error("Storage provider created, initializing...");
      await this.storageProvider.initialize();
      console.error("Storage provider initialized successfully");
    } catch (error) {
      console.error("Storage provider initialization error:", error);
      throw error;
    }
  }

  private setupTools(): void {
    const tools: Tool[] = [
      {
        name: "add_memory",
        description: "Add a new memory entry to long-term storage",
        inputSchema: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The content to remember"
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags to categorize this memory",
              default: []
            },
            context: {
              type: "string", 
              description: "Context or category for this memory",
              default: ""
            },
            importance: {
              type: "number",
              description: "Importance level (1-10, 10 being most important)",
              minimum: 1,
              maximum: 10,
              default: 5
            },
            metadata: {
              type: "object",
              description: "Additional metadata for this memory",
              default: {}
            }
          },
          required: ["content"]
        }
      },
      {
        name: "search_memory",
        description: "Search through stored memories",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query to find relevant memories"
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Filter by specific tags"
            },
            context: {
              type: "string",
              description: "Filter by context"
            },
            importance_threshold: {
              type: "number",
              description: "Minimum importance level",
              minimum: 1,
              maximum: 10
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return",
              default: 10
            },
            sort_by: {
              type: "string",
              enum: ["timestamp", "importance", "accessCount", "lastAccessed"],
              description: "Sort results by",
              default: "importance"
            }
          }
        }
      },
      {
        name: "get_memories",
        description: "Get recent memories or memory statistics",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Number of recent memories to retrieve",
              default: 20
            },
            include_stats: {
              type: "boolean",
              description: "Include memory statistics",
              default: false
            }
          }
        }
      },
      {
        name: "configure_storage",
        description: "Configure storage provider (local or Google Drive)",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["local", "googledrive"],
              description: "Storage type to configure"
            },
            local_path: {
              type: "string",
              description: "Custom local storage path (optional)"
            },
            google_client_id: {
              type: "string",
              description: "Google OAuth2 client ID"
            },
            google_client_secret: {
              type: "string",
              description: "Google OAuth2 client secret"
            },
            google_auth_code: {
              type: "string",
              description: "Google OAuth2 authorization code"
            }
          },
          required: ["type"]
        }
      },
      {
        name: "get_google_auth_url",
        description: "Get Google OAuth2 authorization URL for Drive access",
        inputSchema: {
          type: "object",
          properties: {
            client_id: {
              type: "string",
              description: "Google OAuth2 client ID"
            },
            client_secret: {
              type: "string", 
              description: "Google OAuth2 client secret"
            }
          },
          required: ["client_id", "client_secret"]
        }
      }
    ];

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools };
    });
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      console.error(`[${Date.now()}] ===== HANDLER APPELÉ POUR: ${request.params.name} =====`);
      
      const { name, arguments: args } = request.params;

      // TEST IMMEDIAT - RETOUR DIRECT SANS RIEN FAIRE
      if (name === "add_memory") {
        console.error(`[${Date.now()}] ===== RETOUR IMMEDIAT POUR add_memory =====`);
        return {
          content: [
            {
              type: "text",
              text: `TEST: Handler appelé avec succès pour add_memory à ${new Date().toISOString()}`
            }
          ]
        };
      }

      try {
        // Pour les autres outils, charger la config normalement
        if (!this.storageProvider) {
          await this.loadConfig();
        }

        switch (name) {
          case "search_memory":
            return await this.handleSearchMemory(args as any);
          case "get_memories":
            return await this.handleGetMemories(args as any);
          case "configure_storage":
            return await this.handleConfigureStorage(args as any);
          case "get_google_auth_url":
            return await this.handleGetGoogleAuthUrl(args as any);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error(`Error handling tool ${name}:`, error);
        console.error(`Stack trace:`, error instanceof Error ? error.stack : 'No stack trace');
        return {
          content: [
            {
              type: "text",
              text: `Error calling tool ${name}: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        };
      }
    });

    // Ajouter une gestion globale des erreurs pour éviter que le serveur se ferme
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      console.error('Stack:', error.stack);
      // Ne pas fermer le processus
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      // Ne pas fermer le processus
    });
  }

  private async handleAddMemory(args: AddMemoryOptions & { content: string }): Promise<any> {
    console.error(`[${Date.now()}] ==> handleAddMemory DEBUT`);
    
    try {
      // Create the new entry
      const newEntry: MemoryEntry = {
        id: uuidv4(),
        content: args.content,
        tags: args.tags || [],
        context: args.context || '',
        importance: args.importance || 5,
        timestamp: new Date(),
        lastAccessed: new Date(),
        accessCount: 0,
        metadata: args.metadata || {}
      };

      console.error(`[${Date.now()}] ==> Entry créée: ${newEntry.id}`);

      // ECRITURE DIRECTE BRUTALE - PAS DE COMPLICATIONS
      const filePath = path.join(__dirname, 'memory.json');
      console.error(`[${Date.now()}] ==> Chemin fichier: ${filePath}`);
      
      // Lire le fichier existant ou créer vide
      let existingData: { entries: any[], totalEntries: number, lastModified: Date } = { entries: [], totalEntries: 0, lastModified: new Date() };
      try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        existingData = JSON.parse(fileContent);
        console.error(`[${Date.now()}] ==> Fichier lu, ${existingData.entries.length} entrées existantes`);
      } catch (e) {
        console.error(`[${Date.now()}] ==> Fichier n'existe pas, création`);
      }

      // Ajouter la nouvelle entrée
      existingData.entries.push({
        ...newEntry,
        timestamp: newEntry.timestamp.toISOString(),
        lastAccessed: newEntry.lastAccessed.toISOString()
      });
      existingData.totalEntries = existingData.entries.length;
      existingData.lastModified = new Date();

      console.error(`[${Date.now()}] ==> Ajout effectué, ${existingData.entries.length} entrées total`);

      // ECRIRE DIRECTEMENT
      const jsonData = JSON.stringify(existingData, null, 2);
      console.error(`[${Date.now()}] ==> JSON créé, ${jsonData.length} caractères`);
      
      await fs.writeFile(filePath, jsonData, 'utf8');
      console.error(`[${Date.now()}] ==> FICHIER ECRIT AVEC SUCCES !`);

      return {
        content: [
          {
            type: "text",
            text: `Memory successfully saved with ID: ${newEntry.id} (${existingData.entries.length} total entries)`
          }
        ]
      };

    } catch (error) {
      console.error(`[${Date.now()}] ==> ERREUR:`, error);
      return {
        content: [
          {
            type: "text",
            text: `ERREUR: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleSearchMemory(args: SearchOptions): Promise<any> {
    try {
      const startTime = Date.now();
      const memory = await this.storageProvider.loadMemory();
      let filteredEntries = memory.entries;

      // Ne pas modifier les données lors d'une recherche simple
      // Seulement filtrer et trier sans toucher aux accessCount/lastAccessed

      if (args.tags && args.tags.length > 0) {
        filteredEntries = filteredEntries.filter(entry => 
          args.tags!.some(tag => entry.tags.includes(tag))
        );
      }

      if (args.contextFilter) {
        filteredEntries = filteredEntries.filter(entry => 
          entry.context.toLowerCase().includes(args.contextFilter!.toLowerCase())
        );
      }

      if (args.importanceThreshold) {
        filteredEntries = filteredEntries.filter(entry => 
          entry.importance >= args.importanceThreshold!
        );
      }

      if (args.query) {
        const fuse = new Fuse(filteredEntries, {
          keys: ['content', 'tags', 'context'],
          threshold: 0.3,
          includeScore: true
        });
        
        const searchResults = fuse.search(args.query);
        // Ne pas modifier lastAccessed et accessCount lors de la recherche
        filteredEntries = searchResults.map((result: any) => result.item);
      }

      const sortBy = args.sortBy || 'importance';
      const sortOrder = args.sortOrder || 'desc';
      
      filteredEntries.sort((a, b) => {
        let aVal: any, bVal: any;
        
        switch (sortBy) {
          case 'timestamp':
            aVal = a.timestamp.getTime();
            bVal = b.timestamp.getTime();
            break;
          case 'lastAccessed':
            aVal = a.lastAccessed.getTime();
            bVal = b.lastAccessed.getTime();
            break;
          case 'accessCount':
            aVal = a.accessCount;
            bVal = b.accessCount;
            break;
          default:
            aVal = a.importance;
            bVal = b.importance;
        }
        
        return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
      });

      const limit = args.limit || 10;
      const results = filteredEntries.slice(0, limit);
      
      // Ne pas sauvegarder lors d'une recherche - cela élimine la boucle infinie !

      const searchTime = Date.now() - startTime;
      
      const resultText = results.length > 0 
        ? results.map((entry, index) => 
            `${index + 1}. [${entry.importance}/10] ${entry.content.substring(0, 200)}${entry.content.length > 200 ? '...' : ''}\n   Tags: ${entry.tags.join(', ')}\n   Context: ${entry.context}\n   Created: ${entry.timestamp.toLocaleString()}`
          ).join('\n\n')
        : 'No memories found matching your search criteria.';

      return {
        content: [
          {
            type: "text",
            text: `Found ${results.length} memories (searched ${filteredEntries.length} entries in ${searchTime}ms):\n\n${resultText}`
          }
        ]
      };
    } catch (error) {
      console.error('Error in handleSearchMemory:', error);
      throw new Error(`Failed to search memories: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleGetMemories(args: { limit?: number; include_stats?: boolean }): Promise<any> {
    const memory = await this.storageProvider.loadMemory();
    const limit = args.limit || 20;
    
    const recentMemories = memory.entries
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);

    let result = `Recent ${recentMemories.length} memories:\n\n`;
    
    result += recentMemories.map((entry, index) => 
      `${index + 1}. [${entry.importance}/10] ${entry.content.substring(0, 150)}${entry.content.length > 150 ? '...' : ''}\n   Tags: ${entry.tags.join(', ')}\n   Created: ${entry.timestamp.toLocaleString()}`
    ).join('\n\n');

    if (args.include_stats) {
      const totalEntries = memory.totalEntries;
      const avgImportance = memory.entries.reduce((sum, entry) => sum + entry.importance, 0) / totalEntries;
      const tagCounts = memory.entries.reduce((counts, entry) => {
        entry.tags.forEach(tag => counts[tag] = (counts[tag] || 0) + 1);
        return counts;
      }, {} as Record<string, number>);
      
      const topTags = Object.entries(tagCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([tag, count]) => `${tag} (${count})`)
        .join(', ');

      result += `\n\nStatistics:\n- Total memories: ${totalEntries}\n- Average importance: ${avgImportance.toFixed(1)}\n- Storage: ${this.storageProvider.getStorageInfo()}\n- Top tags: ${topTags}`;
    }

    return {
      content: [
        {
          type: "text",
          text: result
        }
      ]
    };
  }

  private async handleConfigureStorage(args: any): Promise<any> {
    try {
      console.error("Configuring storage with args:", JSON.stringify(args));
      
      if (args.type === 'local') {
        console.error("Setting up local storage configuration");
        this.config.storage = {
          type: 'local',
          localPath: args.local_path
        };
        
        console.error("Saving config...");
        await this.saveConfig();
        console.error("Initializing storage provider...");
        await this.initializeStorageProvider();
        console.error("Local storage configured successfully");
        
        return {
          content: [
            {
              type: "text",
              text: `Local storage configured successfully.\nStorage path: ${this.storageProvider.getStorageInfo()}`
            }
          ]
        };
      } else if (args.type === 'googledrive') {
      if (!args.google_client_id || !args.google_client_secret) {
        throw new Error('Google Drive configuration requires client_id and client_secret');
      }

      if (!args.google_auth_code) {
        const tempProvider = new GoogleDriveProvider({
          clientId: args.google_client_id,
          clientSecret: args.google_client_secret
        });
        
        const authUrl = tempProvider.getAuthUrl();
        
        return {
          content: [
            {
              type: "text",
              text: `To configure Google Drive storage:\n1. Visit this URL: ${authUrl}\n2. Authorize the application\n3. Copy the authorization code\n4. Run this command again with the google_auth_code parameter`
            }
          ]
        };
      }

      const tempProvider = new GoogleDriveProvider({
        clientId: args.google_client_id,
        clientSecret: args.google_client_secret
      });

      const tokens = await tempProvider.exchangeCodeForTokens(args.google_auth_code);
      
      this.config.storage = {
        type: 'googledrive',
        googleDrive: {
          clientId: args.google_client_id,
          clientSecret: args.google_client_secret,
          refreshToken: tokens.refreshToken
        }
      };

      await this.saveConfig();
      await this.initializeStorageProvider();

      return {
        content: [
          {
            type: "text",
            text: `Google Drive storage configured successfully.\n${this.storageProvider.getStorageInfo()}`
          }
        ]
      };
    }

    throw new Error('Invalid storage type. Use "local" or "googledrive"');
    } catch (error) {
      console.error("Error in handleConfigureStorage:", error);
      throw error;
    }
  }

  private async handleGetGoogleAuthUrl(args: { client_id: string; client_secret: string }): Promise<any> {
    const provider = new GoogleDriveProvider({
      clientId: args.client_id,
      clientSecret: args.client_secret
    });

    const authUrl = provider.getAuthUrl();

    return {
      content: [
        {
          type: "text",
          text: `Google OAuth2 Authorization URL:\n${authUrl}\n\nVisit this URL, authorize the application, and copy the authorization code to complete the setup.`
        }
      ]
    };
  }

  private async cleanupMemories(memory: Memory): Promise<void> {
    const threshold = this.config.cleanupThreshold || 8000;
    if (memory.entries.length <= threshold) return;

    console.error(`Cleaning up memories: ${memory.entries.length} -> ${threshold}`);

    memory.entries.sort((a, b) => {
      // Score plus élevé = plus important à garder
      // Plus l'importance est élevée, plus l'accessCount est élevé, moins le temps depuis dernier accès est long = meilleur score
      const daysSinceLastAccessA = (Date.now() - a.lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
      const daysSinceLastAccessB = (Date.now() - b.lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
      
      // Score: importance (50%) + accès fréquents (30%) + récence (20%)
      // Plus le score est élevé, plus l'entrée est importante
      const scoreA = a.importance * 0.5 + a.accessCount * 0.3 + (1 / (1 + daysSinceLastAccessA)) * 0.2;
      const scoreB = b.importance * 0.5 + b.accessCount * 0.3 + (1 / (1 + daysSinceLastAccessB)) * 0.2;
      
      return scoreB - scoreA; // Tri décroissant (meilleurs scores en premier)
    });

    const toRemove = memory.entries.length - threshold;
    console.error(`Removing ${toRemove} oldest/least important memories`);
    
    memory.entries = memory.entries.slice(0, threshold);
    memory.totalEntries = memory.entries.length;
  }

  async start(): Promise<void> {
    try {
      console.error("DeepMemory MCP Server starting...");
      await this.loadConfig();
      console.error("Configuration loaded successfully");
      
      const transport = new StdioServerTransport();
      
      // Gérer les erreurs de transport plus robustement
      transport.onclose = () => {
        console.error("Transport connection closed");
      };
      
      transport.onerror = (error) => {
        console.error("Transport error:", error);
        // Ne pas relancer l'erreur pour éviter la fermeture
      };

      // Gérer les erreurs STDIN/STDOUT
      process.stdin.on('error', (error) => {
        console.error('STDIN error:', error);
      });

      process.stdout.on('error', (error) => {
        console.error('STDOUT error:', error);
      });
      
      await this.server.connect(transport);
      console.error("DeepMemory MCP Server running on stdio");
    } catch (error) {
      console.error("Failed to start server:", error);
      if (error instanceof Error && error.stack) {
        console.error("Stack trace:", error.stack);
      }
      // Ne pas relancer l'erreur pour éviter la fermeture
      console.error("Server will attempt to continue despite the error...");
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = new DeepMemoryServer();
  server.start().catch((error) => {
    console.error("Server error:", error);
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  });
}