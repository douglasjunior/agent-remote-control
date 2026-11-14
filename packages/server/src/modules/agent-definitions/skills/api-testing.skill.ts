import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const API_TESTING_SKILL: AgentSkillDefinition = {
  name: 'api-testing',
  description: 'Testing an HTTP API or backend service in practice - calling its endpoints with Playwright request contexts or curl, checking status codes, bodies, validation, authorization and persisted effects. Read before testing any backend, API or service.',
  roles: ['QA'],
  buildContent: () => `# Testing an HTTP API

## Tools
- \`curl -sS -i\` for single calls (status line and headers included), \`jq\` to read JSON bodies.
- For flows of several calls, a throwaway Playwright spec in your temporary folder using the \`request\` fixture (\`await request.post('/orders', { data })\`, then \`expect(response.status()).toBe(201)\`), run with \`npx -y playwright@latest test <temp-folder>\`. It needs no browser.
- The API contract, when the project has one (OpenAPI file, route definitions, DTOs and validators), tells you each endpoint, its inputs and its responses.

## What to Cover for Each Endpoint the Task Touches
- The success path with the exact status code and body shape the task expects.
- Validation: missing, empty, wrong-typed, too long and boundary values; the response must be a 4xx with a useful message, never a 5xx.
- Authentication and authorization: without credentials, with credentials of a user who must not have access, and access to another user's resources.
- Effects: read back what a write created or changed (a follow-up GET, or the database through the project's own tooling) and that nothing else changed.
- Idempotency and errors the task mentions: repeated requests, conflicts, not found.
- The server log during the tests: stack traces and errors are findings even behind a correct response.

## Evidence
- For each test, record the request (method, path, relevant body) and the response (status and the relevant part of the body) in the report. Never record tokens, passwords or other secrets; write \`<redacted>\`.`,
};
