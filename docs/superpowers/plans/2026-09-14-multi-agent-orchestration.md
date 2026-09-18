# Zero-ChatGPT Multi-Agent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and TDD task-by-task.

**Goal:** Add persistent async task tracking, completion routing, mailbox delivery, and parent resume to Zero-ChatGPT.

**Architecture:** Keep ChatGPT conversation transport unchanged. Add a separate task tree persisted under `runtime`, a completion watcher that polls worker conversation state, and a mailbox/result delivery layer that resumes the recorded parent through the existing non-blocking browser send.

**Tech Stack:** Node.js CommonJS, node:test, filesystem JSON persistence, existing BrowserBridge transport.

**Spec:** `docs/superpowers/specs/2026-09-14-multi-agent-orchestration-design.md`

## Global Constraints

- Message Parent != Agent Parent.
- Conversation DAG != Agent Task Tree.
- Do not print or persist raw credentials in task/mailbox files.
- Browser dispatch remains non-blocking.
- Every production change starts with a failing `node --test` test.
- Repository is not a Git working tree; skip commit/worktree steps.

---

### Task 1: Dispatch semantic
**Files:** Modify `test/cli-management.test.js`, `src/cli.js`.
- [ ] Change the CLI send test to require `status=DISPATCHED` and verify RED.
- [ ] Change only conversation-send output to `DISPATCHED`; verify targeted and full tests.
### Task 2: Persistent Task Registry and Mailbox
**Files:** Create `src/agents/task-registry.js`, `src/agents/mailbox.js`, tests under `test/`.
- [ ] Add failing tests for task creation, parent/root lineage, updates, list/get, and atomic persistence.
- [ ] Implement minimal registry with no auth/session fields.
- [ ] Add failing tests for idempotent mailbox enqueue/read/ack.
- [ ] Implement mailbox persistence and rerun targeted tests.

### Task 3: Agent Orchestrator
**Files:** Create `src/agents/orchestrator.js`, `test/agent-orchestrator.test.js`.
- [ ] Add failing spawn test: resolve parent turn, dispatch worker, persist RUNNING task, return immediately.
- [ ] Implement `spawnAgent` using existing `conversations.getConversation/sendConversation`.
- [ ] Add failing completion test using assistant `finished_successfully/end_turn=true` state.
- [ ] Implement `checkTask`, result extraction, mailbox event, and idempotent parent resume.
- [ ] Add tests for `sendMessage`, `status`, `result`, `list`, `wait`, and `close` primitives.

### Task 4: Watcher and CLI
**Files:** Create `src/agents/watcher.js`, `src/agent-watcher.js`; modify `src/cli.js`; add tests.
- [ ] Add failing watcher test for one scan routing completed tasks and ignoring incomplete tasks.
- [ ] Implement watcher scan/loop and single-process PID guard.
- [ ] Add failing CLI tests for `agent spawn/list/status/send/result/wait`.
- [ ] Implement CLI parser/output while preserving existing commands.
- [ ] Make spawn ensure the watcher is running after dispatch.
### Task 5: Verification
**Files:** No new production surface unless evidence requires it.
- [ ] Run all targeted agent/CLI tests.
- [ ] Run `npm test` and require a green full suite.
- [ ] Run one real worker spawn against the authorized worker room and verify returned node is the committed user node.
- [ ] Run watcher completion against the real worker and verify task becomes DONE and a mailbox event is created.
- [ ] Verify parent resume dispatches the synthetic result into the recorded parent conversation without waiting for the resumed assistant final.
- [ ] Run parallel dispatch for three tasks if enough worker conversations are available; otherwise report the exact runtime constraint and the strongest completed evidence.

## Expected lifecycle

```text
spawnAgent
  -> worker browser dispatch
  -> task RUNNING
  -> return status=DISPATCHED
watcher
  -> worker final detected
  -> task DONE
  -> SUBAGENT_RETURN mailbox event
  -> parent browser dispatch
  -> delivery recorded
```
