# Zero-ChatGPT Conversation / Project Management CLI Design

Date: 2026-09-12
Status: Proposed for user review

## Goal

Extend the existing direct ChatGPT Web CLI from read-only conversation access into a small management surface for conversations and projects, while preserving the current real-session transport and evidence-first workflow.

## User-facing command surface

```text
zero conversations
zero conversation new "ข้อความแรก"
zero conversation get <conversation_id> [limit <N|A-B>] [debug]
zero conversation rename <conversation_id> "name"
zero conversation del <conversation_id>
zero conversation move <conversation_id> <project_id>
zero conversation move <conversation_id> exit

zero project new "name"
zero project rename <project_id> "name"
zero project del <project_id>
zero project conversations <project_id>
zero project conversation new <project_id> "ข้อความแรก"
```

`conversation new` and `project conversation new` require a first message in v1. Empty-room creation is not part of this design unless a real ChatGPT Web request proves a separate empty-create flow.
## Architecture

Keep the existing CLI and service layering. Do not introduce a framework or browser automation path for normal operation.

```text
src/cli.js
  -> src/conversations.js
  -> src/chatgpt-client.js
  -> chatgpt.com/backend-api/*
```

The current direct CommonJS export style remains mandatory (`exports.name = ...`).

`chatgpt-client.js` gains the minimum generic request capability needed for non-GET JSON methods and, separately, the existing/send streaming transport when conversation creation requires the real send flow. It must preserve runtime session headers, dynamic target route headers, and never log credentials.

`conversations.js` remains the domain service for the first implementation round. It will expose conversation/project operations directly rather than moving existing functions into new modules during this feature, avoiding unrelated refactoring.

## Evidence gate

No mutation endpoint, HTTP method, or request body may be guessed. Each operation must be implemented only after one of these exists:

1. an observed ChatGPT Web HAR/network request,
2. an already-proven request in the repository/runtime evidence,
3. a fresh browser-network capture produced for the operation.

Current evidence already proves project-conversation listing and project-mode send payloads; the captured send flow uses `conversation_mode.kind = gizmo_interaction` with a `gizmo_id`. The remaining rename/delete/move/project-create contracts must be captured before their production functions are written.
## Command semantics

`zero conversations` keeps the existing one-page global list behavior.

`zero project conversations <project_id>` keeps the new one-page project list behavior. It reports `Next cursor` but does not auto-page.

`zero conversation new "message"` creates a normal conversation by mirroring the real ChatGPT Web creation/send flow and returns at least `conversation_id` and `current_node` when available.

`zero project conversation new <project_id> "message"` uses the same creation/send flow with the observed project conversation mode and returns the new conversation state.

Rename operations update only the display title/name of the specified object. Delete operations target exactly the supplied ID. Move-to-project targets exactly one conversation and one destination project. `move ... exit` removes the project association and returns the conversation to outside-project scope.

All write commands must return concise machine-readable status lines, for example:

```text
status=OK
conversation_id=...
project_id=...
```

Failures preserve HTTP status and target metadata without printing token/cookie/session secrets.

## Destructive-operation verification

Implementation tests use dependency-injected fixtures first. Live mutation verification uses only disposable objects created during the same verification session:

1. create disposable project,
2. create disposable conversation,
3. rename it,
4. move it into the disposable project,
5. move it back out,
6. create a project conversation,
7. delete disposable conversations,
8. delete disposable project.
## TDD and tests

Each new command starts with a failing focused test before production code.

Required coverage includes:

- CLI parser accepts the exact command forms above and rejects malformed forms.
- Every service sends the proven method, route, headers, and JSON body.
- `project conversations` stays one-page only.
- conversation creation returns the new ID/state from the real response/stream contract.
- project conversation creation includes the proven project mode / project ID.
- rename/delete/move target the exact supplied IDs.
- `move ... exit` uses the proven outside-project contract, not a guessed null/empty value.
- 429 remains a clean `RATE_LIMITED` result.
- no raw access token, Cookie, conduit token, or observation value is printed.
- the direct CommonJS export style test stays green.

## Success criteria

The feature is complete only when:

1. every command has a proven transport contract,
2. focused RED -> GREEN evidence exists for every behavior,
3. the full local test suite passes,
4. a disposable live lifecycle passes without touching pre-existing user data,
5. no command performs hidden pagination/retry loops,
6. no credentials are hardcoded, committed, or printed.

## Non-goals

No MCP integration in this round. No browser automation as the normal transport. No session logout/revoke/rotation. No guessing undocumented write contracts merely to make tests pass.
