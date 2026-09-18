# ZERO REPORT zero

title: provider skill contracts / no-guess tool usage
created: 2026-09-17T07:53:08Z

## SOURCE
- Zero CLI journal + live provider/tool discovery behavior
- scope: provider/MCP/internal-tool usage contract for AI callers

## FACT
- `zero tools` successfully exposes the configured provider registry; this is the supported discovery entrypoint observed in runtime. [J:20260917-135230-35b8]
- Calling `zero chatgpt` successfully exposes the ChatGPT provider tool list instead of requiring the caller to infer capabilities. [J:20260917-135230-53fe]
- Guessing a top-level `--help` route produced `UNKNOWN_PROVIDER`, showing that generic CLI assumptions can be wrong for Zero. [J:20260917-135304-ed7b]
- Guessing JSON argument syntax for provider calls produced `INVALID_JSON`, showing that argument shape must be discovered/validated rather than inferred. [J:20260917-142007-85dc]

## ISSUE
AI callers can currently know that a provider/tool exists yet still guess how to invoke it, what arguments mean, what lifecycle applies, and what return semantics are expected. Tool names alone are not a safe contract.

## ACTUAL
```text
AI sees provider/tool name
→ may infer command/args from prior experience
→ wrong route or wrong JSON shape can fail before the underlying tool is reached
```

## EXPECTED / INTENT
- Each provider should expose a discoverable usage skill/contract comparable to other MCP/tool integrations.
- Before invoking an unfamiliar Zero provider/tool, the AI should read that contract instead of guessing from names or habits from other CLIs.
- The contract should define discovery, command/args schema, lifecycle, return semantics, error handling, and examples.

## EVIDENCE
- [J:20260917-135230-35b8] `zero tools` → provider registry discovered successfully.
- [J:20260917-135230-53fe] `zero chatgpt` → 14 ChatGPT tools discovered successfully.
- [J:20260917-135304-ed7b] guessed `--help` → `UNKNOWN_PROVIDER`.
- [J:20260917-142007-85dc] guessed provider JSON → `INVALID_JSON`.

## IMPACT
Without a provider-specific skill/contract, different AI rooms can use the same Zero capability inconsistently, repeat avoidable invocation failures, or misunderstand one-way vs callback/task semantics.

## SUGGESTION
- Treat provider usage documentation as part of the provider interface, not optional prose.
- Add a `skill` or equivalent machine-discoverable reference for every provider, including internal providers and MCP providers.
- Require the AI workflow to discover provider → load/read provider skill → inspect tool schema → invoke.
- Keep tool names descriptive, but never use the name itself as the authoritative usage contract.
- Put lifecycle semantics in the skill: one-way send, request/reply, task ownership, callback/return, polling/watcher behavior, and completion rules.
- Keep examples executable and generated from the current schema where possible so docs do not drift from code.
- Preserve the Zero rule: trust source/runtime evidence over inferred behavior.

## CONFIDENCE
- FACT: verified from journaled runtime calls.
- SUGGESTION: design requirement / AI analysis.

## NEXT TEST
- Prototype one provider skill (ChatGPT) and run the same unfamiliar-tool task with and without the skill; compare wrong-route/wrong-args behavior.
