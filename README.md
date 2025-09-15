# DeepMemory MCP Server

A Model Context Protocol (MCP) server for long-term memory management with SQLite storage, allowing AI models to store, retrieve, and search information across conversations with reliable persistence and fast performance.

## Features

- **Long-term Memory**: Store and retrieve information across conversation sessions
- **SQLite Storage**: Fast, reliable database storage with automatic indexing
- **Intelligent Search**: Advanced search with filtering by tags, context, and importance
- **Memory Organization**: Tag-based categorization and importance scoring (1-10)
- **Access Tracking**: Monitor memory usage with access count and timestamps
- **HTTP Fallback**: Built-in HTTP endpoints for health checks and direct memory operations
- **Queue System**: Persistent queue for reliable memory operations during startup
- **Cross-platform**: Works on Windows, macOS, and Linux

## Installation

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Clone and Install

```bash
git clone https://github.com/your-username/deepmemory-mcp.git
cd deepmemory-mcp
npm install
```

### Build

```bash
npm run build
```

## Usage

### As MCP Server

Add to your MCP client configuration (e.g., Jan):

```json
{
  "mcpServers": {
    "deepmemory-mcp": {
      "command": "node",
      "args": ["path/to/deepmemory-mcp/dist/index.js"],
      "env": {},
      "type": "stdio",
      "active": true
    }
  }
}
```

### Standalone

```bash
npm start
```

## Tools

### add_memory

Store new information in long-term memory.

**Parameters:**
- `content` (string, required): The content to remember
- `tags` (array, optional): Tags to categorize this memory
- `context` (string, optional): Context or category for this memory
- `importance` (number, optional): Importance level (1-10, default: 5)
- `metadata` (object, optional): Additional metadata

**Example:**
```json
{
  "content": "The user prefers dark mode for all applications",
  "tags": ["preference", "ui"],
  "context": "user_preferences",
  "importance": 7,
  "metadata": {
    "category": "interface",
    "source": "conversation"
  }
}
```

### search_memory

Search through stored memories using various filters.

**Parameters:**
- `query` (string, optional): Search query to find relevant memories
- `tags` (array, optional): Filter by specific tags
- `context` (string, optional): Filter by context
- `importance_threshold` (number, optional): Minimum importance level
- `limit` (number, optional): Maximum results to return (default: 10)
- `sort_by` (string, optional): Sort by timestamp/importance/accessCount/lastAccessed

**Example:**
```json
{
  "query": "dark mode preferences",
  "tags": ["preference"],
  "importance_threshold": 5,
  "limit": 5,
  "sort_by": "importance"
}
```

### get_memories

Retrieve recent memories with optional filtering.

**Parameters:**

- `limit` (number, optional): Number of memories to retrieve (default: 20)
- `context` (string, optional): Filter by context
- `min_importance` (number, optional): Minimum importance level (1-10)

**Example:**

```json
{
  "limit": 10,
  "context": "user_preferences",
  "min_importance": 5
}
```

### load_all_memory

Load all memories from the database without any filtering or limits.

**Parameters:**

- None

**Example:**

```json
{}
```

### get_memory_stats

Get statistics about stored memories.

**Parameters:**

- None

**Example:**

```json
{}
```

## Storage

Memories are stored locally in SQLite database files:

- **Database**: `deepmemory.db` - Main SQLite database containing all memories
- **Queue**: `queue.jsonl` - Persistent queue for operations during startup
- **Location**: `~/.deepmemory/` directory in user's home folder

The database includes automatic indexing for optimal performance on searches by timestamp, importance, context, and tags.

## Memory Management

### Importance Scoring

Memories are scored 1-10 based on importance:

- 1-3: Low importance (casual information)
- 4-6: Medium importance (useful context)
- 7-8: High importance (key preferences/facts)
- 9-10: Critical importance (essential information)

### Automatic Cleanup

When memory reaches the maximum limit (default: 10,000 entries), the system automatically removes less important memories based on:

- Importance score (50% weight)
- Access frequency (30% weight)
- Age/last accessed (20% weight)

## Development

### Scripts

- `npm run build`: Compile TypeScript to JavaScript
- `npm start`: Run the compiled server
- `npm run dev`: Run in development mode with tsx
- `npm test`: Run tests
- `npm run clean`: Clean build directory

### Project Structure

```
deepmemory-mcp/
├── src/
│   ├── index.ts              # Main server implementation
│   ├── providers/
│   │   └── SQLiteProvider.ts # SQLite database provider
│   └── types/
│       └── index.ts          # Type definitions
├── dist/                     # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **sqlite3**: SQLite database driver for Node.js
- **uuid**: Unique identifier generation

## Security

- All file operations are restricted to the user's home directory
- SQLite database files are stored locally with appropriate permissions
- No sensitive data is logged or exposed
- Memory operations are validated and sanitized

## Troubleshooting

### Common Issues

**Permission errors:**

- Ensure the application has write permissions to the `~/.deepmemory/` directory
- Check that the user has access to their home directory

**Database errors:**

- Verify that SQLite3 is properly installed
- Check that the `~/.deepmemory/` directory exists and is writable
- Ensure no other processes are using the database file

**Memory not found:**

- Check that memories were saved successfully using `add_memory`
- Verify search parameters when using `search_memory`
- Use `get_memory_stats` to check database status

**Server won't start:**

- Ensure Node.js 18+ is installed
- Check that all dependencies are installed with `npm install`
- Verify the build completed successfully with `npm run build`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:

- Create an issue on GitHub
- Check existing issues for solutions
- Review the troubleshooting section above
