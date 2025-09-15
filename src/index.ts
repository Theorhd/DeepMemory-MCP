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
import { SearchOptions, MemoryEntry } from './types/index.js';
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

export class DeepMemoryServer {
  private server: Server;
  private sqliteProvider: SQLiteProvider;
  private sqliteReady: boolean = false;
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

  constructor() {
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

    const userHome = os.homedir();
    const deepMemoryDir = path.join(userHome, '.deepmemory');
    const dbPath = path.join(deepMemoryDir, 'deepmemory.db');
    
    fs.mkdir(deepMemoryDir, { recursive: true }).catch(() => {});
    
    this.sqliteProvider = new SQLiteProvider(dbPath);
    this.queuePath = path.join(deepMemoryDir, 'queue.jsonl');
    this.httpPort = Number(process.env.DEEP_MEMORY_HTTP_PORT) || 6789;

    this.setupTools();
    this.setupHandlers();
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
        name: "get_memory_stats",
        description: "Get statistics about stored memories",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
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

        if (!this.sqliteReady) {
          if (name === 'add_memory') {
            return await this.handleQueuedAddMemory(args);
          }
          
          const maxWait = 5000;
          const startWait = Date.now();
          while (!this.sqliteReady && (Date.now() - startWait) < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          if (!this.sqliteReady) {
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

    const entry = await this.withTimeout(
      this.sqliteProvider.addMemory({
        content: content.trim(),
        tags: tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0),
        context: String(context).trim(),
        importance: validImportance,
        metadata: metadata || {}
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

    const result = await this.withTimeout(
      this.sqliteProvider.searchMemories(options)
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

    const formattedEntries = result.entries.map(entry => {
      const tagsStr = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
      const contextStr = entry.context ? ` (${entry.context})` : '';
      const importanceStr = `★${entry.importance}`;
      
      return `${importanceStr}${contextStr}${tagsStr}\n${entry.content}\n---`;
    }).join('\n');

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
    
    const entries = await this.withTimeout(
      this.sqliteProvider.getRecentMemories(limit)
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

    const formattedEntries = entries.map(entry => {
      const tagsStr = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
      const contextStr = entry.context ? ` (${entry.context})` : '';
      const importanceStr = `★${entry.importance}`;
      const dateStr = entry.timestamp.toLocaleDateString();
      
      return `${importanceStr}${contextStr}${tagsStr} - ${dateStr}\n${entry.content}\n---`;
    }).join('\n');

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
    const stats = await this.withTimeout(
      this.sqliteProvider.getStats()
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
- Storage: ${this.sqliteProvider.getStorageInfo()}`
        }
      ]
    };
  }

  private async handleLoadAllMemory() {
    const entries = await this.withTimeout(
      this.sqliteProvider.getAllMemories()
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

    const formattedEntries = entries.map(entry => {
      const tagsStr = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
      const contextStr = entry.context ? ` (${entry.context})` : '';
      const importanceStr = `★${entry.importance}`;
      const dateStr = entry.timestamp.toLocaleDateString();
      
      return `${importanceStr}${contextStr}${tagsStr} - ${dateStr}\n${entry.content}\n---`;
    }).join('\n');

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
            await this.sqliteProvider.addMemory({
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
      
      await this.withTimeout(this.sqliteProvider.initialize(), 30000);
      this.sqliteReady = true;
      console.error("SQLite provider initialized");

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

      await this.sqliteProvider.close();
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
  const server = new DeepMemoryServer();
  globalThis.deepMemoryServer = server;
  server.run().catch(console.error);
}
