# Data Dir Split — Hook 与 Slash Command 写读不同目录的排查记录

> **状态**：🔍 已定位根因，待决策修复方案
> **发现日期**：2026-06-08
> **影响范围**：`/my-lingo:space`（部分场景）、`/my-lingo:mode`、`/my-lingo:use`、`/my-lingo:setup` 这 4 个尚未走 `storage.mjs` 的命令
> **影响版本**：v0.5（v0.5 的 commit `7ba2ffd` 修复了 6 个只读命令，但漏掉了上述 4 个）
> **严重等级**：🟡 中。Hook 与数据未损坏，但用户面板会显示与事实不符的"0 turns / default mode"，引发"是不是没装好"的误判
> **当前安装方式**：软链接 `~/.claude/skills/my-lingo` → 项目源码目录（非正式 plugin 安装）

---

## 〇、本文档结论速读

| 关键事实 | 结果 |
|---------|------|
| Hook 是否在工作 | ✅ 正在工作。今日已记录 4 条 turn，SQLite `data.db` 含 5 张表（turns/responses/corrections/learning_items/sessions），最新一条 API 调用成功（`latency_ms: 1725`，`fallback: false`） |
| Slash command 显示 turns=0 是否说明 hook 失败 | ❌ **不是**。Hook 数据写到了一个目录，受影响的 slash command 去另一个目录读取，所以读不到 |
| 这是 v0.5 SQLite 迁移引入的回归吗 | 🟡 **部分是**。Commit `7ba2ffd` 修复了 6 个命令的"项目根解析"问题，但**遗漏了 `space.md` / `mode.md` / `use.md` / `setup.md` 这 4 个**。在被遗漏的命令里，老 bug 以"数据目录"形态重新出现 |
| 是 plugin 系统 bug 吗 | ❌ 不是。Claude Code 给软链安装的插件分配独立 `CLAUDE_PLUGIN_DATA` 命名空间是**正确的隔离行为**；问题在我们项目内**两套环境变量约定不一致**：受影响命令读 `CLAUDE_PLUGIN_DATA`，已修复命令通过 `CLAUDE_PLUGIN_ROOT` import `paths.mjs` 间接读 `CLAUDE_PLUGIN_DATA` —— 二者在 hook 进程里都被 Claude Code 注入，**但在 slash command bash 子进程里两者都可能缺失** |
| v0.5 之后 hook 还写 JSONL 吗 | ❌ 不写了。`storage.mjs` 已无任何 `writeFile/appendFile/.jsonl` 引用。`turns/2026-06-08.jsonl` 是 v0.5 迁移前遗留的历史文件 |

---

## 一、问题复现

### 用户视角

```text
> /my-lingo:space
[my-lingo] Current Language Space
  Key:             english
  ...
  Turns recorded:  0          ← 与事实不符
  Corrections:     0

> /my-lingo:mode
[my-lingo] Current mode: english_optimized (default)   ← "(default)" 暗示从未设置过
```

### 矛盾点

用户**今天确实用中文 prompt 与 Claude 交互过若干次**，按 v0.5 设计应当有数条 turn 记录。"0 turns + default mode"与"Claude 的中文 prompt 确实在表现出英文优化效果"自相矛盾。

---

## 二、排查过程

### Step 1 — 检查默认数据目录

按 `paths.mjs` 的 fallback 逻辑，默认数据目录为 `~/.claude/plugins/data/my-lingo/`。实地查看：

```text
$ ls -la ~/.claude/plugins/data/my-lingo/
-rw-r--r--  1 zibuyu  staff  291 Jun  8 18:10 spaces.json   ← 仅此一文件
(无 config.json, 无 data.db, 无 turns/)
```

→ 与"0 turns / default mode"自洽：目录基本是空的。

### Step 2 — 检查 plugin 安装记录

`~/.claude/plugins/installed_plugins.json` 里**没有 my-lingo 记录**。初看以为是"插件根本没装"，差点得出错误结论。

### Step 3 — 用户提示：软链接安装 + 另一个数据目录

```text
$ find ~/.claude -maxdepth 6 -type l | grep lingo
~/.claude/skills/my-lingo  ->  /Users/zibuyu/code/zibuyu/my-lingo-claude
```

并指出 `~/.claude/plugins/data/my-lingo-skills-dir/my-lingo/turns/2026-06-08.jsonl` 有真实交互记录。

### Step 4 — 检查真目录

```text
$ find ~/.claude/plugins/data/my-lingo-skills-dir -type f
.../my-lingo/data.db                          ← 60KB SQLite
.../my-lingo/turns/2026-06-08.jsonl           ← 4 条记录（v0.5 之前 JSONL 遗留）

$ sqlite3 .../my-lingo/data.db ".tables"
corrections     learning_items  responses       sessions        turns

$ sqlite3 .../my-lingo/data.db "SELECT COUNT(*) FROM turns;"
4
```

最新一条 turn（v0.5 之前以 JSONL 记录的样本）：

```json
{
  "ts": "2026-06-08T13:29:31.371Z",
  "session_id": "bdcfa060-0f74-4bfa-86d7-cde02754f382",
  "language_space": "english",
  "mode": "english_optimized",
  "detected_language": "zh",
  "original_prompt": "拉取最新代码并分析最新改动",
  "execution_prompt": "Pull the latest code from the repository and analyze...",
  "rewrite_type": "translation_and_optimization",
  "latency_ms": 1725,
  "fallback": false
}
```

→ **铁证：hook 在正常工作**。问题不在 hook，而在"目录不一致"。

### Step 5 — 逐命令核对实现风格

| 命令 | 当前实现 | 路径解析方式 |
|------|---------|-------------|
| `errors / export / last / lesson / profile / purge / recent / review / sentences / spaces / status / vocab` | `node --input-type=module --eval` + `import(ROOT + '/scripts/lib/storage.mjs')` | 用 `process.env.CLAUDE_PLUGIN_ROOT` 定位项目根 → 进 `paths.mjs::getDataDir()` → 读 `CLAUDE_PLUGIN_DATA` |
| **`space.md`** | 同上结构 **但** 兜底 `process.env.CLAUDE_PLUGIN_ROOT \|\| process.cwd()` | 当 hook 进程外的 bash 子进程**没有** `CLAUDE_PLUGIN_ROOT` 时，`ROOT` fallback 成 `process.cwd()`（用户工程目录），import 立即抛 `ERR_MODULE_NOT_FOUND` |
| **`mode.md` / `use.md`** | `node -e` 内联，**直接读** `process.env.CLAUDE_PLUGIN_DATA` 否则用 `~/.claude/plugins/data` | 兜底走假目录 |
| **`setup.md`** | bash + 内联 node -e，**直接读** `process.env.CLAUDE_PLUGIN_DATA` | 同上 |

---

## 三、根因分析

### 3.1 关键代码 — `paths.mjs`

```javascript
const FALLBACK_DIR = path.join(os.homedir(), '.claude', 'plugins', 'data')

export function getDataDir() {
  const base = process.env.CLAUDE_PLUGIN_DATA || FALLBACK_DIR
  return path.join(base, 'my-lingo')
}
```

逻辑很简单：有 `CLAUDE_PLUGIN_DATA` 用它，否则 fallback 到默认。

### 3.2 两类进程对环境变量的可见性

| 进程类型 | 启动链路 | `CLAUDE_PLUGIN_ROOT` | `CLAUDE_PLUGIN_DATA` | `getDataDir()` 结果（当前安装形态下） |
|---------|---------|----------------------|----------------------|---------------------------|
| Hook 进程 | Claude Code 检测到 `hooks.json` → `spawn('node', [<script>])`，注入 plugin 上下文 | ✅ 注入 | ✅ 注入 `…/my-lingo-skills-dir` | 真目录 ✅ |
| Slash command 内联 bash 进程 | Claude Code 执行 `commands/*.md` 里的 bash 代码块 → bash 启动 `node`/`node -e`，是否注入插件上下文取决于 Claude Code 实现细节 | ❓ **不可靠**（实测当前 session 里不见得有） | ❓ **不可靠**（实测当前 session 里不见得有） | fallback → 假目录 ❌ |

> **重要不确定性**：当前**无法从外部可靠验证** Claude Code 在 slash command bash 子进程里是否注入 `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA`。事实就是受影响命令读不到环境变量。这可能源自：(a) Claude Code 默认不注入；(b) 注入了但 bash 没透传；(c) 软链安装这种部署形态走的是另一条代码路径。
>
> Commit `7ba2ffd` 的 message 中明确指出 "In real installs a command's bash runs in the USER'S project cwd (not the plugin root)" —— 这表明 Anthropic 团队的修复假设是 **`CLAUDE_PLUGIN_ROOT` 在 bash 子进程里是可用的**（不然 commit 的修复方案也读不到）。修复后的 12 个命令在用户调用时表现正常的话，可以反推这条假设成立。但 `space.md` 现状不是这样 —— 看下文 3.3。

### 3.3 `space.md` 的特殊性：理论上应被 `7ba2ffd` 修好，但仍异常

`space.md` 第 15 行实际写法：

```javascript
const ROOT = process.env.CLAUDE_PLUGIN_ROOT || process.cwd();
```

如果 Anthropic 的修复假设成立（即 bash 子进程里 `CLAUDE_PLUGIN_ROOT` 是注入的），那么 space.md 应该走 import → storage.mjs → paths.mjs → CLAUDE_PLUGIN_DATA → **真目录**。

但用户实测显示 turns=0，说明：
- **要么**当前 session 里 `CLAUDE_PLUGIN_ROOT` 没注入，space.md fallback 成 `process.cwd()`，又因当前 cwd 恰好是项目目录（同一份代码），import 成功了，但 `CLAUDE_PLUGIN_DATA` 仍然缺失，`paths.mjs` 走 FALLBACK_DIR → 假目录；
- **要么**注入了 `CLAUDE_PLUGIN_ROOT` 但**没注入** `CLAUDE_PLUGIN_DATA`（两者注入不是一体的）→ 同样走 FALLBACK_DIR → 假目录。

→ 第二种解释更可能成立，因为：(1) commit `7ba2ffd` 的存在性侧面证明 `CLAUDE_PLUGIN_ROOT` 确实被注入；(2) 用户目前 cwd 就是项目目录，即便走 fallback 也能 import 成功，所以 space.md 不会报错而是"安静地读了错路径"。

> **此根因待用户协助验证一次**：在 slash command bash 块里加一行 `echo "ROOT=$CLAUDE_PLUGIN_ROOT  DATA=$CLAUDE_PLUGIN_DATA"`，即可一锤定音。

### 3.4 `mode.md` / `use.md` / `setup.md` 为什么必坏

这三个命令的内联 `node -e` 块**完全不引用** `CLAUDE_PLUGIN_ROOT`，只读 `CLAUDE_PLUGIN_DATA`。若该变量未注入 → 全部 fallback → 假目录。这是确定性的 bug。

### 3.5 `-skills-dir` 后缀的来历

Claude Code 检测到 `~/.claude/skills/my-lingo` 是"skill 形态"的插件（软链到项目目录），为防止与未来同名 plugin 冲突，**给它分配了独立命名空间**：

```
~/.claude/plugins/data/<plugin-name>-skills-dir/<plugin-name>/
```

注意 my-lingo 出现了**两层**：外层来自 Claude Code 注入，内层来自 `paths.mjs` 的 `path.join(base, 'my-lingo')`。这是**预期行为**，不是 bug；隔离设计是必要的。

### 3.6 为什么 v0.5 才暴露？

| 版本 | 受影响命令的 fallback 行为 | 用户观感 |
|------|---------------------------|----------|
| v0.1–v0.4 | 读 JSONL 文件，路径走 fallback → 假目录里无文件 → "今日 0" | 不显眼，常被认为"新一天没数据" |
| v0.5 commit `7ba2ffd` 前 | 6 个命令的 ESM import 因 cwd 误判直接抛 `ERR_MODULE_NOT_FOUND` → 命令完全报错 | 立即可见 |
| v0.5 commit `7ba2ffd` 后 | 12 个命令修复，但 `space / mode / use / setup` 4 个被遗漏 → 读假目录的旧 bug 重新浮现 | "0 turns" 持续不消失，与"中文 prompt 确实优化了"形成反差，引起注意 |

---

## 四、双目录现状对照表

| 路径 | 文件 | 谁在写 | 谁在读（当前部署形态下） |
|------|------|--------|--------------------------|
| `~/.claude/plugins/data/my-lingo-skills-dir/my-lingo/data.db` | SQLite 单库，60KB，5 张表，turns=4 | ✅ Hook（user-prompt-submit / stop / session-end） | ✅ 12 个已修复命令（通过 `CLAUDE_PLUGIN_ROOT` → import storage.mjs → `CLAUDE_PLUGIN_DATA`） |
| `~/.claude/plugins/data/my-lingo-skills-dir/my-lingo/turns/2026-06-08.jsonl` | v0.5 迁移前遗留，**当前不再被写入**（storage.mjs 已无 JSONL 调用） | （历史） | ❌ 当前无 |
| `~/.claude/plugins/data/my-lingo/spaces.json` | 291 字节，mtime 2026-06-08 18:10 | `setup.md` Step 2 的 bash 块（直接写 fallback 路径，参见 setup.md:60-62） | ✅ `space / mode / use / setup` 4 个命令 |
| `~/.claude/plugins/data/my-lingo/config.json` | **不存在** | — | ✅ 4 个命令尝试读，读不到则用代码内默认值 |
| `~/.claude/plugins/data/my-lingo/data.db` | **不存在** | — | ❌ — |

> **真目录里没有 `spaces.json`**：这意味着 hook 进程读 `spaces.json` 时**也会**读不到（hook 进程虽然 `CLAUDE_PLUGIN_DATA` 指向真目录，但真目录里没这文件）。
>
> 为什么 hook 仍然能正常工作并把 `language_space: "english"` 写进 turn 记录？大概率是 `config.mjs::loadSpaces()` 在文件缺失时回退到了硬编码默认（与命令里看到的默认空间一致）。这意味着**用户对 `spaces.json` 的任何修改（例如添加新空间、改 display_mode）只对受影响的 4 个命令可见，对 hook 不可见** —— 这是一个**独立但相关的更严重 bug**，因为它会导致 hook 行为与用户感知的配置不一致。
>
> 需在 §五"待用户决策"里专门列出。

---

## 五、影响评估

### 已确认受影响的命令

| 命令 | 表现 | 根因 | 严重度 |
|------|------|------|--------|
| `/my-lingo:space` | turns / corrections 永远 0 | `space.md` 走 import 链，但 `CLAUDE_PLUGIN_DATA` 在子进程缺失 → fallback 到假目录 | 中 |
| `/my-lingo:mode` | 永远显示 `(default)`，且 `mode` 切换写入的也是假目录 → hook 进程读不到 | `mode.md` 内联 node -e 直接读 `CLAUDE_PLUGIN_DATA`，未走 `paths.mjs` | 🔴 高（写入路径错误导致用户无法切换 mode） |
| `/my-lingo:use` | 切换空间写到假目录，hook 看不到 | 同上 | 🔴 高（同理） |
| `/my-lingo:setup` | 初始化 `spaces.json` 写到假目录，hook 看不到；后续 `config.json` 也写到假目录 | 同上 | 🔴 高（核心初始化命令） |

### 已修复但需复测的命令（12 个）

`errors / export / last / lesson / profile / purge / recent / review / sentences / spaces / status / vocab` —— 这些命令通过 `CLAUDE_PLUGIN_ROOT` import `storage.mjs` → 经 `paths.mjs` 读 `CLAUDE_PLUGIN_DATA`。**仅当 Claude Code 在 slash command bash 块里注入了 `CLAUDE_PLUGIN_DATA`** 时这条链才能走到真目录。需要**实测验证**：

```bash
# 在任何一个已修复命令里临时加一行：
echo "DEBUG CLAUDE_PLUGIN_DATA=$CLAUDE_PLUGIN_DATA  CLAUDE_PLUGIN_ROOT=$CLAUDE_PLUGIN_ROOT"
```

若 `CLAUDE_PLUGIN_DATA` 为空，则**这 12 个命令也都在读假目录**，只是因为假目录里没有 `data.db` 而表现为"空数据"而非"错误数据"，问题没有 `mode/use/setup` 那么戏剧化但本质相同。

### 未被影响

- 所有 hook 行为（prompt 优化、turn 记录、Stop 捕获、SessionEnd 分析）—— hook 进程的环境变量是被注入的。
- 已生成的数据 —— 没有数据丢失风险，只是"被锁在真目录"。
- v0.5 测试套件（222+12）—— 因为测试用 `process.env.CLAUDE_PLUGIN_DATA` 显式指向临时目录，两条路径汇合。**生产环境暴露的是测试覆盖不到的部署形态差异**。

---

## 六、可选修复方案对比

### 方案 A — 把 4 个遗漏命令对齐 `7ba2ffd` 的修复模式

**做法**：把 `space.md / mode.md / use.md / setup.md` 全部改为 `node --input-type=module --eval` + `import(ROOT + '/scripts/lib/...mjs')` 的形式，让它们走 `paths.mjs`，与已修复的 12 个命令一致。

| 维度 | 评估 |
|------|------|
| 修复彻底度 | 🟡 中。**前提是 `CLAUDE_PLUGIN_DATA` 在 bash 子进程里确实被注入**。如果根因 3.3 的第二种解释成立（注入 `_ROOT` 但不注入 `_DATA`），那 12 个已修复命令本身也只是"沉默错路径"，本方案无效 |
| 改动面 | 中（4 个 .md 文件，结构性重写） |
| 副作用 | 无 |
| 风险 | ⚠️ 必须先做"环境变量诊断"实测，确认 `CLAUDE_PLUGIN_DATA` 是否被注入。否则可能整个修复方向都是错的 |

### 方案 B — 设置全局 `CLAUDE_PLUGIN_DATA` 环境变量

**做法**：在 shell rc 或 Claude Code settings.json 的 env 节里固定 `CLAUDE_PLUGIN_DATA=…/my-lingo-skills-dir`。

| 维度 | 评估 |
|------|------|
| 修复彻底度 | ✅ 立即有效，所有命令同时受益 |
| 副作用 | 🔴 严重。`CLAUDE_PLUGIN_DATA` 是 Claude Code **逐插件**注入的，全局固定后会污染其他插件（未来若装 `foo` plugin，它会被骗去 `…/my-lingo-skills-dir/foo/` 找数据） |
| 推荐度 | ❌ 不推荐做永久方案，可作为"诊断环境变量"的应急绕过 |

### 方案 C — 重新以正规 plugin 形式安装

**做法**：(1) 卸载软链 `rm ~/.claude/skills/my-lingo`；(2) 数据迁移 `my-lingo-skills-dir/my-lingo/` → `my-lingo/`；(3) 创建本地 marketplace 走 `/plugin install`。

| 维度 | 评估 |
|------|------|
| 修复彻底度 | ✅ 最高 — 消除 `-skills-dir` 后缀、消除"软链/正规"双形态歧义 |
| 改动面 | 大 — 需研究当前 Claude Code 本地 plugin 安装的最简流程 |
| 副作用 | 开发期反复 reinstall 不如软链方便 |
| 长期价值 | ✅ 高 — 最终发布时本来就要走这条路 |
| **能否解决子进程环境变量问题？** | ❓ 仍取决于 Claude Code 是否在 slash command bash 块里传递 plugin 上下文。若行为一致，本方案只解决"目录命名"不解决"环境变量传递" |

### 方案 D — 让 `paths.mjs` 智能探测，并要求所有命令统一走 `paths.mjs`

**做法**：

```javascript
// paths.mjs 升级
export function getDataDir() {
  if (process.env.CLAUDE_PLUGIN_DATA) {
    return path.join(process.env.CLAUDE_PLUGIN_DATA, 'my-lingo')
  }
  // fallback：先探测 -skills-dir 形态
  const skillsForm = path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo-skills-dir', 'my-lingo')
  const defaultForm = path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo')
  return fs.existsSync(skillsForm) ? skillsForm : defaultForm
}
```

并把 `mode.md / use.md / setup.md` 也改为 import paths.mjs。

| 维度 | 评估 |
|------|------|
| 修复彻底度 | ✅ 高（即使 `CLAUDE_PLUGIN_DATA` 注入失败也能自愈） |
| 改动面 | `paths.mjs` 一处 + 4 个 .md 重写 |
| 副作用 | 引入"探测"逻辑、依赖 `fs.existsSync`；增加一次 stat 调用 |
| 风险 | 探测逻辑只在没有 `CLAUDE_PLUGIN_DATA` 时触发，对正规 plugin 安装路径完全无影响 |
| 与未来发布兼容 | ✅ 完全兼容（正规安装时 `CLAUDE_PLUGIN_DATA` 一定有，探测分支死代码不触发） |

### 方案 E — 复合方案（建议主线）

**A + D + 诊断验证**：

1. **前置诊断**：在任意一个已修复命令里临时加 `echo $CLAUDE_PLUGIN_DATA $CLAUDE_PLUGIN_ROOT`，确认两个变量在 slash command bash 子进程里**到底有没有**。这一步决定后续方向：
   - 若 `CLAUDE_PLUGIN_DATA` 有 → 走 A，把 4 个遗漏命令对齐修复模式即可；
   - 若 `CLAUDE_PLUGIN_DATA` 无 `CLAUDE_PLUGIN_ROOT` 有 → 必须走 D，让 `paths.mjs` 智能探测；
   - 若两者都无 → D + 在命令里把 ROOT 通过其他方式定位（例如把 plugin root 写进一个固定位置文件）。
2. **数据合并**：把假目录 `~/.claude/plugins/data/my-lingo/spaces.json` 复制（或合并）到真目录 `~/.claude/plugins/data/my-lingo-skills-dir/my-lingo/spaces.json`，让 hook 能读到正确的空间配置。
3. **回归测试**：跑 PT-013（commit `7ba2ffd` 新增的"foreign cwd 命令测试"），并扩展覆盖 `mode/use/setup/space` 这 4 个命令。

---

## 七、待用户决策的问题

1. **是否同意先做"前置诊断"实测**（在一个命令里临时加 echo 看环境变量），再选 A 或 D？
2. **数据是否要主动合并**？当前真目录里 hook 写的 `data.db` 与假目录里手工写的 `spaces.json` 互不相见。
3. **`turns/2026-06-08.jsonl` 遗留文件如何处理**？建议读入并清除（已确认 storage.mjs 不再写 JSONL，否则它就是死数据）。
4. **是否要为 `paths.mjs` 加 stderr 警告**，在检测到 `-skills-dir` 形态时提示"当前为开发模式部署"，便于未来发布前识别该兜底是否仍被触发？
5. **`spaces.json` 双份的更严重隐患**：hook 进程实际读到的 `spaces.json` 是真目录里的（不存在 → 用代码默认），而用户用 `setup/use` 改的是假目录里的。这意味着用户**配置多个语言空间或切换 active 空间，hook 完全不知道**。此问题是否要单独立 issue 跟踪？

---

## 八、附：复现与验证命令

### 查看双目录数据

```bash
echo "=== 真目录 ==="
ls -la ~/.claude/plugins/data/my-lingo-skills-dir/my-lingo/
sqlite3 ~/.claude/plugins/data/my-lingo-skills-dir/my-lingo/data.db ".tables"
sqlite3 ~/.claude/plugins/data/my-lingo-skills-dir/my-lingo/data.db "SELECT COUNT(*) FROM turns;"

echo "=== 假目录 ==="
ls -la ~/.claude/plugins/data/my-lingo/
```

### 前置诊断 — 验证 slash command bash 子进程的环境变量

在任意一个 `commands/my-lingo/*.md` 的 bash 块开头加：

```bash
echo "DEBUG ROOT=$CLAUDE_PLUGIN_ROOT" >&2
echo "DEBUG DATA=$CLAUDE_PLUGIN_DATA" >&2
```

调用一次该 slash command，观察 stderr 输出 —— 这是决定方案 A 还是 D 的关键依据。

### 验证 hook 是否读到了 spaces.json

```bash
# 临时把 spaces.json 移走，让 hook 跑一次，看 turn 记录里的 language_space 字段
mv ~/.claude/plugins/data/my-lingo-skills-dir/my-lingo/spaces.json{,.bak}  # 真目录里本来就没这文件
mv ~/.claude/plugins/data/my-lingo/spaces.json{,.bak}
# 在 Claude 里发一条中文 prompt
# 然后看：
sqlite3 ~/.claude/plugins/data/my-lingo-skills-dir/my-lingo/data.db \
  "SELECT language_space FROM turns ORDER BY ts DESC LIMIT 1;"
# 还原：
mv ~/.claude/plugins/data/my-lingo/spaces.json{.bak,}
```

---

## 九、与其他文档的关联

- 路径计算逻辑：见 [`07-storage.md`](./07-storage.md)；本问题揭示该节文档默认假设 "`CLAUDE_PLUGIN_DATA` 总会被设置"在 slash command bash 子进程里不成立。
- 命令实现入口：见 [`03-commands.md`](./03-commands.md)；本问题暴露"内联 `node -e`" vs "import storage.mjs" 两种命令实现风格的运行时差异。
- v0.5 Phase 2.5（只读命令 SQLite 化）：见 [`./development/IMPLEMENTATION_PLAN_V0.5_SQLITE.md`](./development/IMPLEMENTATION_PLAN_V0.5_SQLITE.md)；本问题是该 Phase 的回归补充 —— commit `7ba2ffd` 修复了 12 个命令，但遗漏了 `space/mode/use/setup`。
- 环境变量配置：见 [`12-env-var-config.md`](./12-env-var-config.md)；建议补充"`CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` 的注入边界"一节，明确这两个变量在哪些进程中可见、在哪些不可见。
