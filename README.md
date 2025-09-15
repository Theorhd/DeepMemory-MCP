# DeepMemory MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![version](https://img.shields.io/badge/version-1.0.1-blue.svg)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)

DeepMemory MCP is a small Model Context Protocol (MCP) server that provides long-term memory storage for conversational agents.

It stores memories locally in an SQLite database and exposes a set of MCP tools to add/search/list memories. It also provides a lightweight HTTP fallback and a simple persistent queue to accept memory writes while the DB initializes.

## Quick overview

- Storage: SQLite database at `~/.deepmemory/deepmemory.db`
- Queue: `~/.deepmemory/queue.jsonl` (append-only JSONL for queued add_memory requests)
- Default HTTP fallback: `http://127.0.0.1:6789` (configurable via `DEEP_MEMORY_HTTP_PORT`)

## Features

- add/search/get/list memories via MCP tools
- Persistent queue to accept writes before DB ready
- Simple HTTP fallback for health checks / minimal interactions
- Cross-platform (Windows / macOS / Linux)

## Installation

Requirements

- Node.js >= 18
- npm (or yarn)

Install

```powershell
git clone <repo-url>
cd deepmemory-mcp
npm install
```

Build

```powershell
npm run build
```

Run (dev)

```powershell
npm run dev
```

Run (production)

```powershell
npm start
```

## Usage as an MCP Server

Configure your MCP host (e.g. Jan) to start the server via stdio. Example config snippet:

```json
{
  "mcpServers": {
    "deepmemory-mcp": {
      "command": "node",
      "args": ["/path/to/deepmemory-mcp/dist/index.js"],
      "type": "stdio",
      "active": true
    }
  }
}
```

## Tools (MCP)

All tools use the MCP CallTool/Return format. The server advertises these tools via ListTools.

1. add_memory

  Description: add a memory entry to long-term storage.

  Input (JSON):

  { content (string, required), tags (string[]), context (string), importance (1-10), metadata (object) }

  Response: Text confirming saved ID.

1. search_memory

  Description: perform searches with filters.

  Input (JSON):

  { query, tags, context, importance_threshold, limit (default 20), sort_by, sort_order }

  Response: Formatted text with found memories and counts.

1. get_memories

  Description: retrieve recent memories.

  Input (JSON):

  { limit, context, min_importance }

1. load_all_memory

  Description: returns all memories (no filters).

1. get_memory_stats

  Description: returns basic stats (totalEntries, lastModified, storage info).

## HTTP fallback (quick reference)

The server exposes a local HTTP endpoint used mainly as a fallback/health-check. By default it listens on 127.0.0.1:6789. It accepts POST JSON bodies and responds with a JSON success or error.

Configure port with env var:

- DEEP_MEMORY_HTTP_PORT=12345

## Storage details

- Database file: `~/.deepmemory/deepmemory.db`
- Queue file: `~/.deepmemory/queue.jsonl`

Both files are created automatically in the user's home directory.

## Environment variables

- DEEP_MEMORY_HTTP_PORT: port for the HTTP fallback (default 6789)

## Development & scripts

- npm run build — compile TypeScript to dist/
- npm start — run compiled server (node dist/index.js)
- npm run dev — run directly from source with tsx
- npm run clean — remove dist/

## Troubleshooting

- If the server cannot write files: check permissions on your home directory and `~/.deepmemory/`.
- If SQLite initialization fails: ensure no other process locks the DB and Node is up to date.
- For queued items not processed: the queue is processed after DB initialization; check `queue.jsonl` and logs.

## Contributing

Contributions are welcome. Typical workflow:

1. Fork
2. Create a feature branch
3. Implement and test
4. Open a PR describing the change

Please add tests for new features where appropriate.

## License

MIT

## Authors / Maintainers

- Théo (author)

---

Si vous voulez, je peux ajouter des sections supplémentaires : exemples d'appels HTTP, guide d'intégration avec Jan, ou docs pour le provider SQLite (schéma). Dites-moi ce que vous préférez.

## Licence et réutilisation

Ce projet est publié sous la licence MIT. Vous pouvez librement utiliser, copier, modifier, distribuer et intégrer ce code dans des programmes tiers, y compris pour un usage commercial, sous réserve de conserver l'avis de copyright et la licence dans les copies substantielles du logiciel.

Voir le fichier `LICENSE` pour le texte complet.
