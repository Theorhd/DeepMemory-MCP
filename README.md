# DeepMemory MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![version](https://img.shields.io/badge/version-1.2.2-blue.svg)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)

## Changelog

### v1.2.2 — optimisations et refactorisation du code d'encryption

- **Refactorisation complète du système d'encryption** : ajout de méthodes helper centralisées `decryptContent()` et `encryptContent()` pour éliminer la duplication de code à travers les 11+ handlers.
- **Correction de bug critique** : `handleUpdateClusterDetail` n'encryptait pas les valeurs lors de la mise à jour - maintenant corrigé pour garantir la cohérence du chiffrement.
- **Amélioration de `handleUpdateMemory`** : support complet de l'encryption lors de la mise à jour du contenu des mémoires avec gestion automatique des métadonnées d'encryption.
- **Gestion d'erreur unifiée** : comportement cohérent lors des échecs de décryptage à travers tous les handlers (fallback gracieux avec logging).
- **Optimisation du backfill** : utilisation des méthodes helper pour l'encryption automatique des données existantes, garantissant une cohérence avec le reste du code.
- **Code plus maintenable** : réduction de ~150 lignes de code dupliqué, facilitant les futures évolutions et corrections de bugs.
- **Garantie de sécurité** : toutes les opérations de lecture/écriture passent désormais par les mêmes fonctions d'encryption/decryption, éliminant les risques d'oubli.

### v1.2.1 — chiffrement des données sensibles (--use-crypto)

- **Nouveau flag CLI `--use-crypto`** : active le chiffrement de bout en bout pour toutes les mémoires stockées.
- **Génération et gestion automatique des clés RSA** : au premier démarrage avec `--use-crypto`, génère une paire de clés RSA 2048 bits et les sauvegarde dans `~/.deepmemory/keys/`. Les clés sont automatiquement rechargées aux démarrages suivants.
- **Chiffrement hybride RSA+AES** : utilise `encryptJSON` pour chiffrer les contenus volumineux (combinaison RSA pour la clé symétrique et AES-256-CBC pour les données).
- **Migration automatique des données existantes** : au démarrage avec `--use-crypto`, tous les souvenirs non chiffrés en base sont automatiquement chiffrés et marqués avec `metadata.encrypted`.
- **Déchiffrement transparent** : les handlers de lecture (`search_memory`, `get_memories`, `load_all_memory`, etc.) déchiffrent automatiquement le contenu avant de le retourner.
- **Support MySQL** : méthode `updateMemories` implémentée dans `MySQLProvider` pour permettre la migration de chiffrement sur bases MySQL.
- **Package cryptojs-secure** : intégration du package `cryptojs-secure` (v0.1.2) pour la cryptographie asymétrique, avec corrections ESM dans les imports internes.

### v1.2.0 — recherche sémantique et migrations

- Ajout de la recherche sémantique sur mémoires et docs via outils MCP `semantic_search_memory` et `semantic_search_docs`, génération d'embeddings avec un modèle local (Qwen3 ou fallback MiniLM).
- Migration automatique du schéma SQLite & MySQL : ajout de la colonne `embedding` et backfill des embeddings existants.
- Gestion améliorée du fallback HTTP : ports occupés ne provoquent plus de crash.
- Fallback automatique vers un modèle d'embedding pris en charge si le modèle principal échoue à se charger.

### v1.1.3 — optimisations et refactorisations


- Factorisation de `formatMemoryEntries` et `formatDocEntries` pour réduire la duplication de code dans les handlers.
- Refactorisation des handlers MCP pour plus de clarté et meilleure séparation des responsabilités.
- Implémentation complète des méthodes docs dans `MySQLProvider` (CRUD, recherche, mise à jour des compteurs d'accès).
- Optimisation de la gestion des connexions MySQL (libération systématique en `finally`).
- Amélioration de la maintenabilité du code et préparation pour ajout ultérieur de parsing HTML plus robuste.

### v1.1.2 — ajout du stockage et des outils "docs" de développement

- Ajout d'un stockage dédié pour les documents de développement (séparé des "memories"). Les docs sont persistés dans une table `docs` distincte afin de garder les mémoires utilisateur inchangées.

- Nouvelles types et API provider : `DocEntry`, `DocSearchOptions`, `DocSearchResult` et extension de l'interface `BaseProvider` pour supporter les opérations sur les docs (addDoc, searchDocs, getRecentDocs, getAllDocs, deleteDocs, updateDocs).

- Implémentation SQLite complète pour les docs dans `SQLiteProvider` : création de la table `docs`, indexes, CRUD, recherche basique et mise à jour des compteurs d'accès.

- Stubs MySQL : méthodes docs présentes dans `MySQLProvider` (throw 'Not implemented') — à implémenter si vous souhaitez activer MySQL pour les docs.

- Nouveaux outils MCP exposés : `add_doc`, `search_docs`, `get_docs`, `load_all_docs`, `delete_docs`, `update_docs`.

  - `add_doc` accepte soit une `url` (le serveur récupère la page et en extrait texte/titre), soit du `content` brut.

- Utilitaire léger `src/docs_search.ts` : récupération HTTP et extraction simple de texte/titre (implémentation minimale pour éviter d'ajouter des dépendances lourdes). Note : l'implémentation actuelle utilise l'API globale `fetch` (Node >=18). Pour une extraction plus robuste, on peut intégrer `jsdom` ou `cheerio` ultérieurement.

- Mise à jour de la surface d'API MCP et documentation : nouveaux schémas d'entrée pour les outils docs exposés via ListTools.

Remarques :

- L'implémentation actuelle privilégie une approche simple et sans dépendances externes pour l'extraction HTML. Si vous souhaitez une extraction plus structurée (conserver headings, code blocks, etc.), je peux ajouter `jsdom`/`cheerio` et ajuster `package.json`.

- Le stockage des docs est volontairement séparé des memories pour éviter tout mélange des usages et permettre des optimisations spécifiques (indexation, FTS, politique de rétention différente).

### v1.1.1 — corrections et améliorations

- Remplacement du package natif `sqlite3` par `better-sqlite3` pour une maintenance améliorée, de meilleures performances et une meilleure expérience TypeScript. Le `package.json` a été mis à jour pour utiliser `better-sqlite3`.
- Ajout de l'interface `BaseProvider` (types partagés) : standardise le contrat que doivent implémenter les providers (SQLite, MySQL, etc.) et facilite l'ajout de nouveaux backends.
- Ajustements mineurs : mise à jour des providers existants pour implémenter `BaseProvider` et corrections mineures liées à l'initialisation/gestion des providers.

### v1.1.0 — nouveautés principales

- Clusters (Details Cluster)

  - Nouveaux outils MCP : `create_cluster`, `search_clusters`, `get_cluster`, `add_cluster_detail`, `update_cluster`, `delete_cluster`, `link_memory_to_cluster`, `unlink_memory_from_cluster`, `get_memories_by_cluster`.
  - Permet de regrouper des détails structurés (clé/valeur) liés à un sujet et de lier/délier des mémoires aux clusters.

- Provider MySQL (optionnel)

  - Nouveau provider `MySQLProvider` (basé sur `mysql2`).
  - Démarrage en MySQL via le flag CLI `--mysql` et options : `--mysql_host`, `--mysql_id`, `--mysql_pwd` (optionnel pour les bases sans mot de passe), `--mysql_db`, `--mysql_port`.
  - `SQLiteProvider` reste le backend par défaut.

- Abstraction des providers

  - Le code accepte désormais un provider injectable au démarrage, facilitant l'ajout de backend supplémentaires.

- Opérations & robustesse

  - Queue persistante (`~/.deepmemory/queue.jsonl`) pour accepter les requêtes `add_memory` pendant l'initialisation du stockage.
  - HTTP fallback local (par défaut `127.0.0.1:6789`) pour health-checks et interactions simples.
  - Meilleure gestion du démarrage/arrêt et tolérance aux bases anciennes via initialisation robuste.

- Divers
  - Améliorations des schémas d'entrée des outils MCP et des options de tri/filtrage.
  - Prise en charge explicite des variables d'environnement (MYSQL\_\*, DEEP_MEMORY_HTTP_PORT).

---

DeepMemory MCP is a small Model Context Protocol (MCP) server that provides long-term memory storage for conversational agents.

It stores memories locally in an SQLite database by default and exposes a set of MCP tools to add/search/list memories. Optionally, you can start the server using a MySQL backend via CLI flags (see examples below). The server also provides a lightweight HTTP fallback and a persistent queue to accept memory writes while the DB initializes.

## Quick overview

- Default storage: SQLite database at `~/.deepmemory/deepmemory.db`
- Optional MySQL provider: start with `--mysql` and provide `--mysql_host --mysql_id` (password optional)
- Dedicated docs storage: table `docs` for development documents, accessible via MCP tools
- Queue: `~/.deepmemory/queue.jsonl` (append-only JSONL for queued add_memory requests)
- HTTP fallback: `http://127.0.0.1:6789` (configurable via `DEEP_MEMORY_HTTP_PORT`)

## Features

- MCP tools to add/search/list/update/delete memories
- Clusters to group structured details and link memories to a subject
- MCP tools to add/search/list/update/delete development docs (`add_doc`, `search_docs`, `get_docs`, `load_all_docs`, `delete_docs`, `update_docs`)
- **End-to-end encryption with `--use-crypto`**: protect sensitive memories with RSA+AES hybrid encryption
- **Automatic key management**: RSA key pairs generated and stored in `~/.deepmemory/keys/`
- **Transparent encryption/decryption**: memories are encrypted on write and decrypted on read
- Semantic search capabilities: MCP tools `semantic_search_memory` and `semantic_search_docs` for AI-driven similarity search on memories and docs.
- Embedding management: automatic generation, storage, and persistence of embeddings for all entries.
- Schema migration: automatic addition of `embedding` columns and backfill of embeddings in existing SQLite/MySQL databases.
- Robust HTTP fallback: handles port conflicts gracefully without crashing the server.
- Optional MySQL backend via `MySQLProvider` (covers memories and docs)
- Persistent write queue while the DB initializes
- Lightweight HTTP fallback for health-checks and simple interactions
- Cross-platform (Windows / macOS / Linux)

## Installation

Requirements

- Node.js >= 18
- npm (or yarn)

Install

```powershell
git clone <repo-url>
cd DeepMemory-MCP
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

## Usage — choose provider

By default the server uses the built-in SQLite provider. To run against MySQL, pass `--mysql` and at minimum `--mysql_host` and `--mysql_id` (password is optional for servers without a password).

Examples (PowerShell):

Start with default SQLite:

```powershell
node "./dist/index.js"
```

Start with encryption enabled (RSA+AES):

```powershell
node "./dist/index.js" --use-crypto
```

Start with MySQL (no password):

```powershell
node "./dist/index.js" --mysql --mysql_host localhost --mysql_id root --mysql_db deepmemory
```

Start with MySQL and encryption:

```powershell
node "./dist/index.js" --mysql --mysql_host localhost --mysql_id root --mysql_db deepmemory --use-crypto
```

Start with MySQL (with password):

```powershell
node "./dist/index.js" --mysql --mysql_host db.example.com --mysql_id myuser --mysql_pwd mysecret --mysql_db deepmemory --mysql_port 3306
```

Environment variables supported as alternatives to flags:

- MYSQL_HOST, MYSQL_USER or MYSQL_ID, MYSQL_PASSWORD or MYSQL_PWD, MYSQL_DATABASE, MYSQL_PORT
- DEEP_MEMORY_HTTP_PORT

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

## Tools (MCP) — aperçu

Les outils principaux exposés par le serveur incluent :

- add_memory — ajoute une mémoire (content requis)
- search_memory — recherche avancée avec filtres (tags, context, importance, tri)
- get_memories — récupère les dernières mémoires
- load_all_memory — charge toutes les mémoires
- get_memory_stats — statistique de base
- update_memory / delete_memory — opérations CRUD
- create_cluster / search_clusters / get_cluster / add_cluster_detail / update_cluster / delete_cluster
- link_memory_to_cluster / unlink_memory_from_cluster / get_memories_by_cluster

Consultez les schémas d'entrée des outils (ListTools) pour les détails JSON attendus.

## HTTP fallback (quick reference)

Le serveur expose une endpoint HTTP locale pour les vérifications de santé et interactions minimales. Par défaut : `127.0.0.1:6789`. Accepte POST JSON.

Configurez le port via :

- DEEP_MEMORY_HTTP_PORT=12345

## Storage details

- Database file (SQLite): `~/.deepmemory/deepmemory.db`
- Queue file: `~/.deepmemory/queue.jsonl`
- Encryption keys (when using `--use-crypto`): `~/.deepmemory/keys/private.pem` and `~/.deepmemory/keys/public.pem`

Les fichiers sont créés automatiquement dans le répertoire home de l'utilisateur.

**Note sur le chiffrement** : les clés RSA sont générées au premier démarrage avec `--use-crypto` et réutilisées aux démarrages suivants. Conservez ces clés en sécurité : sans elles, les données chiffrées ne peuvent pas être déchiffrées.

## Environment variables

- DEEP_MEMORY_HTTP_PORT — port pour le HTTP fallback (par défaut 6789)
- MYSQL_HOST, MYSQL_USER / MYSQL_ID, MYSQL_PASSWORD / MYSQL_PWD, MYSQL_DATABASE, MYSQL_PORT

## Development & scripts

- npm run build — compile TypeScript vers `dist/`
- npm start — exécute le serveur compilé (node dist/index.js)
- npm run dev — exécute directement depuis la source (tsx)
- npm run clean — supprime `dist/`

## Troubleshooting

- Permissions d'écriture : vérifier `~/.deepmemory/` et droits sur le home.
- Si l'initialisation SQLite échoue : vérifier que la DB n'est pas verrouillée.
- Queue non traitée : le fichier `queue.jsonl` est vidé après traitement ; vérifiez les logs pour erreurs de parsing.

## Contributing

Contributions bienvenues. Workflow habituel : fork → branche → PR. Merci d'ajouter des tests pour les nouvelles fonctionnalités.

## Licence

MIT — voir `LICENSE`.

## Authors / Maintainers

- Theorhd (author)
