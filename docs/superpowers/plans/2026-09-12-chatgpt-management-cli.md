# ChatGPT Management CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the proven subset of Zero-ChatGPT conversation/project management commands first, then gate unproven mutations behind evidence.

**Architecture:** Keep `src/cli.js -> src/conversations.js -> src/chatgpt-client.js`. `chatgpt-client` provides GET/JSON mutation/SSE text transport, while `conversations.js` owns route-specific contracts. No hidden pagination, retries, or credential logging.

**Tech Stack:** Node.js 22, CommonJS direct `exports.*`, `node:test`, ChatGPT Web `backend-api` transport.

**Spec:** `docs/superpowers/specs/2026-09-12-chatgpt-management-cli-design.md`

## Global Constraints

- Preserve real session continuity; no logout/revoke/clear.
- Never print or commit accessToken/Cookie/session secrets.
- Mutation routes/bodies require observed evidence; do not guess.
- Direct CommonJS exports only: `exports.name = ...`.
- Live destructive tests use only disposable objects created by the same test flow.
- Repo has no `.git`; verification checkpoints replace commit steps.

---
### Task 1: Restore and verify mutation transport

**Files:**
- Modify: `src/chatgpt-client.js`
- Modify: `src/conversations.js`
- Test: `test/management-mutations.test.js`
- Test: `test/conversation-create.test.js`

**Interfaces:**
- `requestJson(target, token, headers, {method, body, route, headers})`
- `requestText(target, token, headers, {method, body, route, headers})`
- `renameConversation`, `deleteConversation`, `createProject`, `renameProject`, `deleteProject`
- `createConversation({message, projectId?, ...})`

- [ ] Run focused tests and capture current RED state.
- [ ] Complete the truncated `createConversation` implementation only from proven send-flow evidence.
- [ ] Keep move-to-project disabled if its body cannot be evidenced.
- [ ] Run focused tests until GREEN.

### Task 2: CLI dispatch for proven operations

**Files:**
- Modify: `src/cli.js`
- Test: `test/cli-management.test.js`

- [ ] Add exact parser forms for proven commands.
- [ ] Return concise `status=OK` and object IDs.
- [ ] Reject unsupported/unproven management forms with usage instead of guessing.
- [ ] Run focused CLI tests until GREEN.
### Task 3: Verification and live disposable lifecycle

**Files:**
- Test: full `test/*.test.js` suite
- Runtime: existing `runtime/auth-context.json` and `runtime/session-context.json`

- [ ] Run `node --check` on modified source files.
- [ ] Run the full local test suite and require zero failures.
- [ ] Live-test non-destructive reads once.
- [ ] If create+cleanup contracts are all proven, create a disposable project/conversation and verify rename/delete lifecycle.
- [ ] If cleanup cannot be guaranteed, stop before creating live disposable data and report the exact evidence gap.
- [ ] Do not live-test move until its exact membership mutation contract is proven.

### Evidence currently accepted

- Conversation rename: `PATCH /backend-api/conversation/{id}` with `{title}`.
- Conversation delete: same PATCH route with `{is_visible:false}`.
- Project create: `POST /backend-api/projects` with `{name,instructions,memory_scope}`.
- Project rename: `PATCH /backend-api/projects/{id}` with full flat `{name,instructions,emoji,theme}` after fetching current project metadata.
- Project delete: `DELETE /backend-api/gizmos/{id}`.
- Project conversation list: one page from `/backend-api/gizmos/{id}/conversations`.
- Move membership remains gated until exact write body is proven.
