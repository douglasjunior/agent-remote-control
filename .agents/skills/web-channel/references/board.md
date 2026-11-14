# Board commands

`WebArtifactsService` serves the board of each conversation over `IArtifactsPort`, acting as `{ kind: 'user', channel: 'web' }`.

- `artifacts.list { conversationId }` answers `artifacts.list` with every artifact summary, closed ones included (no sections or history).
- `artifact.get { conversationId, id }` answers `artifact.detail` (sections and history) or an `error` for an unknown id.
- `artifact.create`, `artifact.update`, `artifact.comment` and `artifact.delete` (each with a `requestId`) answer the requester with `artifact.result { conversationId, requestId, ok, id | error }`.
  - `artifact.create` maps the switches `businessRefinement` and `technicalRefinement` to `pending` or `skipped`.
  - `artifact.update` replaces the sections it carries.
  - The artifact mutations are logged by type.
- `onModuleInit` subscribes to `IArtifactsPort.onChange` and broadcasts `artifact.updated { conversationId, artifact }` (a summary; a client showing the detail asks for it again) and `artifact.deleted` to every connection, whoever made the change, for web conversations only (`IConversationStorePort.exists`).
- `projects.list` answers the project folders of the workspace (`IWorkspacePort.listProjectFolders`), the values an artifact's project takes.
