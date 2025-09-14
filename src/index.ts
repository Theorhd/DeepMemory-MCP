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
import { fileURLToPath } from 'url';

import { 
  Memory, 
  MemoryEntry,
  SearchOptions, 
  AddMemoryOptions 
} from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DeepMemoryServer {
  private server: Server;

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
      }
    ];

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools };
    });
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      console.error(`[${Date.now()}] Handler called for: ${request.params.name}`);
      
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "add_memory":
            return await this.handleAddMemory(args as any);
          case "search_memory":
            return await this.handleSearchMemory(args as any);
          case "get_memories":
            return await this.handleGetMemories(args as any);
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

    // Global error handling
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      console.error('Stack:', error.stack);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
  }

  private async loadMemoryFromFile(): Promise<Memory> {
    const filePath = path.join(__dirname, 'memory.json');
    try {
      const fileContent = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      return {
        ...data,
        lastModified: new Date(data.lastModified),
        entries: data.entries.map((entry: any) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
          lastAccessed: new Date(entry.lastAccessed)
        }))
      };
    } catch (e) {
      return {
        entries: [],
        totalEntries: 0,
        lastModified: new Date()
      };
    }
  }

  private async handleAddMemory(args: AddMemoryOptions & { content: string }): Promise<any> {
    console.error(`[${Date.now()}] handleAddMemory started`);
    
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

      console.error(`[${Date.now()}] Created entry with ID: ${newEntry.id}`);

      // Direct file writing - simple and reliable
      const filePath = path.join(__dirname, 'memory.json');
      console.error(`[${Date.now()}] Writing to file: ${filePath}`);
      
      // Read existing file or create empty structure
      let existingData: { entries: any[], totalEntries: number, lastModified: string } = { 
        entries: [], 
        totalEntries: 0, 
        lastModified: new Date().toISOString() 
      };
      try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        existingData = JSON.parse(fileContent);
        console.error(`[${Date.now()}] Loaded ${existingData.entries.length} existing entries`);
      } catch (e) {
        console.error(`[${Date.now()}] File doesn't exist, creating new one`);
      }

      // Add new entry
      existingData.entries.push({
        ...newEntry,
        timestamp: newEntry.timestamp.toISOString(),
        lastAccessed: newEntry.lastAccessed.toISOString()
      });
      existingData.totalEntries = existingData.entries.length;
      existingData.lastModified = new Date().toISOString();

      console.error(`[${Date.now()}] Added entry, total: ${existingData.entries.length}`);

      // Write file
      const jsonData = JSON.stringify(existingData, null, 2);
      await fs.writeFile(filePath, jsonData, 'utf8');
      console.error(`[${Date.now()}] File written successfully`);

      return {
        content: [
          {
            type: "text",
            text: `Memory successfully saved with ID: ${newEntry.id} (${existingData.entries.length} total entries)`
          }
        ]
      };

    } catch (error) {
      console.error(`[${Date.now()}] Error in handleAddMemory:`, error);
      return {
        content: [
          {
            type: "text",
            text: `Error saving memory: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleSearchMemory(args: SearchOptions): Promise<any> {
    try {
      const startTime = Date.now();
      const memory = await this.loadMemoryFromFile();
      let filteredEntries = memory.entries;

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
      return {
        content: [
          {
            type: "text",
            text: `Error searching memories: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleGetMemories(args: { limit?: number; include_stats?: boolean }): Promise<any> {
    try {
      const memory = await this.loadMemoryFromFile();
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
        const avgImportance = memory.entries.length > 0 
          ? memory.entries.reduce((sum, entry) => sum + entry.importance, 0) / memory.entries.length 
          : 0;
        const tagCounts = memory.entries.reduce((counts, entry) => {
          entry.tags.forEach(tag => counts[tag] = (counts[tag] || 0) + 1);
          return counts;
        }, {} as Record<string, number>);
        
        const topTags = Object.entries(tagCounts)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
          .map(([tag, count]) => `${tag} (${count})`)
          .join(', ');

        const filePath = path.join(__dirname, 'memory.json');
        result += `\n\nStatistics:\n- Total memories: ${totalEntries}\n- Average importance: ${avgImportance.toFixed(1)}\n- Storage: Local storage at: ${filePath}\n- Top tags: ${topTags}`;
      }

      return {
        content: [
          {
            type: "text",
            text: result
          }
        ]
      };
    } catch (error) {
      console.error('Error in handleGetMemories:', error);
      return {
        content: [
          {
            type: "text",
            text: `Error retrieving memories: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      };
    }
  }

  async start(): Promise<void> {
    try {
      console.error("DeepMemory MCP Server starting...");
      
      const transport = new StdioServerTransport();
      
      transport.onclose = () => {
        console.error("Transport connection closed");
      };
      
      transport.onerror = (error) => {
        console.error("Transport error:", error);
      };

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
      process.exit(1);
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