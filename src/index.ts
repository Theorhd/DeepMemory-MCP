#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { SQLiteProvider } from './providers/SQLiteProvider.js';
import { MySQLProvider } from './providers/MySQLProvider.js';
import { EmbeddingService } from './embedding/EmbeddingService.js';
import { fetchAndExtract } from './docs_search.js';
import { SearchOptions, MemoryEntry, CreateClusterOptions, UpdateClusterOptions, ClusterSearchOptions, DetailsCluster, ClusterDetail, SearchResult } from './types/index.js';
import * as path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import * as http from 'http';
import * as os from 'os';

declare global {
  var deepMemoryServer: DeepMemoryServer | undefined;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const version = "1.2.0";

export class DeepMemoryServer {
  private server: Server;
  private provider: any;
  private providerReady: boolean = false;
  private embeddingService: EmbeddingService;
  private embeddingReady: boolean = false;
  private requestTimeoutMs: number = 10000;
  private queuePath: string;
  private httpPort: number;
  private httpServer: http.Server | null = null;
  private queueProcessing = false;

  private withTimeout<T>(p: Promise<T>, ms?: number): Promise<T> {
    const timeout = ms ?? this.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);

      p.then((res) => {
        clearTimeout(timer);
        resolve(res);
      }).catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
  
  // Helper to format doc entries for text output
  private formatDocEntries(entries: Array<{ title?: string; url?: string; content: string }>, sliceLen: number = 300): string {
    return entries.map(e => {
      const header = e.title ? `${e.title} - ` : '';
      const link = e.url ? `${e.url}` : '';
      const body = e.content.slice(0, sliceLen);
      return `${header}${link}\n${body}\n---`;
    }).join('\n');
  }
  
  // Helper to format memories entries for text output
  private formatMemoryEntries(entries: Array<{ content: string; tags: string[]; context: string; importance: number; timestamp: Date }>, sliceLen: number = 200): string {
    return entries.map(e => {
      const tagsStr = e.tags.length ? ` [${e.tags.join(', ')}]` : '';
      const contextStr = e.context ? ` (${e.context})` : '';
      const importanceStr = `★${e.importance}`;
      const dateStr = e.timestamp.toLocaleDateString();
      const body = e.content.slice(0, sliceLen);
      return `${importanceStr}${contextStr}${tagsStr} - ${dateStr}\n${body}\n---`;
    }).join('\n');
  }

  private async handleCreateCluster(args: any) {
    if (!args || typeof args !== 'object') throw new Error('Invalid arguments');
    const { name, description, tags = [], details = [], metadata = {} } = args;
    if (!name || !description) throw new Error('`name` and `description` are required');

    const cluster = await this.withTimeout<DetailsCluster>(
      this.provider.createCluster({ name, description, tags, details, metadata } as CreateClusterOptions)
    );

    return {
      content: [ { type: 'text', text: `Cluster created with ID: ${cluster.id}` } ]
    };
  }

  private async handleSearchClusters(args: any) {
    const options: ClusterSearchOptions = {
      query: typeof args.query === 'string' ? args.query : undefined,
      tags: Array.isArray(args.tags) ? args.tags : undefined,
      limit: Math.max(1, Math.min(100, Number(args.limit) || 20)),
      sortBy: args.sort_by || 'createdAt',
      sortOrder: args.sort_order || 'desc'
    };

  const clusters = await this.withTimeout<DetailsCluster[]>(this.provider.searchClusters(options));

    const listText = clusters.map(c => `- ${c.name} (id: ${c.id})`).join('\n');

    return {
      content: [ { type: 'text', text: `Found ${clusters.length} clusters:\n${listText}` } ],
      data: clusters
    };
  }

  private async handleGetCluster(args: any) {
    if (!args || typeof args.id !== 'string') throw new Error('`id` is required');
  const cluster = await this.withTimeout<DetailsCluster | null>(this.provider.getClusterById(args.id));
    if (!cluster) throw new Error('Cluster not found');
    return { content: [ { type: 'text', text: JSON.stringify(cluster, null, 2) } ], data: cluster };
  }

  private async handleAddClusterDetail(args: any) {
    if (!args || typeof args.clusterId !== 'string') throw new Error('`clusterId` is required');
    if (typeof args.key !== 'string' || typeof args.value !== 'string') throw new Error('`key` and `value` are required');
  const detail = await this.withTimeout<ClusterDetail>(this.provider.addClusterDetail(args.clusterId, {
      key: args.key,
      value: args.value,
      type: args.type || 'text',
      importance: typeof args.importance === 'number' ? args.importance : 5
    }));
    return { content: [ { type: 'text', text: `Detail added with ID: ${detail.id}` } ], data: detail };
  }

  private async handleUpdateCluster(args: any) {
    if (!args || typeof args.id !== 'string') throw new Error('`id` is required');
    const update: UpdateClusterOptions = {} as any;
    if (typeof args.name === 'string') update.name = args.name;
    if (typeof args.description === 'string') update.description = args.description;
    if (Array.isArray(args.tags)) update.tags = args.tags;
    if (args.metadata && typeof args.metadata === 'object') update.metadata = args.metadata;

  const updated = await this.withTimeout<DetailsCluster | null>(this.provider.updateCluster(args.id, update));
    if (!updated) throw new Error('Cluster not found or no changes');
    return { content: [ { type: 'text', text: `Cluster updated: ${updated.id}` } ], data: updated };
  }

  private async handleUpdateClusterDetail(args: any) {
    if (!args || typeof args.detailId !== 'string') throw new Error('`detailId` is required');
    const update: any = {};
    if (typeof args.key === 'string') update.key = args.key;
    if (typeof args.value === 'string') update.value = args.value;
    if (typeof args.type === 'string') update.type = args.type;
    if (typeof args.importance === 'number') update.importance = args.importance;

  const updated = await this.withTimeout<ClusterDetail | null>(this.provider.updateClusterDetail(args.detailId, update));
    if (!updated) throw new Error('Detail not found or no changes');
    return { content: [ { type: 'text', text: `Cluster detail updated: ${updated.id}` } ], data: updated };
  }

  private async handleDeleteCluster(args: any) {
    if (!args || typeof args.id !== 'string') throw new Error('`id` is required');
  const deleted = await this.withTimeout<number>(this.provider.deleteCluster(args.id));
    return { content: [ { type: 'text', text: `Deleted ${deleted} cluster(s)` } ] };
  }

  private async handleDeleteClusterDetail(args: any) {
    if (!args || typeof args.detailId !== 'string') throw new Error('`detailId` is required');
  const deleted = await this.withTimeout<number>(this.provider.deleteClusterDetail(args.detailId));
    return { content: [ { type: 'text', text: `Deleted ${deleted} detail(s)` } ] };
  }

  private async handleLinkMemoryToCluster(args: any) {
    if (!args || typeof args.memoryId !== 'string' || typeof args.clusterId !== 'string') throw new Error('`memoryId` and `clusterId` are required');
  const ok = await this.withTimeout<boolean>(this.provider.linkMemoryToCluster(args.memoryId, args.clusterId));
    return { content: [ { type: 'text', text: ok ? 'Memory linked to cluster' : 'Memory or cluster not found' } ] };
  }

  private async handleUnlinkMemoryFromCluster(args: any) {
    if (!args || typeof args.memoryId !== 'string') throw new Error('`memoryId` is required');
  const ok = await this.withTimeout<boolean>(this.provider.unlinkMemoryFromCluster(args.memoryId));
    return { content: [ { type: 'text', text: ok ? 'Memory unlinked from cluster' : 'Memory not found or not linked' } ] };
  }

  private async handleGetMemoriesByCluster(args: any) {
    if (!args || typeof args.clusterId !== 'string') throw new Error('`clusterId` is required');
  const entries = await this.withTimeout<MemoryEntry[]>(this.provider.getMemoriesByCluster(args.clusterId));
    return { content: [ { type: 'text', text: `Found ${entries.length} memories in cluster` } ], data: entries };
  }

  constructor(provider?: any) {
    this.server = new Server(
      {
        name: "deepmemory-mcp",
        version: version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    const userHome = os.homedir();
    const deepMemoryDir = path.join(userHome, '.deepmemory');
    const dbPath = path.join(deepMemoryDir, 'deepmemory.db');
    
    fs.mkdir(deepMemoryDir, { recursive: true }).catch(() => {});
    
    if (provider) {
      this.provider = provider;
    } else {
      this.provider = new SQLiteProvider(dbPath);
    }
    this.queuePath = path.join(deepMemoryDir, 'queue.jsonl');
    this.httpPort = Number(process.env.DEEP_MEMORY_HTTP_PORT) || 6789;

    // Initialize embedding service
    this.embeddingService = EmbeddingService.getInstance();
    this.initializeEmbedding();

    this.setupTools();
    this.setupHandlers();
  }

  private async initializeEmbedding(): Promise<void> {
    try {
      await this.embeddingService.initialize();
      this.embeddingReady = true;
      console.error('Embedding service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize embedding service:', error);
      this.embeddingReady = false;
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
            },
            clusterId: {
              type: "string",
              description: "Optional: ID of the cluster to associate this memory with"
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
              default: 20
            },
            sort_by: {
              type: "string",
              enum: ["timestamp", "importance", "accessCount", "lastAccessed"],
              description: "Sort results by this field",
              default: "timestamp"
            },
            sort_order: {
              type: "string",
              enum: ["asc", "desc"],
              description: "Sort order",
              default: "desc"
            },
            include_cluster_details: {
              type: "boolean",
              description: "Include cluster details in results if memories are linked to clusters",
              default: true
            }
          },
          required: []
        }
      },
      {
        name: "get_memories",
        description: "Get recent memories or all memories with optional filtering",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Number of memories to retrieve",
              default: 20
            },
            context: {
              type: "string",
              description: "Filter by context"
            },
            min_importance: {
              type: "number",
              description: "Minimum importance level",
              minimum: 1,
              maximum: 10
            }
          },
          required: []
        }
      },
      {
        name: "load_all_memory",
        description: "Load all memories from the database without any filtering or limits",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "add_doc",
        description: "Add a development doc by URL or raw content into docs storage",
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Optional: URL to fetch the doc from' },
            content: { type: 'string', description: 'Optional: Raw content to store' },
            title: { type: 'string', description: 'Optional: title for the doc' },
            tags: { type: 'array', items: { type: 'string' }, default: [] },
            metadata: { type: 'object', default: {} }
          },
          required: []
        }
      },
      {
        name: 'search_docs',
        description: 'Search stored development docs',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            limit: { type: 'number', default: 20 },
            sort_by: { type: 'string', enum: ['timestamp', 'accessCount', 'lastFetched'], default: 'timestamp' },
            sort_order: { type: 'string', enum: ['asc','desc'], default: 'desc' }
          },
          required: []
        }
      },
      {
        name: 'get_docs',
        description: 'Get recent docs or all docs with optional limit',
        inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } }, required: [] }
      },
      {
        name: 'load_all_docs',
        description: 'Load all docs from storage without filters',
        inputSchema: { type: 'object', properties: {}, required: [] }
      },
      {
        name: 'delete_docs',
        description: 'Delete docs by id, tags, query, or before date',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            query: { type: 'string' },
            before: { type: 'string' },
            force: { type: 'boolean' }
          },
          required: []
        }
      },
      {
        name: 'update_docs',
        description: 'Update docs fields (content, title, tags, metadata) by id or filters',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            filters: { type: 'object' },
            update: { type: 'object' },
            force: { type: 'boolean' }
          },
          required: ['update']
        }
      },
      {
        name: "semantic_search_memory",
        description: "Perform semantic search on memories using AI embeddings. Requires embedding service to be initialized. Returns memories ranked by semantic similarity to the query.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language search query"
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return",
              default: 10
            },
            similarityThreshold: {
              type: "number",
              description: "Minimum similarity score (0-1). Higher values return only very similar results.",
              default: 0.5
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional: Filter results by tags"
            },
            contextFilter: {
              type: "string",
              description: "Optional: Filter results by context"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "semantic_search_docs",
        description: "Perform semantic search on documentation using AI embeddings. Requires embedding service to be initialized. Returns docs ranked by semantic similarity to the query.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language search query"
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return",
              default: 10
            },
            similarityThreshold: {
              type: "number",
              description: "Minimum similarity score (0-1). Higher values return only very similar results.",
              default: 0.5
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional: Filter results by tags"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_memory_stats",
        description: "Get statistics about stored memories and clusters",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "delete_memory",
        description: "Delete memories by id or by filters (tags, context, query, importance, before date)",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "ID of the memory to delete (exact match)" },
            tags: { type: "array", items: { type: "string" }, description: "Delete memories matching any of these tags" },
            context: { type: "string", description: "Delete memories matching context" },
            query: { type: "string", description: "Delete memories whose content matches this substring" },
            importance_less_than: { type: "number", description: "Delete memories with importance less than this value" },
            before: { type: "string", description: "ISO date string; delete memories older than this date" }
            ,
            force: { type: "boolean", description: "Set to true to allow deletion without filters (use with caution)" }
          },
          required: []
        }
      }
      ,
      {
        name: "update_memory",
        description: "Update memories' fields (content, tags, context, importance, metadata, clusterId) by id or filters",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "ID of the memory to update (exact match)" },
            filters: {
              type: "object",
              properties: {
                tags: { type: "array", items: { type: "string" } },
                query: { type: "string" },
                context: { type: "string" },
                importance_less_than: { type: "number" },
                before: { type: "string", description: "ISO date string" }
              }
            },
            update: {
              type: "object",
              properties: {
                content: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                context: { type: "string" },
                importance: { type: "number" },
                metadata: { type: "object" },
                clusterId: { type: "string", description: "Set to null to unlink from cluster" }
              }
            },
            force: { type: "boolean", description: "Set to true to allow updating without filters (use with caution)" }
          },
          required: ["update"]
        }
  },

      {
        name: "create_cluster",
        description: "Create a new details cluster to group related information",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the cluster (e.g., 'Trip to Japan', 'Work Project Alpha')"
            },
            description: {
              type: "string",
              description: "Description of what this cluster represents"
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags to categorize this cluster",
              default: []
            },
            details: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", description: "Detail key (e.g., 'destination', 'budget', 'dates')" },
                  value: { type: "string", description: "Detail value" },
                  type: { 
                    type: "string", 
                    enum: ["text", "number", "date", "list", "json"], 
                    default: "text" 
                  },
                  importance: { type: "number", minimum: 1, maximum: 10, default: 5 }
                },
                required: ["key", "value"]
              },
              description: "Initial details to add to the cluster",
              default: []
            },
            metadata: {
              type: "object",
              description: "Additional metadata for this cluster",
              default: {}
            }
          },
          required: ["name", "description"]
        }
      },
      {
        name: "search_clusters",
        description: "Search through existing clusters",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query for cluster names or descriptions"
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Filter by specific tags"
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return",
              default: 20
            },
            sort_by: {
              type: "string",
              enum: ["createdAt", "updatedAt", "name"],
              description: "Sort results by this field",
              default: "createdAt"
            },
            sort_order: {
              type: "string",
              enum: ["asc", "desc"],
              description: "Sort order",
              default: "desc"
            }
          },
          required: []
        }
      },
      {
        name: "get_cluster",
        description: "Get a specific cluster by ID with all its details",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "ID of the cluster to retrieve"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "add_cluster_detail",
        description: "Add a new detail to an existing cluster",
        inputSchema: {
          type: "object",
          properties: {
            clusterId: {
              type: "string",
              description: "ID of the cluster to add the detail to"
            },
            key: {
              type: "string",
              description: "Key for the detail (e.g., 'hotel', 'flight_info', 'budget_breakdown')"
            },
            value: {
              type: "string",
              description: "Value of the detail"
            },
            type: {
              type: "string",
              enum: ["text", "number", "date", "list", "json"],
              description: "Type of the detail",
              default: "text"
            },
            importance: {
              type: "number",
              description: "Importance level (1-10)",
              minimum: 1,
              maximum: 10,
              default: 5
            }
          },
          required: ["clusterId", "key", "value"]
        }
      },
      {
        name: "update_cluster",
        description: "Update cluster information (name, description, tags, metadata)",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "ID of the cluster to update"
            },
            name: { type: "string" },
            description: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            metadata: { type: "object" }
          },
          required: ["id"]
        }
      },
      {
        name: "update_cluster_detail",
        description: "Update a specific detail within a cluster",
        inputSchema: {
          type: "object",
          properties: {
            detailId: {
              type: "string",
              description: "ID of the detail to update"
            },
            key: { type: "string" },
            value: { type: "string" },
            type: { 
              type: "string", 
              enum: ["text", "number", "date", "list", "json"] 
            },
            importance: { type: "number", minimum: 1, maximum: 10 }
          },
          required: ["detailId"]
        }
      },
      {
        name: "delete_cluster",
        description: "Delete a cluster and all its details (memories will be unlinked but not deleted)",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "ID of the cluster to delete"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "delete_cluster_detail",
        description: "Delete a specific detail from a cluster",
        inputSchema: {
          type: "object",
          properties: {
            detailId: {
              type: "string",
              description: "ID of the detail to delete"
            }
          },
          required: ["detailId"]
        }
      },
      {
        name: "link_memory_to_cluster",
        description: "Link an existing memory to a cluster",
        inputSchema: {
          type: "object",
          properties: {
            memoryId: {
              type: "string",
              description: "ID of the memory to link"
            },
            clusterId: {
              type: "string",
              description: "ID of the cluster to link to"
            }
          },
          required: ["memoryId", "clusterId"]
        }
      },
      {
        name: "unlink_memory_from_cluster",
        description: "Unlink a memory from its cluster",
        inputSchema: {
          type: "object",
          properties: {
            memoryId: {
              type: "string",
              description: "ID of the memory to unlink"
            }
          },
          required: ["memoryId"]
        }
      },
      {
        name: "get_memories_by_cluster",
        description: "Get all memories linked to a specific cluster",
        inputSchema: {
          type: "object",
          properties: {
            clusterId: {
              type: "string",
              description: "ID of the cluster"
            }
          },
          required: ["clusterId"]
        }
      }
    ];

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools
    }));
  }


  private setupHandlers(): void {
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      try {
        if (!args || typeof args !== 'object') {
          throw new Error('Invalid arguments provided');
        }

        if (!this.providerReady) {
          if (name === 'add_memory') {
            return await this.handleQueuedAddMemory(args);
          }
          
          const maxWait = 5000;
          const startWait = Date.now();
          while (!this.providerReady && (Date.now() - startWait) < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          if (!this.providerReady) {
            throw new Error('Database not ready, please retry later');
          }
        }

        switch (name) {
          case "add_memory":
            return await this.handleAddMemory(args);
          case "search_memory":
            return await this.handleSearchMemory(args);
          case "get_memories":
            return await this.handleGetMemories(args);
          case "load_all_memory":
            return await this.handleLoadAllMemory();
          case "get_memory_stats":
            return await this.handleGetStats();
          case "delete_memory":
            return await this.handleDeleteMemory(args);
          case "update_memory":
            return await this.handleUpdateMemory(args);

          case "create_cluster":
            return await this.handleCreateCluster(args);
          case "search_clusters":
            return await this.handleSearchClusters(args);
          case "get_cluster":
            return await this.handleGetCluster(args);
          case "add_cluster_detail":
            return await this.handleAddClusterDetail(args);
          case "update_cluster":
            return await this.handleUpdateCluster(args);
          case "update_cluster_detail":
            return await this.handleUpdateClusterDetail(args);
          case "delete_cluster":
            return await this.handleDeleteCluster(args);
          case "delete_cluster_detail":
            return await this.handleDeleteClusterDetail(args);
          case "link_memory_to_cluster":
            return await this.handleLinkMemoryToCluster(args);
          case "unlink_memory_from_cluster":
            return await this.handleUnlinkMemoryFromCluster(args);
          case "get_memories_by_cluster":
            return await this.handleGetMemoriesByCluster(args);

          case 'add_doc':
            return await this.handleAddDoc(args);
          case 'search_docs':
            return await this.handleSearchDocs(args);
          case 'get_docs':
            return await this.handleGetDocs(args);
          case 'load_all_docs':
            return await this.handleLoadAllDocs();
          case 'delete_docs':
            return await this.handleDeleteDocs(args);
          case 'update_docs':
            return await this.handleUpdateDocs(args);
          case 'semantic_search_memory':
            return await this.handleSemanticSearchMemory(args);
          case 'semantic_search_docs':
            return await this.handleSemanticSearchDocs(args);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error in ${name}:`, errorMessage);

        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`
            }
          ]
        };
      }
    });
  }

  private async handleAddMemory(args: any) {
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments object');
    }

    const { content, tags = [], context = "", importance = 5, metadata = {} } = args;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('Content is required and must be a non-empty string');
    }

    if (!Array.isArray(tags)) {
      throw new Error('Tags must be an array');
    }

    const validImportance = Math.max(1, Math.min(10, Number(importance) || 5));
    if (isNaN(validImportance)) {
      throw new Error('Importance must be a number between 1 and 10');
    }

    // Generate embedding if service is ready
    let embedding: number[] | undefined;
    if (this.embeddingReady) {
      try {
        embedding = await this.embeddingService.generateEmbedding(content.trim());
      } catch (error) {
        console.error('Failed to generate embedding:', error);
        // Continue without embedding if it fails
      }
    }

    const entry = await this.withTimeout<MemoryEntry>(
      this.provider.addMemory({
        content: content.trim(),
        tags: tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0),
        context: String(context).trim(),
        importance: validImportance,
        metadata: metadata || {},
        embedding
      })
    );

    return {
      content: [
        {
          type: "text",
          text: `Memory added successfully with ID: ${entry.id}`
        }
      ]
    };
  }

  private async handleQueuedAddMemory(args: any) {
    try {
      const queueItem = {
        timestamp: new Date().toISOString(),
        params: {
          name: 'add_memory',
          arguments: args
        }
      };

      await fs.appendFile(this.queuePath, JSON.stringify(queueItem) + '\n', 'utf8');

      return {
        content: [
          {
            type: "text",
            text: "Memory queued for addition (database initializing). It will be processed shortly."
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to queue memory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleSearchMemory(args: any) {
    const options: SearchOptions = {
      query: args.query,
      tags: Array.isArray(args.tags) ? args.tags : undefined,
      contextFilter: args.context,
      importanceThreshold: args.importance_threshold,
      limit: Math.max(1, Math.min(100, Number(args.limit) || 20)),
      sortBy: args.sort_by || 'timestamp',
      sortOrder: args.sort_order || 'desc'
    };

    const result = await this.withTimeout<SearchResult>(
      this.provider.searchMemories(options)
    );

    if (result.entries.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No memories found matching your criteria."
          }
        ]
      };
    }

    const formattedEntries = this.formatMemoryEntries(result.entries, 500);

    return {
      content: [
        {
          type: "text",
          text: `Found ${result.totalFound} memories (searched in ${result.searchTime}ms):\n\n${formattedEntries}`
        }
      ]
    };
  }

  private async handleGetMemories(args: any) {
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
    
    const entries = await this.withTimeout<MemoryEntry[]>(
      this.provider.getRecentMemories(limit)
    );

    if (entries.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No memories found."
          }
        ]
      };
    }

    const formattedEntries = this.formatMemoryEntries(entries);

    return {
      content: [
        {
          type: "text",
          text: `Recent ${entries.length} memories:\n\n${formattedEntries}`
        }
      ]
    };
  }

  private async handleGetStats() {
    const stats = await this.withTimeout<{ totalEntries: number; lastModified: Date | null; totalClusters: number }>(
      this.provider.getStats()
    );

    const lastModifiedStr = stats.lastModified 
      ? stats.lastModified.toLocaleString()
      : 'Never';

    return {
      content: [
        {
          type: "text",
          text: `Memory Statistics:
- Total entries: ${stats.totalEntries}
- Last modified: ${lastModifiedStr}
- Storage: ${this.provider.getStorageInfo()}`
        }
      ]
    };
  }

  private async handleDeleteMemory(args: any) {
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments object');
    }

    const options = {
      id: typeof args.id === 'string' ? args.id : undefined,
      tags: Array.isArray(args.tags) ? args.tags : undefined,
      context: typeof args.context === 'string' ? args.context : undefined,
      query: typeof args.query === 'string' ? args.query : undefined,
      importanceLessThan: typeof args.importance_less_than === 'number' ? args.importance_less_than : (typeof args.importance_less_than === 'string' ? Number(args.importance_less_than) : undefined),
      before: typeof args.before === 'string' ? args.before : undefined
    };

    const deletedCount = await this.withTimeout<number>(
      this.provider.deleteMemories(options as any)
    );

    return {
      content: [
        {
          type: 'text',
          text: `Deleted ${deletedCount} memory entries.`
        }
      ]
    };
  }

  private async handleUpdateMemory(args: any) {
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments object');
    }

    if (!args.update || typeof args.update !== 'object') {
      throw new Error('`update` object is required');
    }

    const updateObj: any = {};
    if (typeof args.update.content === 'string') updateObj.content = args.update.content;
    if (Array.isArray(args.update.tags)) updateObj.tags = args.update.tags;
    if (typeof args.update.context === 'string') updateObj.context = args.update.context;
    if (typeof args.update.importance === 'number') updateObj.importance = args.update.importance;
    if (args.update.metadata && typeof args.update.metadata === 'object') updateObj.metadata = args.update.metadata;

    if (Object.keys(updateObj).length === 0) {
      throw new Error('No valid update fields provided');
    }

    const options = {
      id: typeof args.id === 'string' ? args.id : undefined,
      filters: args.filters ? {
        tags: Array.isArray(args.filters.tags) ? args.filters.tags : undefined,
        query: typeof args.filters.query === 'string' ? args.filters.query : undefined,
        context: typeof args.filters.context === 'string' ? args.filters.context : undefined,
        importanceLessThan: typeof args.filters.importance_less_than === 'number' ? args.filters.importance_less_than : (typeof args.filters.importance_less_than === 'string' ? Number(args.filters.importance_less_than) : undefined),
        before: typeof args.filters.before === 'string' ? args.filters.before : undefined
      } : undefined,
      update: updateObj,
      force: !!args.force
    };

    const updatedCount = await this.withTimeout<number>(
      this.provider.updateMemories(options as any)
    );

    return {
      content: [
        {
          type: 'text',
          text: `Updated ${updatedCount} memory entries.`
        }
      ]
    };
  }

  private async handleLoadAllMemory() {
    const entries = await this.withTimeout<MemoryEntry[]>(
      this.provider.getAllMemories()
    );

    if (entries.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No memories found in the database."
          }
        ]
      };
    }

    const formattedEntries = this.formatMemoryEntries(entries);

    return {
      content: [
        {
          type: "text",
          text: `All ${entries.length} memories:\n\n${formattedEntries}`
        }
      ]
    };
  }

  private async drainQueue(): Promise<void> {
    if (this.queueProcessing) {
      return;
    }

    this.queueProcessing = true;
    
    try {
      const exists = await fs.access(this.queuePath).then(() => true).catch(() => false);
      if (!exists) return;

      const data = await fs.readFile(this.queuePath, 'utf8');
      if (!data.trim()) return;

      const lines = data.split(/\r?\n/).filter(Boolean);
      let processedCount = 0;

      for (const line of lines) {
        try {
          const req = JSON.parse(line);
          if (req?.params?.name === 'add_memory') {
            const args = req.params.arguments || {};
            await this.provider.addMemory({
              content: args.content,
              tags: Array.isArray(args.tags) ? args.tags : [],
              context: String(args.context || ''),
              importance: Number(args.importance) || 5,
              metadata: args.metadata || {}
            });
            processedCount++;
          }
        } catch (err) {
          console.error('Failed to process queued item:', err);
        }
      }

      if (processedCount > 0) {
        await fs.writeFile(this.queuePath, '', 'utf8');
        console.error(`Processed ${processedCount} queued items`);
      }
    } finally {
      this.queueProcessing = false;
    }
  }

  private async handleAddDoc(args: any) {
    if (!args || typeof args !== 'object') throw new Error('Invalid arguments object');

    const { url, content, title, tags = [], metadata = {} } = args;

    let finalContent = content;
    let finalTitle = title;

    if (!finalContent && url) {
      try {
        const extracted = await fetchAndExtract(url);
        finalContent = extracted.text;
        if (!finalTitle) finalTitle = extracted.title;
      } catch (err) {
        throw new Error(`Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!finalContent || typeof finalContent !== 'string' || finalContent.trim().length === 0) {
      throw new Error('Either content or a valid URL that returns content is required');
    }

    // Generate embedding if service is ready
    let embedding: number[] | undefined;
    if (this.embeddingReady) {
      try {
        embedding = await this.embeddingService.generateEmbedding(finalContent.trim());
      } catch (error) {
        console.error('Failed to generate embedding:', error);
        // Continue without embedding if it fails
      }
    }

    const entry = await this.withTimeout<any>(this.provider.addDoc({ 
      url, 
      title: finalTitle, 
      content: finalContent, 
      tags, 
      metadata,
      embedding 
    }));

    return { content: [ { type: 'text', text: `Doc stored with ID: ${entry.id}` } ], data: entry };
  }

  private async handleSearchDocs(args: any) {
    const options = {
      query: typeof args.query === 'string' ? args.query : undefined,
      tags: Array.isArray(args.tags) ? args.tags : undefined,
      limit: Math.max(1, Math.min(200, Number(args.limit) || 20)),
      sortBy: args.sort_by || 'timestamp',
      sortOrder: args.sort_order || 'desc'
    } as any;

    const result = await this.withTimeout<any>(this.provider.searchDocs(options));

    if (!result || result.entries.length === 0) {
      return { content: [ { type: 'text', text: 'No docs found matching your criteria.' } ] };
    }

  const formatted = result.entries.map((e: any) => `${e.title ? e.title + ' - ' : ''}${e.url || ''}\n${e.content.slice(0, 500)}\n---`).join('\n');

  return { content: [ { type: 'text', text: `Found ${result.totalFound} docs (searched in ${result.searchTime}ms):\n\n${formatted}` } ], data: result };
  }

  private async handleGetDocs(args: any) {
    const limit = Math.max(1, Math.min(500, Number(args.limit) || 20));
    const entries = await this.withTimeout<any>(this.provider.getRecentDocs(limit));

    if (!entries || entries.length === 0) {
      return { content: [ { type: 'text', text: 'No docs found.' } ] };
    }

  const formatted = entries.map((e: any) => `${e.title ? e.title + ' - ' : ''}${e.url || ''}\n${e.content.slice(0,300)}\n---`).join('\n');

  return { content: [ { type: 'text', text: `Recent ${entries.length} docs:\n\n${formatted}` } ], data: entries };
  }

  private async handleLoadAllDocs() {
    const entries = await this.withTimeout<any>(this.provider.getAllDocs());
    if (!entries || entries.length === 0) {
      return { content: [ { type: 'text', text: 'No docs stored.' } ] };
    }

  const formatted = entries.map((e: any) => `${e.title ? e.title + ' - ' : ''}${e.url || ''}\n${e.content.slice(0,300)}\n---`).join('\n');

  return { content: [ { type: 'text', text: `All ${entries.length} docs:\n\n${formatted}` } ], data: entries };
  }

  private async handleDeleteDocs(args: any) {
    const options = {
      id: typeof args.id === 'string' ? args.id : undefined,
      tags: Array.isArray(args.tags) ? args.tags : undefined,
      query: typeof args.query === 'string' ? args.query : undefined,
      before: typeof args.before === 'string' ? args.before : undefined,
      force: !!args.force
    };

    const deleted = await this.withTimeout<number>(this.provider.deleteDocs(options));
    return { content: [ { type: 'text', text: `Deleted ${deleted} docs.` } ] };
  }

  private async handleUpdateDocs(args: any) {
    if (!args || typeof args !== 'object' || !args.update) throw new Error('`update` object is required');

    const options = {
      id: typeof args.id === 'string' ? args.id : undefined,
      filters: args.filters || undefined,
      update: args.update,
      force: !!args.force
    };

    const updated = await this.withTimeout<number>(this.provider.updateDocs(options));
    return { content: [ { type: 'text', text: `Updated ${updated} docs.` } ] };
  }

  private async handleSemanticSearchMemory(args: any) {
    if (!this.embeddingReady) {
      throw new Error('Embedding service is not initialized yet. Please wait a moment and try again.');
    }
    if (!args || typeof args.query !== 'string') {
      throw new Error('`query` parameter is required and must be a string');
    }

    // Generate embedding for the query
    const queryEmbedding = await this.embeddingService.generateEmbedding(args.query);

    // Prepare search options
    const options: import('./types/index.js').SemanticSearchOptions = {
      limit: Math.max(1, Math.min(100, Number(args.limit) || 10)),
      similarityThreshold: typeof args.similarityThreshold === 'number' ? args.similarityThreshold : 0.5,
      tags: Array.isArray(args.tags) ? args.tags : undefined,
      contextFilter: typeof args.contextFilter === 'string' ? args.contextFilter : undefined
    };

    // Perform semantic search
    const result = await this.withTimeout<import('./types/index.js').SemanticSearchResult>(
      this.provider.semanticSearchMemories(queryEmbedding, options)
    );

    // Format results
    const text = result.entries.length > 0
      ? this.formatMemoryEntries(result.entries, 300)
      : 'No results found.';

    return {
      content: [
        {
          type: 'text',
          text: `Found ${result.entries.length} memories (similarity threshold: ${options.similarityThreshold}):\n\n${text}`
        }
      ],
      data: result.entries
    };
  }

  private async handleSemanticSearchDocs(args: any) {
    if (!this.embeddingReady) {
      throw new Error('Embedding service is not initialized yet. Please wait a moment and try again.');
    }
    if (!args || typeof args.query !== 'string') {
      throw new Error('`query` parameter is required and must be a string');
    }

    // Generate embedding for the query
    const queryEmbedding = await this.embeddingService.generateEmbedding(args.query);

    // Prepare search options
    const options: import('./types/index.js').SemanticSearchOptions = {
      limit: Math.max(1, Math.min(100, Number(args.limit) || 10)),
      similarityThreshold: typeof args.similarityThreshold === 'number' ? args.similarityThreshold : 0.5,
      tags: Array.isArray(args.tags) ? args.tags : undefined
    };

    // Perform semantic search
    const result = await this.withTimeout<import('./types/index.js').DocSemanticSearchResult>(
      this.provider.semanticSearchDocs(queryEmbedding, options)
    );

    // Format results
    const text = result.entries.length > 0
      ? this.formatDocEntries(result.entries, 300)
      : 'No results found.';

    return {
      content: [
        {
          type: 'text',
          text: `Found ${result.entries.length} docs (similarity threshold: ${options.similarityThreshold}):\n\n${text}`
        }
      ],
      data: result.entries
    };
  }

  private setupHttpFallback(): void {
    this.httpServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const request = JSON.parse(body);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'HTTP fallback active' }));
        } catch (error) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    });

    this.httpServer.listen(this.httpPort, '127.0.0.1', () => {
      console.error(`HTTP fallback listening on http://127.0.0.1:${this.httpPort}`);
    });

    this.httpServer.on('error', (error) => {
      console.error('HTTP server error (non-critical):', error);
      this.httpServer = null;
    });
  }

  async run(): Promise<void> {
    try {
      console.error("Starting DeepMemory MCP Server...");
      
  await this.withTimeout<void>(this.provider.initialize(), 30000);
  this.providerReady = true;
  console.error("Storage provider initialized");

      await this.drainQueue();

      this.setupHttpFallback();

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      console.error("DeepMemory MCP Server running");
    } catch (error) {
      console.error("Failed to start server:", error);
      await this.shutdown();
      process.exit(1);
    }
  }

  async shutdown(): Promise<void> {
    console.error("Shutting down DeepMemory MCP Server...");
    
    try {
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer!.close(() => resolve());
        });
        this.httpServer = null;
      }

      if (this.provider && typeof this.provider.close === 'function') {
        await this.provider.close();
      }
      console.error("Server shutdown completed");
    } catch (error) {
      console.error("Error during shutdown:", error);
    }
  }
}

process.on('SIGINT', async () => {
  console.error('Received SIGINT, shutting down gracefully...');
  if (globalThis.deepMemoryServer) {
    await globalThis.deepMemoryServer.shutdown();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Received SIGTERM, shutting down gracefully...');
  if (globalThis.deepMemoryServer) {
    await globalThis.deepMemoryServer.shutdown();
  }
  process.exit(0);
});

const isMainModule = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) ||
  process.argv[1].endsWith('index.js')
);

if (isMainModule) {
  const argv = process.argv.slice(2);
  const hasFlag = (name: string) => argv.includes(name);
  const getFlag = (name: string) => {
    const idx = argv.indexOf(name);
    if (idx === -1) return undefined;
    return argv[idx + 1];
  };

  let providerInstance: any = undefined;

  if (hasFlag('--mysql')) {
    const host = getFlag('--mysql_host') || process.env.MYSQL_HOST || 'localhost';
    const user = getFlag('--mysql_id') || process.env.MYSQL_USER || process.env.MYSQL_ID;
    const passwordFlag = getFlag('--mysql_pwd');
    const passwordEnv = process.env.MYSQL_PASSWORD || process.env.MYSQL_PWD;
    const password = typeof passwordFlag !== 'undefined' ? passwordFlag : (typeof passwordEnv !== 'undefined' ? passwordEnv : undefined);
    const database = getFlag('--mysql_db') || process.env.MYSQL_DATABASE || 'deepmemory';
    const port = Number(getFlag('--mysql_port') || process.env.MYSQL_PORT || 3306);

    if (!user) {
      console.error('When using --mysql you must provide --mysql_id (or MYSQL_USER/MYSQL_ID env vars)');
      process.exit(2);
    }

    providerInstance = new MySQLProvider({ host, user, password, database, port, waitForConnections: true, connectionLimit: 10 });
    console.error('Using MySQL provider with host=' + host + ' user=' + user + ' db=' + database + ' (password ' + (password ? 'provided' : 'not provided') + ')');
  }

  const server = new DeepMemoryServer(providerInstance);
  globalThis.deepMemoryServer = server;
  server.run().catch(console.error);
}
