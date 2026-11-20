---
name: database
description: >
  SQLite persistence in DATA_DIR/arc.sqlite with TypeORM and better-sqlite3: the database module, versioned migrations
  run on boot, entities owned by the module whose data they hold, store adapters that implement their ports with
  atomic statements or the synchronous read-change-write transactions of SqliteTransactionService, the legacy JSON
  importers that move the JSON stores of earlier versions into the database once, and specs over an in-memory
  database. Use when adding a table, entity, migration, SQLite store, transaction or legacy importer.
---

# Database

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes: the connection options, the migration or entity
> conventions, the importer contract and lifecycle, the list of stores or the testing helpers. A refactor that keeps
> the described behaviour leaves it alone.

`packages/server/src/modules/database/` opens the one database of the server and imports the JSON files earlier
versions left in `DATA_DIR`. Every module whose adapters read or write the database imports `DatabaseModule`.

## Connection

- `DatabaseModule` configures `TypeOrmModule.forRootAsync` with `type: 'better-sqlite3'`, the file
  `DATA_DIR/arc.sqlite` (from `DataDirectoryService`), `enableWAL: true`, `synchronize: false` and
  `migrationsRun: true`. TypeORM turns `foreign_keys` on. The module exports `TypeOrmModule`, so adapters inject
  `DataSource` by its class.
- Entities and migrations are classes listed in `constants/database-schema.constant.ts` (`DATABASE_ENTITIES`,
  `DATABASE_MIGRATIONS`). Never configure them with globs: the server runs as ESM from the `nest build` output and from
  source under Rstest, and a glob resolves the same files in neither.
- better-sqlite3 is a native module. `pnpm-workspace.yaml` allows its install script (`allowBuilds`), which downloads
  the prebuilt binary for the platform and Node ABI; without it the install fails.
- TypeORM runs every query of the process on one synchronous connection. Other processes on the same `DATA_DIR` share
  the file through SQLite's own locking.

## Migrations

- One class per schema change in `migrations/<timestamp>-<name>.migration.ts`, named `<PascalName><timestamp>`, with a
  `name` field equal to the class name, raw SQL in `up` and its exact inverse in `down`. Append it to
  `DATABASE_MIGRATIONS`.
- A released migration is never edited: a later change is a new migration.
- The migrations create exactly the schema the entities describe; the module spec runs TypeORM's schema builder over
  the migrated database and expects no pending query. Write the entity first, take the SQL from
  `dataSource.driver.createSchemaBuilder().log()` over an empty in-memory database, and name every index and foreign
  key in the entity (`@Index('IDX_<table>_<columns>')`, `foreignKeyConstraintName: 'FK_<table>_<target>'`) so the
  migration does not carry generated names.
- A column added to a table that other tables reference with `ON DELETE CASCADE` is added with `ALTER TABLE … ADD COLUMN`,
  never through the rebuild the schema builder logs: dropping the old table would delete the referencing rows.
- Times are ISO-8601 `text` columns and JSON documents are `text`, so values round-trip exactly as the protocol
  carries them.

## Entities

- An entity lives in `entities/<name>.entity.ts` of the module that owns the data (`web/entities/`,
  `settings/entities/`, `orchestrator/entities/`, `artifacts/entities/`), and only that module's adapters use it. Ports and use cases keep their domain types; the adapter maps rows to them.
- The database module owns `LegacyImportEntity` (`legacy_import`) only.

## Store adapters

- A store adapter implements the port of its module unchanged, is named `Sqlite<Name>Adapter`, injects `DataSource`
  and takes repositories with `getRepository`.
- A change that must be atomic is one statement (`INSERT … ON CONFLICT … DO UPDATE … RETURNING`,
  `INSERT … SELECT … WHERE`), or several run by `SqliteTransactionService` (below), so no other call of this process
  nor another process interleaves with it.
- Never open a TypeORM transaction (`dataSource.transaction`, a query runner) while the server serves requests. Its
  queries are asynchronous on the shared connection, so a transaction opened while another is open nests as a savepoint
  inside it and any query made meanwhile joins it. Only the legacy import runs one, on boot, before anything else uses
  the database.

## Transactions (`SqliteTransactionService`)

`DatabaseModule` exports `SqliteTransactionService`, which the stores of the other modules inject as a concrete
infrastructure class (it has no port). `run(work)` runs `work(statements)` in one better-sqlite3
transaction on the connection TypeORM holds, commits and returns its result, or rolls back and rethrows when it throws.

- `work` is synchronous, like the `change` callbacks of the store ports (`update(change)`, `transaction(id, work)`):
  better-sqlite3 executes each statement on the spot, so no other query of this process reaches the connection until
  `work` returns, and a TypeORM query issued meanwhile runs after the commit. A `work` that returns a promise is refused
  and rolled back.
- The transaction begins `IMMEDIATE`: it takes SQLite's write lock before its first read, so another process on the
  same file waits for it (busy timeout 5 s), so none writes between that read and the write.
- `statements` offers `get<T>(sql, ...params)` (first row or `undefined`), `all<T>(sql, ...params)` and
  `run(sql, ...params)` (rows changed), with `?` placeholders and the raw column names; statements are prepared once and
  reused.
- A store adapter calls it inside an `async` method, so a throw reaches its caller as a rejection, and keeps the read,
  the call to `change` and the write in the same `work`.
- A read with no write after it is a plain TypeORM query.
- A row read back is validated with the protocol schema of its document; one that does not parse is left out and
  logged.
- An adapter keeps the failure behaviour its port documents (the prompt history logs a failed append and leaves the
  prompt out).

| Adapter | Tables |
|---|---|
| `SqliteConversationStoreAdapter` (web) | `conversation`, `conversation_entry` (position from 0 per conversation, payload is the entry) |
| `SqlitePromptHistoryAdapter` (web) | `prompt_history` (greater id is more recent, capped at `MAX_PROMPT_HISTORY`) |
| `SqliteSettingsStoreAdapter` (settings) | `setting` (key, value as JSON); `save` upserts and deletes in one `SqliteTransactionService.run` |
| `SqlitePreferencesStoreAdapter` (orchestrator) | `preferences`, one row with id 1; `update(change)` reads, changes and writes in one `SqliteTransactionService.run` |
| `SqliteAgentSettingsStoreAdapter` (orchestrator) | `agent_settings` (one row per conversation, with the applied squad), `agent_profile` (one row per conversation and role); `load` and `loadMostRecent` read the settings row and its profiles in one `SqliteTransactionService.run`; `update(id, change)` reads the conversation's and the most recent settings, changes and replaces the conversation's rows in one `SqliteTransactionService.run` |
| `SqliteSquadStoreAdapter` (orchestrator) | `squad`, `squad_profile` (one row per squad and role); `save` checks the id and the name in any letter case, keeps one default and replaces the squad's rows in one `SqliteTransactionService.run` |
| `SqliteArtifactStoreAdapter` (artifacts) | `artifact` (one row per conversation and id, with the holder and the board `position`), `artifact_refinement` (one row per kind; a kind without a row takes its `DEFAULT_REFINEMENT_STATES` entry, `skipped` for `design` and owed for the others, and a row of an unknown kind is ignored), `artifact_section`, `artifact_dependency`, `artifact_pull_request`, `artifact_history` (lists by position), `artifact_history_change` (by event position), `artifact_counter` (last number per id prefix); every child table cascades from its artifact, and `parent_id`/`depends_on_id` are not foreign keys. `transaction(id, work)` reads the board, runs `work` on a copy and writes only the rows that differ in one `SqliteTransactionService.run` |
| `SqliteSessionStoreAdapter` (orchestrator) | `session` (one row per conversation, kept while it has no bindings), `agent_session` (one row per binding, by position; `unanswered` is `1` or `NULL`); `updateSession(id, change)` reads, changes and replaces the conversation's rows in one `SqliteTransactionService.run` |
| `SqliteOpenWorkStoreAdapter` (orchestrator) | `open_work` (one row per record, by position in its conversation; `questions` and `updates` as JSON, `updates` `NULL` while there are none, validated with `openWorkSchema` on read); `update(change)` reads every conversation, changes and rewrites only the conversations whose records changed in one `SqliteTransactionService.run` |

## Legacy JSON import

- `LegacyJsonImportService` runs in `onModuleInit` of `DatabaseModule`. Nest runs module init hooks deepest import
  first, so it finishes before the hooks of every module that imports `DatabaseModule` and before the server listens.
- An importer implements `ILegacyJsonImporterPort` (`name`, `read()`), lives in `adapters/json-<name>-importer.adapter.ts`
  of the module that owns the data, and is listed in `LEGACY_JSON_IMPORTERS` in `database.module.ts`, which binds the
  list, in its order, to the `ILegacyJsonImporterPort` symbol. The importers are listed centrally here, not in their
  owner modules, because the import must finish before the `onModuleInit` of the feature modules (restoring open work,
  releasing stale assignments), which read the tables the importers fill, and so that `migrate:legacy` boots only
  `ConfigModule` and `DatabaseModule`.
- `read()` reads through `LegacyJsonFilesService` and changes nothing. `read(path, schema)` takes the lock the JSON
  store wrote the file under (`<file>.lock`), so a process of an earlier version finishes its write first, and returns
  `undefined` for a missing file or one that does not match the schema (logged as `legacy_file_skipped`). `list(directory)`
  gives the `.json` files of a folder store. `read()` returns the `files` it parsed (paths relative to `DATA_DIR`),
  the `counts` by kind and `write(manager)`.
- For each importer not recorded in `legacy_import`: `read()`, then one transaction that runs `write` and inserts the
  record, then the files move to `DATA_DIR/legacy-json-backup/<timestamp>/` keeping their relative paths, and a
  `[Legacy Import]` summary is logged. An importer that throws (lock timeout, I/O, constraint) rolls back, is logged
  as `legacy_import_failed` and runs again on the next boot; boot goes on. Files that did not parse stay in place.
- `write` inserts at most 500 rows per statement, under SQLite's limit of bound parameters.
- An importer's `name` never changes once released: it is what keeps it from running twice.
- `pnpm migrate:legacy` (`src/migrate-legacy.ts`, `ConfigModule` and `DatabaseModule` only) runs the same import
  without starting the server; the Docker image runs it with `node packages/server/dist/migrate-legacy`.

| Importer | Files | Notes |
|---|---|---|
| `web-conversations` | `web/conversations.json`, `web/history/<id>.json` | ids must be file names (`[\w-]+`); one entry per id at its first place, latest version; histories of no listed conversation are logged and left |
| `web-prompt-history` | `web/prompt-history.json` | most recent first, capped at `MAX_PROMPT_HISTORY` |
| `preferences` | `preferences.json` | a field of another type is left out; a row already in the database is kept |
| `agent-settings` | `agent-settings.json` | a flat entry of the earliest format gives its profile to every role of `IAgentRegistryPort.listRoles()` (so `DatabaseModule` imports `AgentDefinitionsModule`); profiles without a text `agentId` and entries left without profiles are dropped; a conversation already in the database is kept |
| `artifacts` | `artifacts/<encodeURIComponent(conversationId)>.json` | validated with the protocol's `artifactDetailSchema` (counters default to none, and a refinement kind the file lacks takes its `DEFAULT_REFINEMENT_STATES` entry, so `design` imports as `skipped`); an id listed twice keeps its first place and its last content; a conversation with artifacts or counters in the database is kept |
| `sessions` | `sessions.json` | the map by conversation or the earlier array of items keyed by `conversationId` or `channelId:threadId` (the later item wins); agent sessions without a text `agentId` are dropped, a missing `projectName`/`artifactId` is `null`, a field of another type is left out; a conversation already in the database is kept |
| `open-work` | `open-work.json` | the records of each conversation by its id; a record that does not match `openWorkSchema` is logged (`legacy_record_skipped`) and dropped; a conversation already in the database is kept |

### Adding a store and its importer

1. Write the entity in the owner module, add it to `DATABASE_ENTITIES`, and add the migration (see Migrations).
2. Write the `Sqlite<Name>Adapter` for the existing port and bind it in the owner module, which imports `DatabaseModule`.
3. Write the importer adapter mirroring the JSON store's file layout and zod schema exactly, and add it to
   `LEGACY_JSON_IMPORTERS`.
4. Delete the JSON adapter and its spec, and update the tables of this document.

## Testing

- `testing/in-memory-data-source.ts`: `createInMemoryDataSource()` opens `:memory:` with every migration run. It is
  real SQLite, local like a temporary directory: never `rs.mock` TypeORM or better-sqlite3. Destroy it in `afterEach`.
- Adapter specs build the adapter over the in-memory data source and assert through the port and through SQL.
- Importer specs write the JSON fixtures in a temporary directory, build `LegacyJsonFilesService` over it, run
  `read()` and `write` in a transaction, and assert through the store adapter.
- A spec that compiles a module importing `DatabaseModule`, directly or through another module, points `DATA_DIR` at
  a temporary directory (`useTemporaryDataDir()` from `test/temporary-data-dir.ts`), since compiling opens the file,
  and closes the module at the end.

## Checklist

- [ ] Entity in the owner module, listed in `DATABASE_ENTITIES`; migration appended to `DATABASE_MIGRATIONS` with a
      working `down`.
- [ ] The schema builder finds nothing pending over the migrated database.
- [ ] Request-time changes are single statements or one `SqliteTransactionService.run`; no TypeORM transaction
      outside the boot import.
- [ ] The importer reads through `LegacyJsonFilesService`, keeps its released `name` and is listed in
      `LEGACY_JSON_IMPORTERS`.
- [ ] Specs run over `createInMemoryDataSource()` and temporary directories, with no `rs.mock` of the database.
