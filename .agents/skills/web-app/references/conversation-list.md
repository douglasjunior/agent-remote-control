# Conversation list

- `ConversationList` shows the conversations most recent first.
- Each row has an actions menu (an `IconButton` "Actions for <title>" over the row's right edge, shown on hover, on keyboard focus, while its menu is open and always on coarse pointers) with Rename and Archive or Unarchive, which send `conversation.rename` and `conversation.archive`.
- The list changes only with the `conversation.updated` the server broadcasts, upserted by the reducer like any other.
- Archived conversations (`archivedAt` set) leave the main list for an "Archived (n)" group at the bottom, collapsed unless the viewer opened it (`useStoredFlag`, `arc.archivedConversationsOpen`); they stay openable, and archiving the open conversation keeps it open.
- Renaming happens in place through `TitleInput` (Enter or leaving the field saves, Escape cancels without closing the drawer around it, an empty or unchanged title sends nothing), in the row and from the pencil next to the conversation title in the chat header.
- The row keeps its menu mounted while renaming, with `finalFocus` off, so closing the menu does not take the focus from the field.
