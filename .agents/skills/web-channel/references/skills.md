# Skill commands

`WebSkillsService` serves the skills over `IAgentSkillsPort`, provided by `AgentDefinitionsModule`.

- `skills.list` answers every skill with its roles and whether it is built-in (`listAll`).
- `skill.get { name }` answers `skill.detail { name, skill }`, the skill with its content built for the first role that reads it (`readAny`), or `skill: null` for an unknown name.
- `skill.delete { requestId, name }` deletes a custom skill (`deleteUserSkill`), broadcasts `skill.deleted { name }` to every connection and answers `skill.result { requestId, ok, error? }`; a built-in or unknown name fails.
- The web never writes skills: the user changes a custom one by asking the CEO in a conversation.
