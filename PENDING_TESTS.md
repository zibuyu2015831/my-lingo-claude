# Pending Tests (My Lingo v0.1)

Tests that cannot run in CI/`npm test` because they require external prerequisites.

---

## PT-001: API call success — execution_prompt_en parses correctly

- **Phase introduced**: Phase 2
- **Prerequisite**: `MY_LINGO_API_KEY` environment variable set; reachable OpenAI-compatible API endpoint
- **Repro command**:
  ```bash
  export MY_LINGO_API_KEY=sk-...
  echo '{"prompt":"检查这个代码有没有架构问题"}' | node scripts/user-prompt-submit.mjs
  ```
- **Expected result**: stdout JSON contains `additionalContext` field with `CANONICAL REQUEST` prefix and `execution_prompt_en` as an English sentence; `systemMessage` shows `[my-lingo] non-english→en (XXXms): ...`
- **Verification status**: `[ ]` Pending

---

## PT-002: Circuit breaker — 3 consecutive failures trigger open state

- **Phase introduced**: Phase 2
- **Prerequisite**: API key configured but pointing to an unreachable URL, or invalid key that causes errors
- **Repro command**:
  ```bash
  # Set a bad URL to force 3 failures
  export MY_LINGO_API_KEY=sk-fake
  for i in 1 2 3 4; do
    echo "{\"prompt\":\"请帮我检查这段代码有没有问题\"}" | node scripts/user-prompt-submit.mjs
    echo "--- attempt $i ---"
  done
  ```
- **Expected result**: Attempts 1–3 return `[my-lingo] API unavailable, sending original prompt.`; attempt 4 returns `[my-lingo] Circuit breaker open — API paused, sending original.`; `circuit.json` exists in `$CLAUDE_PLUGIN_DATA/my-lingo/`
- **Verification status**: `[ ]` Pending

---

## PT-003: Circuit breaker reset — API success clears circuit.json

- **Phase introduced**: Phase 2
- **Prerequisite**: API key and endpoint valid; `circuit.json` exists from PT-002
- **Repro command**:
  ```bash
  export MY_LINGO_API_KEY=sk-valid-key
  echo '{"prompt":"Review this code for potential issues"}' | node scripts/user-prompt-submit.mjs
  ls $CLAUDE_PLUGIN_DATA/my-lingo/circuit.json 2>/dev/null && echo "still exists" || echo "deleted (OK)"
  ```
- **Expected result**: On successful API response, `circuit.json` is deleted; subsequent prompts do not show circuit-open message
- **Verification status**: `[ ]` Pending

---

## PT-004: !raw prefix — skips optimization even with valid API key

- **Phase introduced**: Phase 5
- **Prerequisite**: `MY_LINGO_API_KEY` set and valid; My Lingo configured
- **Repro command**:
  ```bash
  export MY_LINGO_API_KEY=sk-...
  echo '{"prompt":"!raw test this exact phrase please"}' | node scripts/user-prompt-submit.mjs
  ```
- **Expected result**: stdout `systemMessage` contains `[my-lingo] !raw:` and the literal text `!raw`; no API call is made; turn recorded with `mode: "raw"`; exit 0
- **Verification status**: `[ ]` Pending

---

## PT-005: :: prefix — refine path calls API and returns refined prompt

- **Phase introduced**: Phase 5
- **Prerequisite**: `MY_LINGO_API_KEY` set and valid
- **Repro command**:
  ```bash
  export MY_LINGO_API_KEY=sk-...
  echo '{"prompt":":: make tests not slow"}' | node scripts/user-prompt-submit.mjs
  ```
- **Expected result**: stdout JSON contains `additionalContext` with `IMPORTANT: The user used :: to request prompt refinement`; `execution_prompt_en` is a precise, well-formed English prompt; exit 0
- **Verification status**: `[ ]` Pending

---

## PT-006: SessionEnd hook — outputs stats to stderr after session

- **Phase introduced**: Phase 5
- **Prerequisite**: At least one turn recorded for today in `$CLAUDE_PLUGIN_DATA/my-lingo/turns/YYYY-MM-DD.jsonl`
- **Repro command**:
  ```bash
  # First write a turn manually or via hook, then:
  node scripts/session-end.mjs 2>&1
  ```
- **Expected result**: stderr contains `[my-lingo] Session: N prompts | M optimized (...)` format; exit 0; no stdout output
- **Verification status**: `[ ]` Pending

---

## PT-007: setup.md — API key written to config.json with permission 0o600

- **Phase introduced**: Phase 3
- **Prerequisite**: Interactive Claude Code session; valid API key to test
- **Repro command**: Run `/my-lingo:setup` in a Claude Code session; follow the prompts; then verify:
  ```bash
  stat -c %a $CLAUDE_PLUGIN_DATA/my-lingo/config.json  # should print 600
  ```
- **Expected result**: `config.json` exists, readable only by current user (mode 600); API key NOT visible in shell history or process list; API connectivity test passes
- **Verification status**: `[ ]` Pending

---

## PT-008: authentication_error — systemMessage shows warning

- **Phase introduced**: Phase 2
- **Prerequisite**: API key configured but invalid (triggers `authentication_error` from the API)
- **Repro command**:
  ```bash
  export MY_LINGO_API_KEY=sk-invalid-key
  echo '{"prompt":"请帮我检查这段代码有没有问题"}' | node scripts/user-prompt-submit.mjs
  ```
- **Expected result**: stdout `systemMessage` includes `[my-lingo] Authentication failed. Check your API key with /my-lingo:setup.`; exit 0
- **Verification status**: `[ ]` Pending
