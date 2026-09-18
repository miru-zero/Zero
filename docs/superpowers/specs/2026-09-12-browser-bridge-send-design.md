# Zero-ChatGPT Browser Bridge Send Design

Date: 2026-09-12
Status: For user review
Scope: Minimal integration only

## Goal

Keep the existing CLI surface:

`zero conversation send <conversation_id> <message>`

but route only this send path through a persistent background browser runtime when required by ChatGPT web integrity/session state.

## Non-goals

- Do not rewrite conversation listing/get/rename/delete/move.
- Do not rewrite project commands.
- Do not replace the existing auth/session loaders globally.
- Do not clone or read the live Chrome Default cookie database.
- Do not replay HAR tokens or manufacture Sentinel tokens.
- Do not implement a CAPTCHA/Turnstile/Sentinel solver.
- Do not remove the existing direct HTTP transport; keep it for diagnostics.

## Runtime shape

`CLI -> conversations.sendConversation -> BrowserBridge.send -> persistent ChatGPT browser -> result`

The browser runtime owns browser-only integrity/session state. Node receives only high-level send results and conversation state, not raw challenge tokens.
## Minimal code changes

1. Add one bridge module under `src/bridge/` with direct CommonJS arrow exports only.
2. Change only the existing send dispatch so `zero conversation send` can use the bridge path.
3. Preserve the current `sendConversation()` contract and CLI output shape as much as possible.
4. Add focused tests for bridge selection, success mapping, auth-required, bridge-unavailable, and no secret leakage.

No other command is migrated in this milestone.

## Browser behavior

Normal send commands must not open a visible Chrome window or tab. A dedicated persistent browser profile is reused in the background. If authentication is missing or expired, the bridge returns `AUTH_REQUIRED`; it does not silently pop up a login window.

Interactive login is a separate explicit action for a later milestone, e.g. `zero browser login`; it is not part of the normal send path.

## Result contract

The bridge should return only non-secret state such as:

- `success`
- `conversationId`
- `previousNode`
- `currentNode`
- `status` / error category

Raw cookies, access tokens, Sentinel values, conduit tokens, and browser integrity observations must not be printed or persisted by the bridge.

## Failure behavior

- Browser runtime unavailable -> explicit bridge-unavailable error.
- Session invalid -> `AUTH_REQUIRED`.
- Conversation/send failure -> preserve real HTTP/browser error category; never synthesize success.
- No automatic fallback that fabricates tokens or replays stale HAR data.

## Style lock

All new exports follow the project rule: `exports.name = (...) => { ... };` or `exports.name = async (...) => { ... };`. No `module.exports = ...` and no export object wrappers.

## Success criteria

A real `zero conversation send` can complete through the background browser without a visible popup, preserves the target conversation, returns the new `current_node`, and leaves all unrelated Zero-ChatGPT commands unchanged.