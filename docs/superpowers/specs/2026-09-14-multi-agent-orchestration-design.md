# Zero-ChatGPT Multi-Agent Orchestration Design

## Goal
Build first-class asynchronous agent orchestration on top of the existing ChatGPT Web Conversation Transport.

The required lifecycle is:

```text
DISPATCH -> RUNNING -> SUBAGENT_RETURN -> PARENT_RESUME
```

A worker dispatch must return after the worker user message is committed. Completion and result delivery happen independently afterward.

## Core invariants

- Message Parent is not Agent Parent.
- Conversation DAG is not Agent Task Tree.
- `parent_message_id` is never used as an agent-parent identifier.
- Worker completion is detected centrally from conversation state, not by asking the worker LLM to remember a callback.
- No credential is hardcoded, committed, or printed.
- Existing ChatGPT session continuity is preserved.
## Task Registry

Each task records:

```text
task_id
root_task_id
parent_task_id
parent_conversation_id
parent_turn_id
worker_conversation_id
dispatch_node_id
result_node_id
status
```

Root and parent task lineage are independent from all conversation message IDs.

The registry is persisted in `runtime/agent-tasks.json` using atomic replacement writes so a watcher process and CLI process share the same source of truth.

## Completion

A RUNNING task is complete when the worker conversation reports a current node that differs from `dispatch_node_id` and the current message has:

```text
role = assistant
status = finished_successfully
end_turn = true
```
## Mailbox and parent resume

Completion creates one idempotent `SUBAGENT_RETURN` event in the parent mailbox. The event contains task lineage, worker conversation ID, result node ID, completion status, and the worker result text.

Parent resume is implemented by delivering a synthetic message into `parent_conversation_id` through the existing non-blocking browser transport:

```text
[ZERO_SUBAGENT_RESULT]
task_id=...
worker_conversation_id=...
result_node=...
status=DONE

<worker result>
```

The resulting parent user-node commit is recorded as the delivery node. Result delivery must be idempotent.

## Watcher

A central watcher scans RUNNING tasks, checks worker conversation state, finalizes completed tasks, enqueues mailbox events, and resumes the correct parent. The watcher may be launched detached by `agent spawn`; only one watcher instance should be active for the registry.

## CLI

Required commands:

```text
zero agent spawn <worker_conversation_id> <task> --parent <parent_conversation_id> [--parent-task <task_id>]
zero agent list
zero agent status <task_id>
zero agent send <task_id> <message>
zero agent result <task_id>
zero agent wait <task_id>
```
`spawn` remains non-blocking and prints `status=DISPATCHED`. Parent turn ID is resolved from the parent conversation current node at spawn time when not supplied explicitly.

`wait` waits for task completion state, not for the original dispatch call.

## Success criteria

- Existing `zero conversation send` prints `status=DISPATCHED` for browser dispatch.
- Three worker spawns can return without waiting for assistant finals.
- Worker completion is detected from real conversation state.
- Results are routed to the task's recorded parent, regardless of completion order.
- Parent conversation receives a synthetic result and resumes.
- Message DAG identifiers are never reused as agent-parent identifiers.
- Targeted tests and the full Node test suite are green.
- Real runtime verification uses existing authorized session fixtures without exposing raw credentials.
