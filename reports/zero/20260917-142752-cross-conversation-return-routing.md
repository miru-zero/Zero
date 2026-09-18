# ZERO REPORT zero

title: cross-conversation return routing
created: 2026-09-17T07:27:52.582Z

## SOURCE
- target_conversation_id: `6aab8be7-90e4-83ec-8b12-671b84b81dc7`
- test: cross-conversation greeting / A -> B -> expected A return
- source inspected: `src/providers/chatgpt/index.js`, `agents/orchestrator.js`, `agents/watcher.js`, `agents/task-registry.js`, `agents/mailbox.js`

## FACT
- `conversation send` dispatched a cross-conversation greeting to B successfully with `status=DISPATCHED`. [J:20260917-142037-df52]
- A subsequent `conversation get` read B successfully after the dispatch; the exchange and assistant response existed in B's own conversation state. [J:20260917-142050-9984]
- The ChatGPT provider exposes separate agent routing tools including `agent_spawn`, `agent_say`, `agent_reply`, `agent_return`, and `agent_check`. [J:20260917-135230-53fe]

## ISSUE
- Plain `conversation_send` is destination-only. The source path inspected passes `conversation_id` and `message`, but no source conversation, reply route, task id, or correlation id.
- Therefore B receives the cross-conversation input as a normal USER turn and its assistant response remains in B unless another mechanism explicitly routes it elsewhere.
- Agent routing is different: the task registry records `parent_conversation_id` and `worker_conversation_id`, so `agent_reply`/`agent_return` can resolve a return destination.

## ACTUAL
```text
A --conversation_send--> B
B assistant responds inside B
no generic routing record maps B response back to A
```

## EXPECTED / INTENT
- Cross-conversation communication should support a return path so B can respond to the originating conversation A without manually knowing A's id.

## EVIDENCE
- [J:20260917-142037-df52] `chatgpt conversation send 6aab8be7-...` -> `status=DISPATCHED`
- [J:20260917-142050-9984] `chatgpt conversation get 6aab8be7-... limit 1` -> B readable after dispatch
- [J:20260917-135230-53fe] `chatgpt` -> provider tool list includes agent routing functions

## IMPACT
- Two ordinary conversations cannot currently form a bidirectional chat channel by using `conversation_send` alone.
- A receiver can answer locally but cannot infer the originating conversation from transport metadata.
- Using agent routing for casual peer conversation would work around the missing return route but introduces task lifecycle semantics (`RUNNING`, `DONE`, delivery state) that may not match normal conversation-to-conversation chat.

## SUGGESTION
- Keep `conversation_send` as a low-level one-way primitive; avoid silently changing its semantics.
- Consider a higher-level peer routing abstraction that records `from_conversation_id`, `to_conversation_id`, `reply_to_conversation_id`, and a correlation/thread id.
- Reuse the proven routing ideas from agent task metadata, but keep peer-chat lifecycle independent from worker task lifecycle.
- Also test concurrent writes/branch movement separately; the earlier handshake showed a dispatch can race with another turn, which is a different concern from return-route resolution.

## CONFIDENCE
- FACT: verified
- SUGGESTION: AI analysis

## NEXT TEST
- Reproduce A -> B with an explicit routing envelope and verify B -> A without supplying A's id manually at reply time.
- Run the same test while another message lands in B to isolate branch-race behavior from routing behavior.
