# MCP-02 — FULL TURN COACH VIEW (2026-09-19)

Source conversation: `6aacf8d7-ce38-83ec-a415-1842cd77fa39`
Project: `g-p-6aa42b84cc8c8191a58229f240d339c6`
Title: `MCP-02`

## READ COVERAGE
- Raw history fetched live through Zero: 3,556 unique messages, complete=true.
- Raw cache: `.zero/conversation-cache/6aacf8d7-ce38-83ec-a415-1842cd77fa39.history.json`
- Chronological turn map: `.zero/conversation-cache/6aacf8d7-ce38-83ec-a415-1842cd77fa39.turnmap.jsonl`
- User turns read in chronology: 53/53.
- For every user turn, visible assistant responses were read as the paired interaction.
- Raw tool/result messages remain available by message_id for rehydration; not every one of the 1,678 tool-result messages was individually expanded in this pass.

## WHY THIS FILE EXISTS
This is not a last-message summary.
It records how understanding changed, where AI made wrong conclusions, how the user corrected them, and which facts survived those corrections.
RAW remains the source of truth.

## PHASE A — inherited checkpoint → Codex evidence → protocol viewpoint
Turns 1–2 start from a compact checkpoint inherited from the previous room.
AI initially accepts RVA `0xA8F5A10–0xA8F5D4A` as authoritative candidate, then real evidence shows it is a serializer/string enum helper, not the spawn handler.
User explicitly locks the rule: evidence > memory; if state is missing, GET conversation / RAW evidence instead of guessing.
Turns 3–4 are a major mental-model correction from the user:
- Do not make UI/component/function names the goal.
- JS/UI/Codex artifacts are witnesses/bridges to the real protocol boundary.
- The desired evidence is URL + method + headers + body/payload + stream/response + resulting state.

Turns 6–15 establish the subagent identity chain:
- Model emits `collaboration.spawn_agent` as a function call in the parent response stream.
- Codex/runtime executes the tool locally; no dedicated HTTP `/spawn_agent` request was found.
- Runtime creates child `thread_id` itself; AI does not choose or need the UUID.
- AI uses logical task identity/path; runtime maps task/path → child thread UUID.
- Child gets its own model request and lineage metadata.
- Within the Codex layer: session/root, thread/conversation, and turn are distinct identities.

Important correction pattern:
Early hypotheses about a separate spawn endpoint and AI knowing child UUID were rejected by exact-version source, rollout, and runtime evidence.

## PHASE B — Web/Flora bridge → then user pulls work back to Zero
Turns 16–23 close an important Web observation:
- `GET /backend-api/flora/subagent/thread/turns` requires both `conversationId` and `threadId`.
- A real HAR later showed `conversationId=6aa...` (ChatGPT parent conversation) paired with `threadId=01a0...` (subagent thread) and HTTP 200.
- Frontend consumes `codex_collab_agent_tool_call.receiverThreadIds` and `codex_sub_agent_activity.agentThreadId`.
- UI uses child thread ID as subagent identity; UI does not invent it.

However Turn 24 is a critical correction:
User says to forget Codex and read Room 01 to recover the original Zero goal.
This exposed that the work had drifted from the intended Zero architecture.
Turn 24 re-read of Room 01 recovered the intended direction:
- Zero should expose/address real conversation/message lineage.
- Conversation/message graph and agent/task lineage are different structures.
- The user wanted actual ChatGPT Web behavior understood first, not a Codex clone.

## PHASE C — orchestration experiments and a false-success episode
Turns 26–30 show repeated interpretation drift:
- User asks for a test "not through TPP".
- AI first interprets this as normal ChatGPT transport + old Zero worker orchestration.
- A two-chat worker test passes technically.
- User immediately challenges whether this is the requested logic.
- AI correctly retracts the architecture claim: transport proof passed, architecture proof did not.

Turn 30 re-checks the repository and original multi-agent design.
This recovers an older watcher/task-registry design and exposes another issue: some message parent relationships had been inferred from array order, which is not authoritative provenance.

Turns 31–35 contain the most important false-success sequence:
- User states the goal: system can invoke subagent without Work mode.
- AI experiments with a "native" path and reports native child `01a0...` as success.
- User asks where it can be seen and then challenges the quality/seriousness of the work.
- User points out Plan/logic files were not read first.
- AI re-reads the project, recognizes it changed source before reconstructing intent, restores its experimental patch, and returns repo to baseline.
- User then clarifies acceptance: backend child creation alone is not full native-subagent success; observable Web/native integration matters as a validation signal.
- The prior "success" is downgraded to backend spawn probe only.

Coach lesson: a passing probe is not permission to redesign Zero, and a partial runtime effect is not feature success.
## PHASE D — API before UI, then another mode mistake is corrected
Turns 36–38:
- User supplies Web asset paths, but then explicitly says API should be completed first.
- AI starts an API-contract experiment.
- User catches that the test still entered Work-family behavior.
- AI recognizes that using `conversation_origin=flora` violated the target even if it could create a native child.
- Flora experiment is marked INVALID FOR TARGET.

Turn 39 is another forced re-read by the user:
"Go read this same conversation again and tell me what I actually want."
After rereading, the target becomes explicit:
Normal ChatGPT usage + native subagent capability, without switching execution into Work/TPP/Flora and without simulating native subagents as separate worker `6aa...` chats.

Turn 40 freezes Normal ChatGPT transport as the base and separates the open research problem:
`Normal ChatGPT request → ??? capability contract → native collaboration tools`.

Turns 41–45 add process discipline:
- stop spam/live probes and token waste;
- one hypothesis → one controlled test;
- user re-teaches "look at the system by USE";
- semantics/observable behavior come before implementation details;
- `conversation_send` must not silently become task/spawn/watch/return;
- `.zero_memory` becomes the continuity entrypoint and `LOGIC.md` is used to preserve mental models.

## PHASE E — direct Zero API target, HAR as protocol evidence, single ChatGPT Web architecture
Turns 46–50:
- User sends work back to testing.
- AI again drifts toward Web/UI comparison.
- User corrects the layer: Zero is a direct/browserless API/CLI target; UI is only reference/capture/validation.
- HAR/payloads are protocol evidence to be applied directly to:
  `M:\Zero_LLM\Zero-ChatGPT\src\providers\chatgpt`
- Correct chain: HAR/Payload/SSE/Headers → extract contract → compare provider → add missing API primitive → CLI/orchestrator consumes it.
Turns 51–52 sharpen the target further:
- Payload fields originating from Web UI are still protocol inputs once serialized into backend requests; do not discard them merely because UI produced them.
- Separate generic ChatGPT Web contract from Work-specific fields.
- Existing legacy `agent_spawn/return/say/reply/check/status/list` is not the target architecture.
- Target architecture is a single ChatGPT Web provider exposing conversation primitives plus native-subagent primitives based on actual backend contract.
- No Work/TPP/Flora/Codex dependency should be required by the final target.
- Do not preserve worker-conversation simulation and call it native.

Turn 53 is simply: "เริ่มทำงาน" and the assistant did not execute further work before stopping.

## AUTHORITATIVE INTENT AT END OF MCP-02
Target:
`src/providers/chatgpt` is the single ChatGPT Web protocol provider.
Normal conversation transport remains the base.
Native subagent should become an operation layer on the same provider, based on proven ChatGPT Web contract, not on legacy worker-chat simulation or Work/Codex as a separate architecture.

Evidence sources such as Codex source, UI bundles, HAR, payloads, rollout logs are witnesses/bridges.
They are used to discover protocol and semantics; they are not the architecture target.

## COACH-VIEW INVARIANTS LEARNED FROM THE JOURNEY
1. Do not equate a technically successful probe with acceptance success.
2. Do not implement before reconstructing user intent, Plan, LOGIC, and existing contracts.
3. Do not let evidence-source naming (Work/Flora/Codex/UI) redefine the target architecture.
4. Preserve source identity and semantic meaning separately; do not collapse distinct IDs/namespaces.
5. Use interaction history and correction chain, not final summary alone.
6. When the user corrects the mental model, treat prior conclusions as superseded even if their local facts remain useful.
7. UI is an observable oracle when needed, not a required Zero dependency.
8. HAR/payload/browser captures should feed protocol work in `src/providers/chatgpt`.
9. Avoid spam; offline evidence first, then one controlled live test.
10. RAW conversation remains rehydratable by message_id; this Coach View never replaces it.

## CURRENT RAW POINTERS
- Full history: `.zero/conversation-cache/6aacf8d7-ce38-83ec-a415-1842cd77fa39.history.json`
- Turn map: `.zero/conversation-cache/6aacf8d7-ce38-83ec-a415-1842cd77fa39.turnmap.jsonl`
- Source conversation id: `6aacf8d7-ce38-83ec-a415-1842cd77fa39`
