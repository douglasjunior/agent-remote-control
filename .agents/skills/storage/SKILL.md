---
name: storage
description: >
  File locking and locked JSON persistence in DATA_DIR: the storage module, IFileLockPort (lockfile with owner host
  and pid, orphan and stale takeover, in-process FIFO queue, typed timeout), ILockedFilesPort (cached reads, read-change-write
  under the lock, atomic temporary-file writes), lost updates between concurrent writers, and how every store and its
  port apply changes atomically. Use when a file is read, changed and written back, when adding or changing a store, or
  when a write races another.
---

# Storage

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes: a port signature, the lockfile format or location,
> the caching rule, the failure behaviour or the list of stores. A refactor that keeps the described behaviour leaves
> it alone.

`packages/server/src/modules/storage/` owns the only mechanism that writes data files. `StorageModule` binds and
exports `IFileLockPort` (`NodeFileLockAdapter`) and `ILockedFilesPort` (`NodeLockedFilesAdapter`); every module that
persists data imports it. Nest keeps one instance of each, so every store of the process shares one lock queue.

## Rules

- Every file that is read, changed and written back goes through `ILockedFilesPort`. A store must not keep its own
  read, parse, stringify or write code, its own promise chain or its own queue.
- A store port exposes the change, never a whole value loaded earlier: `update(id, change)` or `transaction(id, work)`,
  where `change` receives what is on disk now. A caller that loads, awaits something else and then saves loses the
  writes made in between, whatever lock the save takes.
- Keep the port in the vocabulary of its domain (`updateSession`, `transaction`); file paths and locks stay inside the
  adapter.
- `change` runs while the lock is held: it does only what the new value needs, never awaits a network call or an
  agent, and never mutates the value it receives, which is shared with later reads. It returns a new value, or
  `undefined` to write nothing.
- Read through `read()` freely: it costs one `stat` while the file is unchanged. Never cache a parsed file in a field of
  the store; `LockedFile` already holds the only cache that knows when another process changed the file.
- A store that enumerates a folder filters by its own extension: `<file>.lock` and `<file>.<uuid>.tmp` live beside the
  data files.
- A write that cannot take the lock rejects with `FileLockTimeoutError` to its caller and never leaves a lockfile or a
  temporary file behind. A caller only swallows it where the data is a convenience or will be written again, and then
  logs it at error level.

## `IFileLockPort`

`withLock<T>(lockPath, work, options?: { timeoutMs?, staleMs? }): Promise<T>` runs `work` holding the lock and
releases it in `finally`. Defaults: `timeoutMs` 15 s, `staleMs` 10 s. The timeout covers the wait in the queue and the
wait for the lockfile, and rejects with `FileLockTimeoutError { lockPath, timeoutMs }` without running `work`. Keep the
default timeout longer than the default stale age: a caller then outlasts any lockfile left behind, and only a lock
held by a live owner times it out.

- **In this process**: callers of one path queue in memory in call order (FIFO). A caller enters the queue
  synchronously when it calls, and only the head contends for the lockfile, so the disk is not polled while the lock
  is held here. A caller that times out in the queue leaves it; the head leaving hands the turn to the next.
- **Across processes**: the head creates the lockfile with `O_EXCL` (`flag: 'wx'`, mode `0o600`) holding
  `{ host, pid, token }`, and retries every 50 ms while another process holds it. Release removes the lockfile only
  while it still holds this holder's token.
- **Abandoned lockfiles**: an orphan is taken over at once, a stale one once it is older than `staleMs`. An orphan
  carries this `host` (`os.hostname()`) and either a `pid` that does not exist (`ESRCH`) or the pid of this process
  with a token outside `heldTokens`, the module-level set of the tokens this process holds: the lockfile of an earlier
  process of the same pid, as a container whose server is always pid 1 leaves when it is killed, or of a release that
  failed. A pid of another host is never probed, since it names a different process here; that lockfile, an unreadable
  payload, a reused pid and a hung owner are left to the age.
- **Takeover**: never remove a lockfile by path after judging it, since another contender may have taken it over and
  created its own in between. `takeOver` renames it to `<lockPath>.<uuid>.tmp`, which one contender alone does to one
  file, judges the moved file again, removes it when abandoned and otherwise puts it back with `link`, which fails
  when a lockfile was created at the path meanwhile (`[Lock Check Failed]`).

## `ILockedFilesPort`

- `json<T>(path, { parse, empty, serialize?, mode?, directoryMode?, lockPath? }): LockedFile<T>`: `parse` turns the
  parsed JSON into the value and handles a shape it does not expect; `empty` is the value of a missing file or of one
  that is not valid JSON (logged as `[Unreadable File]`, replaced by the next write).
- `text(path, options?): LockedFile<string | undefined>`: `undefined` while the file does not exist.
- `LockedFile<T>`: `read()` and `update(change)`. `update` creates the directories (`directoryMode`), takes
  `lockPath` (default `<path>.lock`), reads the file, applies `change`, writes the result to `<path>.<uuid>.tmp` with
  `mode` (default `0o666` less the umask), renames it over the file and resolves to the value on disk. A failed write
  removes the temporary file and leaves the file as it was.
- **Cache**: every write renames a new file into place, so inode, size and modification time (ns) identify one content.
  A copy cached from a read or a write is used only while the file on disk still has them, checked on every read and
  inside every update; any other writer's change is read and parsed again once.
- Files that change together share one `lockPath` (the skills folder uses `DATA_DIR/skills/.lock`). Never nest two
  updates on one lock path: the inner one waits for the outer one forever. Nest updates on different paths always in the
  same order.

## Stores

| Store | File in `DATA_DIR` | Atomic operation | When the lock times out |
|---|---|---|---|
| `JsonAgentSettingsStoreAdapter` | `agent-settings.json` | `update(conversationId, (own, mostRecent) => settings)` | rejects to the command |
| `JsonSessionStoreAdapter` | `sessions.json` | `updateSession(conversationId, session => session)` | rejects; the turn fails, a binding stamp is logged |
| `JsonOpenWorkStoreAdapter` | `open-work.json` | `update(work => work)`, one conversation per change | logged; the next change rewrites the conversation |
| `JsonPreferencesStoreAdapter` | `preferences.json` | `update(current => changes)` | rejects |
| `JsonArtifactStoreAdapter` | `artifacts/<id>.json` | `transaction(conversationId, work)` | rejects to the agent request |
| `FileUserSkillStoreAdapter` | `skills/<name>/SKILL.md` | `write`, `delete` under `skills/.lock` | rejects |
| `AccessTokenService` | `web/access-token` | created once in `onModuleInit` | startup fails |
| `RemoteIdentityService` | `remote/key.pem`, `remote/certificate.pem` | created once under the key's lock | `identity()` rejects |

The web conversations and the prompt history live in the SQLite database. The legacy importers of the database
module read their JSON files once, each under the lock its store wrote it with, through these ports.

Files written once under a unique name (downloaded attachments, uploads), the append-only log files and the executable
shims written through the agent module's `IFileSystemPort` are never read back and changed, so they stay outside.

## Testing

- `testing/stub-file-lock.ts`: `StubFileLock` runs the work at once, records `lockPaths` and fails the next call with
  `failNext`.
- `testing/in-memory-locked-files.fake.ts`: `InMemoryLockedFilesFake` keeps each file as text in `contents`, running
  the codecs of the store, one update per path at a time; `failNextUpdate` rejects the next one.
- `testing/node-locked-files.ts`: `createNodeLockedFiles(lock?)` gives the real adapter over the disk for store specs;
  each call stands for one process, sharing no queue with another.
- Every store spec keeps a regression test of concurrent updates that would lose data without the atomic operation,
  from one process and from two.

## Checklist

- [ ] The file goes through `ILockedFilesPort`, and the module imports `StorageModule`.
- [ ] The port takes a change applied to what is on disk, and no caller saves a value it loaded before awaiting.
- [ ] No field caches the parsed file, and no promise chain or queue serializes writes.
- [ ] The behaviour on `FileLockTimeoutError` is decided and documented for each caller.
- [ ] A spec runs concurrent updates from this process and from another and finds every change kept.
