# DeepMemory MCP Server

A Model Context Protocol (MCP) server for long-term memory management, allowing AI models to store, retrieve, and search information across conversations. Supports both local file storage and Google Drive cloud storage.

## Features

- **Long-term Memory**: Store and retrieve information across conversation sessions
- **Intelligent Search**: Fuzzy search with Fuse.js for finding relevant memories
- **Dual Storage**: Choose between local file storage or Google Drive cloud storage
- **Memory Organization**: Tag-based categorization and importance scoring
- **Smart Cleanup**: Automatic memory management based on importance and usage
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
    "deepmemory": {
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

Retrieve recent memories and optionally get statistics.

**Parameters:**
- `limit` (number, optional): Number of recent memories (default: 20)
- `include_stats` (boolean, optional): Include memory statistics (default: false)

**Example:**
```json
{
  "limit": 10,
  "include_stats": true
}
```

### configure_storage

Configure storage provider (local or Google Drive).

**For Local Storage:**
```json
{
  "type": "local",
  "local_path": "/custom/path/to/memory" // optional
}
```

**For Google Drive Storage:**
```json
{
  "type": "googledrive",
  "google_client_id": "your-client-id",
  "google_client_secret": "your-client-secret",
  "google_auth_code": "authorization-code"
}
```

### get_google_auth_url

Get Google OAuth2 authorization URL for Drive access.

**Parameters:**
- `client_id` (string, required): Google OAuth2 client ID
- `client_secret` (string, required): Google OAuth2 client secret

## Storage Configuration

### Local Storage

By default, memories are stored locally in:
- Windows: `C:\Users\Username\.deepmemory\memory.json`
- macOS: `/Users/Username/.deepmemory/memory.json`
- Linux: `/home/username/.deepmemory/memory.json`

### Google Drive Storage

To use Google Drive storage:

1. **Create Google Cloud Project:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable Google Drive API

2. **Create OAuth2 Credentials:**
   - Go to APIs & Services > Credentials
   - Create OAuth2 Client ID (Desktop application)
   - Note the Client ID and Client Secret

3. **Configure Storage:**
   ```json
   {
     "type": "googledrive",
     "google_client_id": "your-client-id",
     "google_client_secret": "your-client-secret"
   }
   ```

4. **Get Authorization URL:**
   Use `get_google_auth_url` tool to get the authorization URL

5. **Complete Setup:**
   Visit the URL, authorize, and use the code with `configure_storage`

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
│   ├── types/
│   │   └── index.ts          # Type definitions
│   ├── providers/
│   │   ├── LocalStorageProvider.ts
│   │   └── GoogleDriveProvider.ts
│   └── index.ts              # Main server
├── dist/                     # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **googleapis**: Google Drive API client
- **google-auth-library**: Google OAuth2 authentication
- **fuse.js**: Fuzzy search functionality
- **uuid**: Unique identifier generation
- **date-fns**: Date formatting utilities

## Security

- OAuth2 tokens are stored securely in local configuration
- Memory data is encrypted when stored on Google Drive
- All file operations are restricted to designated directories
- No sensitive data is logged or exposed

## Troubleshooting

### Common Issues

**"Storage provider not configured":**
- Run `configure_storage` tool first to set up your storage

**Google Drive authentication errors:**
- Ensure Google Drive API is enabled in your project
- Check that OAuth2 credentials are correct
- Verify the authorization code hasn't expired

**Permission errors:**
- Ensure the application has write permissions to the storage directory
- For Google Drive, verify the OAuth2 scope includes drive.file

**Memory not found:**
- Check that memories were saved successfully
- Verify storage configuration is correct
- For Google Drive, ensure internet connectivity

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