# Pending Tests (My Lingo v0.3)

Tests that cannot run in CI/`npm test` because they require external prerequisites.

> **已自动化**：PT-001/002/003/004/005/006/008 已实现为集成测试，无需真实 API Key。
> 运行：`npm run test:integration`（详见 [`dev_docs/11-integration-tests.md`](./dev_docs/11-integration-tests.md)）
> **仍需手动**：PT-007（依赖交互式 Claude Code 会话）

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
- **Verification status**: `[x]` **Automated** — `tests/integration/integration.test.mjs` (PT-001)

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
- **Expected result**: Attempt 1 returns `[my-lingo] API unavailable, sending original prompt.`; attempt 2 returns `[my-lingo] Circuit breaker open — API paused, sending original.`; `circuit.json` exists in `$CLAUDE_PLUGIN_DATA/my-lingo/` with `failure_count=1`
  > ⚠️ 原描述"3次失败后触发"有误：熔断器在**第1次失败后**即开启冷却窗口，详见 `dev_docs/11-integration-tests.md`。
- **Verification status**: `[x]` **Automated** — `tests/integration/integration.test.mjs` (PT-002)

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
- **Verification status**: `[x]` **Automated** — `tests/integration/integration.test.mjs` (PT-003)

---

## PT-004: -- prefix — skips optimization even with valid API key

- **Phase introduced**: Phase 5
- **Prerequisite**: `MY_LINGO_API_KEY` set and valid; My Lingo configured
- **Repro command**:
  ```bash
  export MY_LINGO_API_KEY=sk-...
  echo '{"prompt":"-- test this exact phrase please"}' | node scripts/user-prompt-submit.mjs
  ```
- **Expected result**: stdout `systemMessage` contains `[my-lingo] --:`; no API call is made; turn recorded with `mode: "raw"`; exit 0
- **Verification status**: `[x]` **Automated** — `tests/integration/integration.test.mjs` (PT-004)

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
- **Verification status**: `[x]` **Automated** — `tests/integration/integration.test.mjs` (PT-005)

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
- **Verification status**: `[x]` **Automated** — `tests/integration/integration.test.mjs` (PT-006)

---

## PT-007: setup.md — API key written to config.json with permission 0o600

- **Phase introduced**: Phase 3
- **Prerequisite**: Interactive Claude Code session; valid API key to test
- **Repro command**: Run `/my-lingo:setup` in a Claude Code session; follow the prompts; then verify:
  ```bash
  stat -c %a $CLAUDE_PLUGIN_DATA/my-lingo/config.json  # should print 600
  ```
- **Expected result**: `config.json` exists, readable only by current user (mode 600); API key NOT visible in shell history or process list; API connectivity test passes
- **Verification status**: `[ ]` **仍需手动** — 依赖交互式 Claude Code 会话，无法自动化

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
- **Verification status**: `[x]` **Automated** — `tests/integration/integration.test.mjs` (PT-008)

---

## PT-009: session-end analysis — writes corrections JSONL (with mock server)

- **Verification status**: `[x]` **Automated** — `tests/integration/integration.test.mjs` (PT-009)

---

## PT-010: session-end skips analysis for raw-only turns

- **Verification status**: `[x]` **Automated** — `tests/integration/integration.test.mjs` (PT-010)

---

## PT-011: generate-lesson.mjs — creates lesson file via mock server

- **Verification status**: `[x]` **Automated** — `tests/integration/integration.test.mjs` (PT-011)

---

## PT-012: SRS due items correctly filtered by readItemsDue

- **Verification status**: `[x]` **Automated** — `tests/integration/integration.test.mjs` (PT-012)

---

## PT-013: /my-lingo:lesson — generates and displays lesson in Claude Code session

- **Phase introduced**: v0.3 Phase 2
- **Prerequisite**: Interactive Claude Code session; API configured with model_deep
- **Repro command**: Run `/my-lingo:lesson` in a Claude Code session
- **Expected result**: Claude generates a Markdown lesson with Summary, Common Errors, Key Expressions sections; lesson file saved at `learning/{space}/lessons-YYYY-MM-DD.md`; running again same day shows existing lesson
- **Verification status**: `[ ]` **仍需手动** — 依赖交互式 Claude Code 会话 + 真实 Deep Model

---

## PT-014: /my-lingo:review — guides user through SRS review and updates state

- **Phase introduced**: v0.3 Phase 1
- **Prerequisite**: Interactive Claude Code session; some learning items recorded with due dates
- **Repro command**: Run `/my-lingo:review` in a Claude Code session with items due
- **Expected result**: Claude shows each item's native explanation, waits for user answer, gives feedback, calls updateLearningItemReview; final summary shows review count and next due dates
- **Verification status**: `[ ]` **仍需手动** — 依赖交互式 Claude Code 会话

---

## PT-015: /my-lingo:export — outputs valid Markdown to stdout

- **Phase introduced**: v0.3 Phase 4
- **Prerequisite**: Interactive Claude Code session; corrections and learning items recorded
- **Repro command**: Run `/my-lingo:export` in a Claude Code session
- **Expected result**: Valid Markdown output with sections: Common Errors, Vocabulary, Sentence Patterns, Lessons; output can be piped to a file
- **Verification status**: `[ ]` **仍需手动** — 依赖交互式 Claude Code 会话
