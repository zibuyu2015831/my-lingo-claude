# My Lingo — 架构与代码审查报告（v0.5）

> **审查日期**：2026-06-11
> **审查者**：系统架构师 / 资深用户视角，基于源码逐文件 + 运行时实测
> **审查分支**：`docs/data-dir-split-investigation`（领先 `master` 14 个 commit）
> **审查范围**：`scripts/lib/*.mjs`（12 模块）、3 个 hook 入口、16 个 `commands/my-lingo/*.md`、插件元数据、测试套件
> **方法**：所有结论均有 `文件:行号` 出处；关键结论用 `node` / `node --test` 实测验证（见 §附录 A）
> **定位**：项目未发布，审查以"最优方案、零历史包袱"为标尺，可推翻既有设计

---

## 修复落地状态（2026-06-11 复盘）

下表为审查后**全部修复的落地结果**。每项均配套测试并已分阶段 commit；修复后基线 **241 单元 + 14 集成全绿**。

| 项 | 严重度 | 状态 | 落地说明 |
|----|--------|------|----------|
| F1 集成测试红（status→info） | 🔴 | ✅ 已修复 | PT-013/015/016 改指向 `info`；集成回到 14/14 |
| F2 分析/lesson 脱敏泄露 | 🔴 | ✅ 已修复 | 新增 `redactMessages`，下沉到 `callFastModel`/`callDeepModel` 出站边界；删除调用方散点 redact；+4 测试 |
| F3 多空间不可达 | 🔴 | ✅ 已修复 | 新增 `/my-lingo:addspace`、`/my-lingo:rmspace`；修正 `use.md`/`spaces.md` 引导；端到端验证 |
| F4 熔断器单次即熔断 | 🟠 | ✅ 已修复 | `checkCircuitBreaker(config)` 改为 `failure_count>=阈值` 才打开、读 config 冷却、到期自复位；PT-002 重写为 3 连击语义 |
| F5 SQLite 失败静默 | 🟠 | ✅ 已修复 | `getDb()` 失败一次性 stderr 告警后再抛；与 `getDataDir` 的"未解析"错误区分 |
| F6 默认无条件母语摘要 | 🟠 | ✅ 已修复 | 引入 `summary_language_mode`（默认 `off`），与 `response_language_mode` 对称；测试更新 |
| F7 max_tokens 截断 | 🟠 | ✅ 已修复 | 输出预算随输入规模动态放大（512–2048） |
| F8 transcript 路径仅处理 `/_` | 🟡 | ✅ 已修复 | 改为 `[^a-zA-Z0-9]→-`，对齐 Claude Code 真实规则；+1 测试 |
| F9 debug 记录不存在字段 | 🟡 | ✅ 已修复 | `DETECT` 改记 `detection.ratio` |
| F12 每轮重跑建表 | 🟡 | ✅ 已修复 | `PRAGMA user_version` 短路 initSchema |
| F10 node:sqlite 可移植性 | 🟡 | 🟢 已缓解 | 实测本机 Node 22.22 免 flag 可用；**靠 F5 让不兼容环境响亮失败**；保留 `engines>=22.5.0`，未硬改版本 |
| F11 curl argv 凭证 / slash 注入面 | 🟡 | ⚪ 接受 | 个人本地工具语境，已记录；slash 命令均经 `"$VAR"` argv 安全传参，不改以免引入风险 |

> 下文 §一～§三 为**审查当时**的原始记录，保留作为问题溯源与设计依据，不再随修复改写。

---

## 〇、总体评价

**这是一个工程质量明显高于平均水准的小型插件。** 架构分层清晰、对失败面有真实思考、对"不可信 LLM 输出"和"多进程并发"等难点都有针对性处理。下列设计值得肯定并应保留：

| 亮点 | 出处 | 评价 |
|------|------|------|
| `install.json` 指针解 env-blind 命令定位 | `paths.mjs:36-67` | 优雅、对 Claude Code 命名方案变化免疫、`import.meta.url` 自定位零环境依赖。data-dir 调查是教科书级的根因分析 |
| SessionEnd 单写者事务 + 按 id 幂等标记 | `session-end.mjs:111-140`、`storage.mjs:151-159` | 网络调用置于事务外、`markTurnsAnalyzed(ids)` 与写入原子提交，崩溃重跑不产生重复纠错。正确 |
| 值强制 `n()`/`b()` 防静默丢行 | `storage.mjs:9-21` | 把不可绑定的 LLM 字段强转为 JSON 文本而非让 `.run()` 抛进 `catch{}`，避免"丢行但已标记 analyzed"的永久丢失。考虑周到 |
| 分层解循环依赖 | `paths.mjs` 独立于 `storage.mjs`/`db.mjs` | `getDataDir()` 单列，干净 |
| 多进程并发 | `db.mjs:27-29` | WAL + `busy_timeout=3000` + `synchronous=NORMAL`，三进程读写处理得当 |
| 工程卫生 | 全局 | 零 npm 依赖、`node:` 前缀、`0o600`/`0o700` 权限、`tmp+rename` 原子写、JSON 解析全程 try/catch |
| `paths.mjs` 失败响亮 | `paths.mjs:46` | 解析不到数据目录直接抛错而非静默假目录——正是 data-dir bug 的正确反面 |

**但审查也发现若干必须在发布前处理的问题**，其中 3 项已通过运行实测坐实（含一处当前即为 broken 的测试套件，和一处隐私泄露）。下文按严重度排列。

---

## 一、发现清单（按严重度）

severity 图例：🔴 高（发布阻塞） · 🟠 中（应修） · 🟡 低（建议） · 🔵 纯设计建议

### 🔴 F1 — 集成测试当前为 broken；`status→info` 重命名未做完，"243 全绿"已失实

- **位置**：`tests/integration/integration.test.mjs:453, 505, 537`（引用命令名 `'status'`）；`commands/my-lingo/status.md` 已被删（重命名为 `info.md`，commit `d2c935c`/`6364b5f`）
- **实测**：`node --test tests/integration/integration.test.mjs` → **11 pass / 3 fail**，PT-013 / PT-015 / PT-016 全部 `ENOENT: ...commands/my-lingo/status.md`（§附录 A）
- **根因**：重命名只改了命令文件与若干 doc，**漏改了集成测试里硬编码的命令名**。`INDEX.md`（"222+12"）与 `dev_docs/14 §11.2`（"243 全绿"）的绿测断言现已与事实不符。
- **影响**：分支处于"测试红"状态；任何把这三个用例当作 data-dir 修复回归护栏的人会被误导。讽刺的是，**挂掉的恰是验证 data-dir 修复的 PT-015/016**——核心修复目前没有可运行的护栏。
- **建议**：把三处 `'status'` 改为 `'info'`；并见 D-G（用命令清单常量 + 元测试根除"重命名漏改"类问题）。

### 🔴 F2 — 脱敏不是集中保证：SessionEnd 分析与 lesson 生成把**原始 prompt（含密钥）**原样发给外部模型

- **位置**：`analysis.mjs:29-41`（直接插值 `t.original_prompt` / `t.execution_prompt`）；`session-end.mjs:100`（传入的是 DB 原始行）；`generate-lesson.mjs:34-46`（`readCorrections`/`readTurnsLastNDays` 原始数据）→ `analysis.callDeepModel`
- **根因**：`redact()` 只在**同步优化路径**（`user-prompt-submit.mjs:171, 220`）被调用一次。`writeTurn` 存入 DB 的 `original_prompt` 是**未脱敏**原文（设计如此，本地库可留原文）。但 SessionEnd / lesson 从 DB 读回原文后，**未经脱敏直接发往 deep model**。
- **影响**：用户某轮 prompt 里贴了 `password=...` / `sk-...` / 私网 IP，同步路径会脱敏，**但当晚 SessionEnd 分析和 `/my-lingo:lesson` 会把同一密钥明文外发**。脱敏的安全承诺存在系统性缺口——它是"某条代码路径的属性"，而非"出站边界的保证"。
- **建议（D-A）**：把 `redact()` 下沉到**唯一的出站边界**——`api.mjs::callFastModel` 与 `analysis.mjs::callDeepModel` 在 `spawnSync('curl')` 之前对整个 `messages` payload 统一脱敏。这样新增任何 API 路径都自动受保护，且 `user-prompt-submit` 里的散点 `redact()` 可删除（消除重复 + 漏网）。

### 🔴 F3 — 多语言空间子系统对用户**不可达**：无任何创建第二空间的入口

- **位置**：`config.mjs:129 addSpace` / `:152 removeSpace` **未被任何命令调用**（实测 grep 仅命中定义自身与测试）；`use.md:34` 指引用户"Create a new space first by adding it to spaces.json"——但**没有命令做这件事**，且 `setup` 已不写盘（`setup.md:57-72`）
- **根因**：v0.2 引入了完整的多空间数据模型（`spaces.json`、`language_space` 列、`use`/`space`/`spaces` 命令、按空间统计），但**创建空间的 UX 入口从未接出来**。`loadSpaces()` 只能返回内置的单个 `english` 空间。
- **影响**：`/my-lingo:use <other>` 永远报 "Space not found"；`/my-lingo:spaces` 永远只有一个；`language_space` 列、`countTurnsForSpace`、`purgeSpace` 等一整套按空间分片逻辑对终端用户是**死功能**。让用户手改 `spaces.json` 既不可发现，也与"`setup` 不写盘、目录由指针决定"的新架构矛盾（用户根本不知道该写哪个目录）。
- **建议（D-B，需用户拍板方向）**：二选一——
  1. **接出生命周期命令**：新增 `/my-lingo:space add <key>` / `remove`，内部调已存在的 `addSpace`/`removeSpace`（代价小，多空间转为可用）；或
  2. **若 MVP 不要多空间**：删除 `use`/`space`/`spaces` 命令与 `addSpace`/`removeSpace`/`language_space` 维度，把模型坍缩为单空间，**大幅降复杂度**。当前"有数据模型、没入口"是最坏的中间态。

---

### 🟠 F4 — 熔断器语义与设计 D4 不符：**单次失败即熔断 5 分钟**，阈值 3 是死逻辑

- **位置**：`api.mjs:97-111 checkCircuitBreaker`、`:113-131 recordApiFailure`
- **现象**：`recordApiFailure` 每次失败就写 `circuit.json`（`last_failure_at=now`）。`checkCircuitBreaker` **只判断"是否在冷却窗口内"**（`Date.now() - last_failure_at < cooldownMs`），**完全不看 `failure_count >= CIRCUIT_THRESHOLD`**。于是**第一次失败后**文件即存在、即在冷却窗内 → 下一条 prompt 直接判为熔断打开。
- **影响**：`CIRCUIT_THRESHOLD=3` 仅用于决定提示文案（`api.mjs:128` 的 `tripped` 只喂给 `user-prompt-submit.mjs:239` 选措辞），**不参与实际 gating**。这与 D4/`00-decisions` 文档承诺的"连续 3 次失败触发熔断"矛盾：一次瞬时网络抖动就让优化停摆 5 分钟。此外 `COOLDOWN_MINUTES` 硬编码为 5（`api.mjs:8`），把 `config.circuit_breaker_cooldown_minutes`（`config.mjs:16`）变成**死配置**。
- **建议（D-C）**：让 `checkCircuitBreaker` 真正读 `failure_count >= CIRCUIT_THRESHOLD` 才算打开；区分"单次瞬时失败→直接回退、不熔断"与"累计 N 次→熔断冷却"；冷却时长读 config。

### 🟠 F5 — 失败哲学自相矛盾：`paths.mjs` 响亮抛错，但 `storage.mjs` 全量静默吞错

- **位置**：`storage.mjs` 每个函数都是 `try { getDb()... } catch { return [] / no-op }`；`db.mjs:21-35 getDb` 内 `import 'node:sqlite'` 一旦失败（见 F10）会一路被上层 `catch{}` 吃掉
- **现象**：若 `node:sqlite` 在某 Node 版本不可用、或 DB 文件损坏/权限错，**整个插件静默地"什么都不记录"**，命令面板显示 0 —— 这**正是 data-dir 调查（dev_docs/14）耗费大量篇幅要根除的"安静的错"**。`paths.mjs:46` 已经为此把"解析不到目录"改成抛错，但 `db`/`storage` 初始化失败仍走老的静默路线，两套哲学不一致。
- **影响**：发布后若用户 Node 环境不满足，故障表现为"插件像没装一样"，极难自诊断（与 data-dir bug 同型）。
- **建议（D-D）**：`getDb()` 首次构造失败时，向 `stderr` 打一条一次性、可见的告警（"SQLite 不可用：需 Node ≥ X，当前 Y"），把"环境性失败"与"正常无数据"区分开。其余读函数可继续静默返回 `[]`。

### 🟠 F6 — 默认对**每一轮**无条件追加母语摘要指令，无独立开关

- **位置**：`prompts.mjs:65-69 buildSummaryLanguageCtx`，被 `user-prompt-submit.mjs:39` 在所有非 off 模式注入
- **现象**：`lang = config.summary_language || config.native_language`。`summary_language` 不在任何默认配置里 → 恒为 `undefined` → 取 `native_language`（默认 `zh-CN` ≠ `en`）→ **每一条优化 prompt 都附带"回答后追加 2-3 句中文摘要"**。这是一个**默认常开、且只能靠把 `native_language` 设成 `en` 才能关掉**的强行为。
- **影响**：放大每次回复的长度与 token 成本；对只想要英文优化、不需要中文摘要的用户是意外行为。与 `response_language_mode`（`config.mjs:19`，显式三态、默认 off）的设计风格不一致。
- **建议（D-E）**：引入显式 `summary_language_mode`（`off`/`native`），默认 `off`；或在 `info`/`setup` 中明示该行为。统一"回复语言/摘要"为可发现的开关，去掉隐式 always-on。

### 🟠 F7 — `max_tokens: 512` 对长 prompt 优化输出可能截断 → JSON 解析失败 → 回退

- **位置**：`api.mjs:54`（`max_tokens: 512`），上限输入 `max_prompt_length: 4000`（`config.mjs:15`）
- **现象**：4000 字符（约 ~1000+ token）的 prompt 经"翻译+优化"后输出常与输入同量级，512 token 容易截断；截断的 JSON 在 `parseModelResponse`（`api.mjs:31-37`）二次 `JSON.parse(content)` 失败 → `null` → 回退发原文，且**计入失败、可能触发熔断（叠加 F4 后单次即熔断）**。
- **建议（D-F）**：`max_tokens` 随输入规模动态放大（如 `min(2048, 输入token*1.5+256)`），或直接提到 1024-2048。

---

### 🟡 F8 — Stop hook 的 transcript 路径推导只处理 `/` 和 `_`，含 `.`/空格的工程路径会静默丢回复

- **位置**：`stop.mjs:15-18 transcriptPath`：`cwd.replace(/\//g,'-').replace(/_/g,'-')`
- **现象**：Claude Code 实际把工程路径里**所有非字母数字**字符转 `-`（本机 `/data/zibuyu/my_lingo_claude` → `-data-zibuyu-my-lingo-claude` 恰好只含 `/_`，所以巧合正确）。但 cwd 含 `.`（如 `~/my.app`）、空格、`@` 等时，本公式产物 ≠ 真实目录 → `existsSync` 落空 → `STOP_TRANSCRIPT_MISS` → **回复捕获静默失效**，进而 SessionEnd 分析缺少回复上下文。
- **建议**：对齐真实规则 `cwd.replace(/[^a-zA-Z0-9]/g, '-')`，并保留一次 debug 日志便于核验。

### 🟡 F9 — debug 日志记录不存在的字段

- **位置**：`user-prompt-submit.mjs:199` 记 `detection.score` / `detection.method`，但 `detect.mjs:14-17` 只返回 `{ lang, ratio }` → 恒为 `undefined`
- **影响**：仅调试观感；建议改记 `detection.ratio` 或删字段。

### 🟡 F10 — `node:sqlite` 实验性 + `engines>=22.5.0` 的可移植性需收口

- **位置**：`package.json:11`、`db.mjs:14`；hooks 以 `node "...mjs"`（**无** `--experimental-sqlite`）调用（`hooks.json:11,23,34`）
- **实测**：本机 Node `v22.22.2` 下 `import('node:sqlite')` **无需 flag** 即可用（仅 ExperimentalWarning，已被 `db.mjs:8-12` 吞掉）。但 `node:sqlite` 在更早的 22.x 曾需 `--experimental-sqlite`；落在那一区间的用户会在 `import` 处抛 `ERR_UNKNOWN_BUILTIN_MODULE`，且被 F5 的 `catch{}` 静默吞掉。
- **建议**：确认 `node:sqlite` **免 flag** 的确切最低版本并据此抬高 `engines.node`；配合 F5 让该类失败响亮。

### 🟡 F11 — 出站凭证经 curl argv 传递；slash-command bash 的模型插值面

- **位置**：`api.mjs:71`、`analysis.mjs:102`（`-H "authorization: Bearer ${apiKey}"`）——本机 `ps` 对同机用户可见 key；`mode.md:53`/`use.md:19` 让模型把 `$ARGUMENTS` 插值进 bash 变量再以 argv 传入
- **评估**：个人本地工具语境下可接受，但属"最优方案"应记录。`Bearer` 可改 `-H @-` 经 stdin 传 header 避免 argv 暴露；slash 命令已用 `"$VAR"` argv 传递（比直接拼接安全），保持即可，勿改成字符串拼接。

### 🟡 F12 — 每条 prompt 都重建 DB 连接并跑 5×`CREATE TABLE`+PRAGMA

- **位置**：`db.mjs:21-35 getDb`，由每次 hook 进程冷启动触发；`UserPromptSubmit` 在 8s 同步预算的关键路径上
- **评估**：`CREATE TABLE IF NOT EXISTS` 很便宜但非零；可用 `PRAGMA user_version` 短路（版本匹配则跳过 initSchema），把每轮固定开销再压一点。优先级低。

---

## 二、更优设计与扩展建议（汇总）

> 下列为审查中识别的、**更优或必要**的方案设计，编号与上文 F* 对应。

### D-A　集中式脱敏（根治 F2）
将 `redact()` 从"调用方散点"移动到**唯一出站边界**。在 `api.mjs` 与 `analysis.mjs` 的 curl 包装函数内，对 `payload.messages` 做一次递归脱敏（复用 `debug.mjs:29-38 sanitize` 的思路）再发送。收益：① 关闭分析/lesson 泄露；② 删除 `user-prompt-submit` 内重复 redact；③ 未来新增任何 API 路径默认安全。脱敏后的 `execution_prompt` 仍可正常注入给 Claude（与现状一致）。

### D-B　多空间：接出或砍掉（决断 F3）—— **需用户选方向**
- **接出**：新增 `/my-lingo:space add|remove`，内部直连已存在的 `addSpace`/`removeSpace`，约一个新 `.md` + 复用引导片段。
- **砍掉**：删 `use`/`space`/`spaces` 与多空间维度，单空间化。
两条路都比"有模型无入口"好；建议结合产品意图定夺（见文末提问）。

### D-C　熔断器正确化（修 F4）
`checkCircuitBreaker` 改读 `failure_count` 阈值；冷却时长读 `config.circuit_breaker_cooldown_minutes`；单次失败仅回退不熔断。可加少量单测覆盖"1 次失败不熔断 / 第 3 次熔断 / 冷却到期自动复位"。

### D-D　统一"失败响亮"哲学（修 F5）
让环境性/初始化失败（SQLite 不可用、DB 损坏）走可见 stderr 一次性告警，与 `paths.mjs` 的抛错风格一致；正常"无数据"继续静默。把"安静的错"这一 bug 类彻底关闭。

### D-E　显式语言开关（修 F6）
统一 `summary_language_mode`（off/native）与已存在的 `response_language_mode`（off/target）为对称三件套，默认全 off，在 `/my-lingo:info` 可见当前态。

### D-F　输出预算与兼容回退（修 F7）
`max_tokens` 动态化；并为不支持 `response_format:{type:'json_object'}` 的 OpenAI 兼容端点加回退（已有"Output valid JSON only"系统指令兜底，可在解析失败时不带 `response_format` 重试一次，或仅依赖系统指令）。

### D-G　测试结构防回归（修 F1，并防再发）
- 把命令名收敛为单一清单常量（`['info','last','mode',...]`），测试与文档都引用它，重命名一处即全改。
- 加一条**元测试**：断言 `commands/my-lingo/` 下每个 `.md` 的 frontmatter `name` 与清单一致、且文件存在——可在编译期挡住"删了文件、漏改引用"。
- 加针对 D-A 的断言：分析/lesson 出站 payload 中不含已知密钥样本。

---

## 三、修复优先级建议

| 优先级 | 项 | 类型 | 工作量 |
|--------|-----|------|--------|
| P0 | F1 测试红（status→info） | 正确性/回归护栏 | 极小（改 3 处字符串） |
| P0 | F2 分析/lesson 脱敏泄露 | 隐私/安全 | 小（集中到 curl 边界） |
| P1 | F3 多空间不可达 | 功能完整性 | 小～中（取决于接出 vs 砍掉）·**需用户定方向** |
| P1 | F4 熔断器语义错 | 正确性 | 小 |
| P1 | F5 失败静默 | 健壮性 | 小 |
| P2 | F6 默认母语摘要 | UX/成本 | 小 |
| P2 | F7 max_tokens 截断 | 健壮性 | 极小 |
| P3 | F8–F12 | 低优健壮性/卫生 | 各极小 |

> 说明：P0 两项**应在任何进一步开发前先做**——F1 让护栏复绿、F2 关闭隐私缺口，二者都改动面极小、零争议。

---

## 附录 A — 验证命令与实测结果

```text
# 环境
$ node --version                          → v22.22.2
$ node -e "import('node:sqlite')..."      → OK no-flag: function  (含 ExperimentalWarning)

# F1：集成测试红
$ node --test tests/integration/integration.test.mjs
  → # tests 14 / # pass 11 / # fail 3
  → PT-013 / PT-015 / PT-016：ENOENT ...commands/my-lingo/status.md
$ ls commands/my-lingo/status.md          → 不存在（已重命名为 info.md）
$ node --test tests/*.test.mjs            → 235 pass / 0 fail（单测全绿）

# F3：多空间入口缺失
$ grep -rn "addSpace\|removeSpace" commands/ scripts/
  → 仅命中 config.mjs 的定义自身；无任何命令调用

# F4：熔断器只看冷却窗、不看阈值
  → api.mjs:107  return Date.now() - last_failure_at < cooldownMs   (无 failure_count 判断)
  → api.mjs:128  failure_count>=THRESHOLD 仅用于 debug/文案
```

## 附录 B — 已逐一审阅的文件

- 库：`paths.mjs` `db.mjs` `storage.mjs` `config.mjs` `detect.mjs` `api.mjs` `prompts.mjs` `privacy.mjs` `analysis.mjs` `srs.mjs` `lesson.mjs` `debug.mjs`
- Hook 入口：`user-prompt-submit.mjs` `stop.mjs` `session-end.mjs`；脚本 `generate-lesson.mjs`
- 命令（重点）：`setup.md` `mode.md` `use.md` `info.md` `lesson.md` `review.md`（其余 10 个共享同一引导片段，已抽样核对一致性）
- 元数据/配置：`plugin.json` `marketplace.json` `hooks/hooks.json` `package.json`
- 测试：`tests/*.test.mjs`（运行）、`tests/integration/*`（运行 + 读 helpers）

---

*本报告未改动任何源码，仅为审查产物。修复实施建议按 §三 优先级分批进行，每批配套测试。F3 的方向选择需产品决策后再动手。*
