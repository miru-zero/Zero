# ZERO REPORT zero

title: Zero system architecture improvement review
created: 2026-09-17T13:55:18+07:00

## SOURCE
- workspace: `M:\Zero_LLM\Zero-ChatGPT`
- reviewed live source: hub, provider registry, ChatGPT provider, CLI, journal/report, agent orchestrator/watcher/task-registry/mailbox, portability tests
- runtime probes: `zero tools`, `zero chatgpt`, `zero auth status`, provider startup probes, full `npm test`

## FACT
- Runtime config currently declares 4 providers: chatgpt, computeruse, desktopcommander, devtools. [J:20260917-135230-35b8]
- ChatGPT provider currently exposes 14 registered hub tools. [J:20260917-135230-53fe]
- ChatGPT auth was VALID during this review. [J:20260917-135230-bc95]
- `conversation get` successfully resolved a real ChatGPT conversation during the review. [J:20260917-134452-fe43]
- desktopcommander MCP exposed 26 tools, but cold listTools startup took about 47 seconds. [J:20260917-135415-1cc3]
- computeruse is declared but its live provider startup failed with MCP child exit code 2147516566. [J:20260917-135525-b1fb]

## ISSUE
- P0: Zero core is not provider-neutral yet. `src/hub/index.js` maps every `type=internal` provider to the ChatGPT provider, and `src/cli.js` applies ChatGPT auth/session semantics to every internal provider.
- P0: ChatGPT capabilities leak into core CLI. Search and multiple conversation/project management paths call `conversations.*` directly instead of going through the provider tool contract.
- P0: journal stores raw argv/stdout and therefore duplicates conversation text and can capture secrets; current redaction policy is absent.
- P0: report validation proves only that a journal ID exists, not that the cited record semantically supports the FACT statement.
- P0: task registry and mailbox use unlocked read-modify-write JSON files; parallel processes can overwrite each other's state.
- P1: provider registration is only config-only for MCP stdio; internal providers still require hub code changes, so the plugin abstraction is incomplete.
- P1: internal provider tools do not expose uniform input schemas, while MCP tools do; this limits machine-driven orchestration.
- P1: no first-class provenance resolver exists for `project/conversation/message` URLs; exact message rehydration currently requires raw conversation mapping inspection.
- P1: agent delivery has crash windows around send→ack/update, and fallback watcher correlation can mis-associate results if one worker conversation carries concurrent tasks.
- P1: MCP clients are cached without a dead-client restart strategy, which is acceptable for short-lived CLI but unsafe for the planned long-lived Zero MCP host.
- P1: runtime provider registry has no health state, so "declared" can be mistaken for "ready"; computeruse demonstrates the difference.
- P1: project root is not currently a Git repository, reducing safe diff/rollback capability during core refactors.
- P2: source contains mojibake in `src/cli.js`, `src/hub/index.js`, and `src/hub/mcp-stdio-client.js`; this already breaks Thai-output assertions.
- P2: `test/module-style.test.js` enforces direct `exports.x =` and rejects the current Zero module convention using an object plus `Object.assign(exports, name)`.
- P2: one interactive-menu test is stale: it says "exit with q" but feeds `9`, which is invalid with the current dynamic provider count.

## ACTUAL
```text
Full test run observed through Remote Desktop Commander:
tests 223
pass  219
fail  4

Failures:
1) auth-refresh SESSION_DEAD Thai guidance assertion — mojibake
2) executable interactive menu — stale hard-coded selection (`9`)
3) MCP tool description em-dash assertion — mojibake
4) legacy migration Thai guidance assertion — mojibake

Additional live probe:
zero computeruse -> MCP child exited code=2147516566
```

## EXPECTED / INTENT
- Zero core should know only provider lifecycle/dispatch, not ChatGPT-specific auth, routing, conversation semantics, or command grammar.
- Every capability should exist in exactly one provider contract and be callable uniformly from CLI, future MCP host, workers, and scripts.
- Provider state should distinguish configured / starting / ready / degraded / unavailable.
- Provenance should resolve a compact pointer back to the exact project, conversation, message, and optionally ancestor context.
- Agent state changes must survive parallel workers and process crashes without lost updates or duplicate returns.
- Journal/report must preserve evidence without silently duplicating secrets or private conversation bodies.

## EVIDENCE
- [J:20260917-135230-35b8] `zero tools` -> providers=4.
- [J:20260917-135230-53fe] `zero chatgpt` -> internal tools=14.
- [J:20260917-135230-bc95] `zero auth status` -> VALID.
- [J:20260917-134452-fe43] real conversation read succeeded.
- [J:20260917-135415-1cc3] desktopcommander listed 26 tools; journal duration 46975ms.
- [J:20260917-135525-b1fb] computeruse provider startup failed; journal error records MCP child exit code 2147516566.

## IMPACT
- Adding more internal providers increases coupling and risks ChatGPT assumptions leaking into unrelated plugins.
- Parallel subagents can corrupt or lose task/mailbox updates under concurrent writes.
- A valid report citation can create false confidence because existence is checked but evidence-to-claim binding is not.
- Raw journaling can turn an engineering evidence file into a secondary store of conversation content and credentials.
- Cold-spawn MCP overhead and lack of provider health/restart will become visible latency/failure once Zero becomes the central host.
- Encoding drift and stale contract tests reduce trust in the suite exactly when large refactors need it most.

## SUGGESTION
- P0.1 Provider-neutral core: introduce a provider driver/manifest registry. Each provider owns `listTools`, `callTool`, optional CLI sugar, auth strategy, health probe, and lifecycle hooks. Core dispatches only by manifest.
- P0.2 Move every ChatGPT operation currently called directly from `src/cli.js` into `src/providers/chatgpt`; CLI becomes parse -> provider dispatch -> render.
- P0.3 Add input schemas to internal tools so internal and MCP providers have one machine-readable contract.
- P0.4 Replace unlocked task/mailbox read-modify-write with a transactional state layer. Short term: cross-process lock around atomic replace. Long term: SQLite or a single serialized Zero state service.
- P0.5 Harden journal: redact token/cookie/authorization fields and allow per-tool policies (`metadata`, `redacted`, `full`, `off`). Do not duplicate full conversation bodies by default.
- P0.6 Strengthen report integrity with machine-checkable assertions, e.g. `zero report assert <command> --expect ...`, storing command hash, selected output, assertion result, and source hash.
- P1.1 Add `zero health` and provider health probes with startup latency, last error, readiness, and restart count. Fix computeruse before marking it READY.
- P1.2 Add a first-class reference tool: URL -> `{project_id, conversation_id, message_id}` -> exact node -> optional ancestor window. Make this the rehydration primitive for Rolling Working Memory.
- P1.3 Add worker-conversation leasing or enforce one RUNNING task per worker conversation unless task-scoped correlation is guaranteed.
- P1.4 Make delivery recoverable/idempotent: persist delivery intent before send, include stable event/task IDs, and on recovery inspect destination before retrying.
- P1.5 For the future long-lived MCP host, add provider process lifecycle management: reuse warm clients, detect exit, restart with backoff, and expose stderr/protocol diagnostics.
- P1.6 Validate config deeply at load time: provider type, command/module, args, env, timeout, auth strategy, and tool/driver compatibility.
- P1.7 Put the Zero root under version control before the next architecture rewrite; keep runtime secrets/state ignored.
- P2.1 Repair mojibake and add an encoding regression test plus UTF-8 editor/repository settings.
- P2.2 Update module-style enforcement to the current Zero object-module convention.
- P2.3 Fix the interactive-menu test to use `q` or derive choices dynamically instead of hard-coding `9`.
- P2.4 Add Windows-friendly structured args (`--json-file`, stdin, or `key=value`) so debugging does not depend on fragile shell JSON quoting.
- P2.5 Split the 873-line CLI into core dispatcher/rendering plus provider-owned command adapters; the core should not import ChatGPT conversation implementations.

## CONFIDENCE
- Runtime provider/auth/conversation/computeruse facts: verified by live Zero journal.
- Full test-suite result: verified by live `npm test` through Remote Desktop Commander during this review.
- Source architecture findings: verified by direct reads of the current files on MiruZero.
- Priorities and proposed architecture: AI engineering analysis based on the verified current implementation and stated Zero design goal.

## NEXT TEST
- Fix only encoding/test-contract drift first, then rerun all 223 tests and require zero failures before architecture movement.
- Add a regression proving an internal non-ChatGPT provider can load and call a tool without ChatGPT auth/session.
- Add a regression proving no ChatGPT capability is reachable from core CLI except through the provider contract.
- Run a concurrent 20-task registry/mailbox stress test from multiple Node processes and verify no lost updates.
- Add a journal redaction test using fake Authorization/Cookie/token/message secrets and assert no plaintext secret reaches journal.
- Add a reference-resolver test using the known project/conversation/message URL and verify exact message recovery.
- Add provider health smoke for chatgpt, computeruse, desktopcommander, and devtools with explicit READY/DEGRADED/UNAVAILABLE states.
