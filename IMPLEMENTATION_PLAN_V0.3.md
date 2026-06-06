# My Lingo v0.3 — Implementation Plan

> **前提**：v0.2 已完成（`npm test` ≥ 130 通过，`npm run test:integration` ≥ 9 通过，
> corrections JSONL 已积累真实数据）。
>
> **本文档结构**：
> - **〔启动入口〕** — 给**操作者**使用，复制 `/goal` 指令文本到 Claude Code 命令行。
> - **〔决策原则〕～〔八〕** — 给**实施中的 Claude** 读取，完整的规格书与约束体系。

---

## 〔启动入口〕/goal 指令文本（复制粘贴到 Claude Code 的 /goal 命令）

```
Read IMPLEMENTATION_PLAN_V0.3.md in the project root and implement My Lingo v0.3
as specified. Consult dev_docs/ for design context. Work Phase 1 → 4 in sequence.
v0.1 and v0.2 are already complete. Do NOT break any existing passing tests.

── PHASE DISCIPLINE (repeat for EVERY phase) ──────────────────────────────────
After completing each phase:
  1. Run npm test — fix any failures before proceeding.
  2. Run npm run test:integration — fix any failures before proceeding.
  3. Review code for bugs, naming consistency, and adherence to §决策原则.
  4. New deferred tests go to PENDING_TESTS.md; automatable tests must be
     implemented inline.
  5. Create a git commit per phase with a short descriptive message.
────────────────────────────────────────────────────────────────────────────────

DONE when ALL of the following hold:

1. npm test exits 0 — all unit tests pass (must be ≥ 160, up from ≥ 130)

2. npm run test:integration exits 0 — all integration tests pass (must be ≥ 11,
   up from ≥ 9, including PT-011 and PT-012)

3. These files exist and are non-empty:
   scripts/lib/srs.mjs
   scripts/lib/lesson.mjs
   scripts/generate-lesson.mjs
   commands/my-lingo/lesson.md
   commands/my-lingo/vocab.md
   commands/my-lingo/sentences.md
   commands/my-lingo/profile.md
   commands/my-lingo/review.md
   commands/my-lingo/export.md
   tests/srs.test.mjs
   tests/lesson.test.mjs

4. SRS functions accessible:
   node -e "import('./scripts/lib/srs.mjs').then(m => {
     console.log(typeof m.computeNextReview)
     console.log(typeof m.getItemsDue)
   })"
   → each line prints "function"

5. Storage SRS functions accessible:
   node -e "import('./scripts/lib/storage.mjs').then(m => {
     console.log(typeof m.updateLearningItemReview)
     console.log(typeof m.readItemsDue)
     console.log(typeof m.listItemMonths)
   })"
   → each line prints "function"

6. lesson.mjs accessible:
   node -e "import('./scripts/lib/lesson.mjs').then(m => {
     console.log(typeof m.buildLessonMessages)
     console.log(typeof m.parseLessonResponse)
   })"
   → each line prints "function"

7. PT-011 integration test passes (lesson content generated via mock server)
8. PT-012 integration test passes (SRS review items due — pure storage unit test)

9. package.json has no "dependencies" key (zero npm packages — unchanged)

10. git log shows one commit per phase (Phase 1–4) with clear messages.

HARD CONSTRAINTS — never violate:
- srs.mjs: computeNextReview is a pure function (no I/O, testable without temp dir)
- lesson.mjs: parseLessonResponse is a pure function (same pattern as parseAnalysisResponse)
- lesson.md calls deep model via lesson.mjs, NOT directly in the markdown workflow
  (lesson.mjs must be independently testable)
- updateLearningItemReview rewrites items-YYYY-MM.jsonl atomically:
  read all → modify matching item → writeFileSync (not appendFileSync)
- export.md generates valid Markdown (not JSON); output to stdout which Claude captures
- All new integration tests use makeTmpDir() / cleanup() isolation
- CLAUDE_PLUGIN_DATA read at call-time, never cached at module level
```

---

## 一·决策原则

- **D1 冲突裁决**：`IMPLEMENTATION_PLAN_V0.3.md` > `IMPLEMENTATION_PLAN_V0.2.md` > `dev_docs/` > 自行判断。
- **D2 SRS 算法简化**：v0.3 使用固定间隔（1 → 3 → 7 → 14 → 30 天），不实现完整 SM-2。`computeNextReview(reviewCount)` 纯函数，不依赖历史时间。
- **D3 lesson.md 调用方式**：lesson.md 是 markdown workflow，通过 `Bash` 工具调用 `node scripts/generate-lesson.mjs` 脚本（新增，不是 lib 文件）。脚本内部调用 `lesson.mjs` 和 `analysis.mjs` 的 callDeepModel，避免 Claude markdown 中嵌入复杂逻辑。
- **D4 updateLearningItemReview 原子性**：读取整个 JSONL 文件 → 修改对应 item → 整体写回（替换文件）。文件大时有性能代价，但 v0.3 数据量预计 < 1000 条，可接受。
- **D5 export 输出**：`/my-lingo:export` 输出 Markdown 到 stdout（Claude 将其呈现给用户）。不写文件，用户可 pipe 到文件（`> output.md`）。
- **D6 profile 数据来源**：`/my-lingo:profile` 读取 corrections（30 天）+ turns（30 天）+ learning items，构建统计摘要，然后可选调用 deep model 生成"下阶段建议"。
- **D7 lesson 冷却**：同一天内运行两次 `/my-lingo:lesson` 不应重复生成，应提示已有今日课程并展示。课程存储在 `learning/{space}/lessons-YYYY-MM-DD.md`。
- **D8 review 命令**：`/my-lingo:review` 读取 `getItemsDue()` 的结果，逐一展示，由 Claude 引导用户回答（native_language 描述 → 用户回答 target_text → Claude 评分），每次回答后调用 `updateLearningItemReview` 更新 `review_count` 和 `next_review`。

---

## 二、功能范围（v0.3 新增）

| 功能 | 实现方式 | 阶段 |
|------|---------|------|
| 简化 SRS 系统（间隔计算） | scripts/lib/srs.mjs | Phase 1 |
| learning_items 复习状态更新 | storage.mjs 扩展 | Phase 1 |
| 词汇提取与展示 | commands/my-lingo/vocab.md | Phase 1 |
| 句型提取与展示 | commands/my-lingo/sentences.md | Phase 1 |
| 今日复习（SRS 驱动） | commands/my-lingo/review.md | Phase 1 |
| 按需课程生成 | scripts/lib/lesson.mjs + scripts/generate-lesson.mjs | Phase 2 |
| `/my-lingo:lesson` | commands/my-lingo/lesson.md | Phase 2 |
| 语言画像 | commands/my-lingo/profile.md | Phase 3 |
| 学习材料导出 | commands/my-lingo/export.md | Phase 4 |
| 测试 | tests/srs.test.mjs + 集成测试扩展 | 各阶段 |

---

## 三、目录结构变化

```diff
 scripts/
   lib/
+    srs.mjs               # SRS 间隔计算（纯函数，无 I/O）
+    lesson.mjs            # 课程 messages 构建 + 响应解析（纯函数）
     storage.mjs           # 新增 updateLearningItemReview / readItemsDue

+  generate-lesson.mjs     # 课程生成脚本（lesson.md 通过 Bash 调用）

 commands/my-lingo/
+  lesson.md
+  vocab.md
+  sentences.md
+  profile.md
+  review.md
+  export.md

 tests/
+  srs.test.mjs            # computeNextReview / getItemsDue 纯函数测试
   integration/
     integration.test.mjs  # 新增 PT-011 / PT-012
```

---

## 四、Phase 1 — SRS 系统与词汇命令

### 4.1 scripts/lib/srs.mjs

```javascript
// 根据已完成的复习次数计算下次复习时间（纯函数，返回 Date）
export function computeNextReview(reviewCount)
// 间隔表（天数）：[1, 3, 7, 14, 30, 60]
// reviewCount >= 间隔表长度时使用最后一档（60 天）
// 返回 new Date(now + intervalDays * 86400000)
// ⚠️ 函数内不使用 Date.now()——接受 nowMs 可选参数（默认 Date.now()）
//   computeNextReview(reviewCount, nowMs = Date.now())
//   这样单元测试可传固定时间，保证确定性

// 筛选到期项目（pure function，接受 items 数组）
export function getItemsDue(items, nowMs = Date.now())
// items: Array<{ next_review: string|null, review_count: number, ... }>
// next_review === null → 从未复习，立即到期
// next_review < nowMs（timestamp 比较）→ 到期
// 返回到期的 items 子集，按 next_review 升序（null 排最前）
```

### 4.2 storage.mjs — 新增函数

```javascript
// 用 SRS 间隔更新某个 learning item 的复习状态
export function updateLearningItemReview(space, monthKey, itemTs, reviewCount)
// 读取 learning/{space}/items-{monthKey}.jsonl 的所有行
// 找到 ts === itemTs 的记录，更新：
//   review_count = reviewCount
//   next_review  = computeNextReview(reviewCount).toISOString()
// 整体写回文件（不用 appendFileSync，用 writeFileSync 替换）
// try/catch 包裹，失败静默

// 列出某空间可用的 items 月份（内部辅助，建议同时 export 以方便测试）
export function listItemMonths(space)
// 扫描 learning/{space}/ 目录，提取 items-YYYY-MM.jsonl 中的月份字符串，升序返回
// 目录不存在时返回 []，不抛错
// 与 listCorrectionMonths 对称，逻辑一致

// 读取某空间的到期 learning items（用于 /my-lingo:review）
export function readItemsDue(space)
// 内部调用 listItemMonths(space) 获取所有月份
// 逐月读取 items-{monthKey}.jsonl，合并所有 items
// 调用 getItemsDue(allItems, Date.now()) 筛选到期项（需导入 srs.mjs 中的 getItemsDue）
// 返回到期项数组，按 next_review 升序排列（null 排最前）
// ⚠️ storage.mjs 需在文件顶部 import { getItemsDue } from './srs.mjs'
```

### 4.3 tests/srs.test.mjs

| 测试用例 | 断言 |
|---------|------|
| `computeNextReview(0, now)` — 第一次复习 → 1 天后 | `nextReview - now ≈ 86400000` (±1s) |
| `computeNextReview(1, now)` — 第二次 → 3 天后 | |
| `computeNextReview(2, now)` → 7 天后 | |
| `computeNextReview(5, now)` → 60 天后 | |
| `computeNextReview(99, now)` — 超出间隔表 → 60 天后 | 使用最后一档 |
| `getItemsDue([{next_review:null,...}])` → 包含该项 | `result.length === 1` |
| `getItemsDue([{next_review: pastIso,...}])` → 包含该项 | |
| `getItemsDue([{next_review: futureIso,...}])` → 不包含 | `result.length === 0` |
| `getItemsDue` 排序（按 next_review 升序，null 最前，到期越久越靠前）：给 3 条 items，next_review 分别为 null / 2026-05-01 / 2026-06-01，返回顺序应为 null → 2026-05-01 → 2026-06-01 | |
| `getItemsDue([])` → 空数组，不抛错 | |

### 4.4 storage.test.mjs — 新增用例

| 测试用例 | 断言 |
|---------|------|
| `updateLearningItemReview` — 找到 ts 匹配项并更新 | 读回文件，对应 item 的 review_count/next_review 已更新 |
| `updateLearningItemReview` — ts 不存在 → 静默返回，文件不变 | 其他 item 不受影响 |
| `readItemsDue('english')` — 有到期 items → 返回到期项 | `length >= 1` |
| `readItemsDue('english')` — 所有 items 未到期 → 空数组 | |
| `readItemsDue` — 目录不存在 → 空数组，不抛错 | |
| `listItemMonths('english')` — 写入 items 后 → 返回含当前月的数组 | `months.includes(currentMonth)` |
| `listItemMonths('english')` — 目录不存在 → 空数组，不抛错 | |

### 4.5 commands/my-lingo/vocab.md

```yaml
name: vocab
description: Show high-frequency vocabulary from current language space.
argument-hint: "[--days 30] [--top 20]"
allowed-tools: Bash, Read, Glob
```

Workflow（Claude 执行）：
1. 解析参数（days 默认 30，top 默认 20）
2. 计算对应月份列表，`readLearningItems(space, months)`
3. 过滤 `type === 'phrase'` 的 items
4. 按 `target_text` 去重（同一词汇可能重复出现），统计频次
5. 取 Top N，格式化输出（target_text / native_explanation / review_count）
6. 无数据时提示"No vocabulary recorded yet"

### 4.6 commands/my-lingo/sentences.md

```yaml
name: sentences
description: Show common sentence patterns from current language space.
argument-hint: "[--days 30]"
allowed-tools: Bash, Read, Glob
```

Workflow（同 vocab.md，过滤 `type === 'sentence_pattern'`）

### 4.7 commands/my-lingo/review.md

```yaml
name: review
description: Review vocabulary items due today using spaced repetition.
allowed-tools: Bash, Read
```

Workflow（Claude 执行）：
1. `readItemsDue(activeSpace)` 获取到期 items
2. 无到期 items → 提示"All caught up! No items due for review."
3. 有 items → 对每条：
   a. 显示 `native_explanation`（提示词）
   b. 等用户回答（Claude 引导用户说出 target_text）
   c. 对比答案，给出反馈
   d. 调用 `node -e` 执行 `updateLearningItemReview(space, monthKey, ts, newCount)`
4. 完成后展示本次复习统计（复习了 N 条 / 下次复习时间分布）

---

## 五、Phase 2 — 课程生成

### 5.1 scripts/lib/lesson.mjs

```javascript
// 构建课程生成 messages（pure function）
export function buildLessonMessages(data, config)
// data: { corrections: [...], turns: [...], level, space_name }
// config: { native_language }
// System prompt: 见 dev_docs/06-api-protocol.md §4.3
// User message: 把 corrections 和 turns 格式化为上下文
// 返回 { messages: [{role,content},...] }

// 解析课程响应（pure function）
export function parseLessonResponse(stdout)
// stdout: curl 原始输出
// 流程同 parseAnalysisResponse：JSON.parse → choices[0] → content
// content 直接是 Markdown 字符串（非 JSON）
// 返回 string 或 null（失败）
```

### 5.2 scripts/generate-lesson.mjs

独立可执行脚本（`lesson.md` 通过 `Bash` 调用）：

```
Usage: node scripts/generate-lesson.mjs [--days 7] [--type grammar|vocab|prompt]
```

功能：
1. `loadConfig(process.cwd())`
2. `loadSpaces()` → 获取 active space 配置
3. 检查今日是否已有课程文件（`learning/{space}/lessons-YYYY-MM-DD.md`）→ 有则输出已有课程，退出
4. 读取指定天数的 corrections + turns
5. `buildLessonMessages(data, config)` → `callDeepModel(payload, config, { jsonMode: false })`
   （课程内容是 Markdown 字符串，不能用 JSON 模式——详见 IMPLEMENTATION_PLAN_V0.2.md §5.1 中 callDeepModel 的 opts 参数说明）
6. `parseLessonResponse(stdout)` → 写入 `learning/{space}/lessons-YYYY-MM-DD.md`
7. 输出课程内容到 stdout（Claude 捕获并显示）

### 5.3 commands/my-lingo/lesson.md

```yaml
name: lesson
description: Generate a personalized learning lesson based on recent interactions.
argument-hint: "[--days 7] [--type grammar|vocab|prompt]"
allowed-tools: Bash, Read
```

Workflow：调用 `node scripts/generate-lesson.mjs $ARGUMENTS`，展示输出。

### 5.4 tests/lesson.test.mjs（新增文件）

测试 `lesson.mjs` 的纯函数。**不要**将这些用例加入 `analysis.test.mjs`——`lesson.mjs` 是独立模块，测试应独立。

| 测试用例 | 断言 |
|---------|------|
| `buildLessonMessages(data, config)` — 返回 `{messages:[...]}` | `messages[0].role==='system'`, `messages[1].role==='user'` |
| `buildLessonMessages` — system prompt 包含 target_language / native_language / level | `messages[0].content` 含对应值 |
| `buildLessonMessages` — corrections 为空 → messages 仍有效（user message 说明无错误） | 不返回 null |
| `buildLessonMessages` — user message 包含 corrections 内容（target_text / original） | content 含传入字段 |
| `parseLessonResponse` — 合法 stdout，choices[0].message.content 为 Markdown → 返回字符串 | `typeof result === 'string'` |
| `parseLessonResponse` — 垃圾字符串 → null，不抛错 | `result === null` |
| `parseLessonResponse` — content 为空字符串 → null | |

### 5.5 集成测试扩展

#### PT-011: generate-lesson.mjs 成功生成课程（async，mock server）

```
scenario: run generate-lesson.mjs with mock server returning Markdown lesson
mock: returns { choices: [{message:{content:"# My Lingo Lesson\n..."}}] }
setup: pre-write 3 corrections + config pointing to mock server
run: spawn('node', ['scripts/generate-lesson.mjs', '--days', '7'], { env: {...dataDir} })
verify:
  - exit 0
  - lesson file created: dataDir/my-lingo/learning/english/lessons-YYYY-MM-DD.md
  - stdout contains "# My Lingo Lesson"
```

---

## 六、Phase 3 — 语言画像

### 6.1 commands/my-lingo/profile.md

```yaml
name: profile
description: Show your language learning profile and improvement trends.
allowed-tools: Bash, Read, Glob
```

Workflow（Claude 执行）：
1. 读取最近 30 天 corrections + turns（用现有存储函数）
2. 计算统计数据：
   - 总 turns、优化率、fallback 率
   - 最常见错误类型（按 pattern 分组统计）
   - 最近 7 天 vs 前 7 天错误率变化（改善趋势）
   - 已积累 learning items 总数 / 已复习 / 到期待复习
3. 可选（若 config.model_deep 配置了）：调用 `node -e` 运行深度分析
4. 格式化输出（header + 统计卡片 + 改善建议）

---

## 七、Phase 4 — 导出

### 7.1 commands/my-lingo/export.md

```yaml
name: export
description: Export learning materials for current language space as Markdown.
argument-hint: "[--space <key>] [--months 3]"
allowed-tools: Bash, Read, Glob
```

Workflow（Claude 执行）：
1. 解析参数（space 默认 active，months 默认 3）
2. 读取：最近 N 月的 corrections + learning items + lesson 文件（若存在）
3. 生成 Markdown 结构：
   ```markdown
   # My Lingo Export — {Space} Space ({dateRange})

   ## Common Errors

   ### {pattern} ({count} occurrences)
   - Original: `{original}`
   - Corrected: `{corrected}`
   - Explanation: {explanation}

   ## Vocabulary
   - **{target_text}** — {native_explanation}

   ## Sentence Patterns
   - **{target_text}** — {native_explanation}

   ## Lessons
   {lesson file content}
   ```
4. 输出到 stdout（Claude 将内容显示给用户，用户可复制）

### 7.2 集成测试扩展

#### PT-012: SRS 到期 items 正确筛选（存储层单元测试，无需 mock）

```
scenario: write learning items with various next_review dates
setup:
  - item A: next_review = past ISO date (due)
  - item B: next_review = null (never reviewed, due)
  - item C: next_review = future ISO date (not due)
run: readItemsDue('english')
verify:
  - result contains A and B
  - result does NOT contain C
  - B appears before A (null sorts first)
```

（注：此测试是 storage 层单元测试，应在 `tests/storage.test.mjs` 中实现，不需要 mock server。PT-012 编号保留在集成测试文件中作为标记，但实际运行在单元测试中。）

---

## 八、测试策略总览（v0.3 新增）

### 新增单元测试文件

| 文件 | 覆盖点 |
|------|--------|
| `tests/srs.test.mjs`（新增）| computeNextReview / getItemsDue 纯函数（10+ 用例）|
| `tests/lesson.test.mjs`（新增）| buildLessonMessages / parseLessonResponse（7 用例，见 §5.4）|
| `tests/storage.test.mjs`（追加）| updateLearningItemReview / readItemsDue / listItemMonths |

### 新增集成测试

| 编号 | 场景 | 类型 |
|------|------|------|
| PT-011 | generate-lesson.mjs 通过 mock deep model 生成课程 | async，需 mock server |
| PT-012 | SRS 到期 items 筛选（纯存储逻辑）| 存储层（含 mock，或临时目录） |

### 仍需手动（新增到 PENDING_TESTS.md）

| 编号 | 内容 | 原因 |
|------|------|------|
| PT-013 | `/my-lingo:lesson` 生成并展示课程 | 依赖交互式 Claude Code 会话 + 真实 Deep Model |
| PT-014 | `/my-lingo:review` 引导用户复习并更新 SRS 状态 | 依赖交互式 Claude Code 会话 |
| PT-015 | `/my-lingo:export` 输出格式正确可用 | 依赖交互式 Claude Code 会话 |

---

## 九、DONE 验收清单（完整）

```bash
# 单元测试：应 ≥ 160 个通过
npm test

# 集成测试：应 ≥ 11 个通过
npm run test:integration

# 文件检查
ls commands/my-lingo/{lesson,vocab,sentences,profile,review,export}.md
ls scripts/{generate-lesson,lib/srs,lib/lesson}.mjs
ls tests/{srs,lesson}.test.mjs

# 函数导出检查
node --input-type=module <<'EOF'
import { computeNextReview, getItemsDue } from './scripts/lib/srs.mjs'
import { buildLessonMessages, parseLessonResponse } from './scripts/lib/lesson.mjs'
import { updateLearningItemReview, readItemsDue, listItemMonths } from './scripts/lib/storage.mjs'
console.log('all v0.3 exports OK')
EOF

# 无 npm 依赖
node -e "const p = JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log(!p.dependencies ? 'OK' : 'FAIL')"
```
