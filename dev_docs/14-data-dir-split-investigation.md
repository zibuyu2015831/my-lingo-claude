# Data Dir Split — Hook 与 Slash Command 写读不同目录的排查记录

> **状态**：✅ 根因已通过 live 系统实测 + 代码 grep 双重确认（见 §〇.5）。方案 F 已修正一处会致其半失效的代码陷阱（`plugin_root` 改用 `import.meta.url`，见测点 4 / B11）。**可进入实施**，仅卡在 2 个不可逆决策点（迁移方向 C vs F+D、`data.db` 合并策略）—— 见 §七.4 实施就绪度评估
> **发现日期**：2026-06-08（2026-06-08 基于代码 + 运行环境复核并修订）
> **影响范围**：**全部 16 个 slash command 都受影响**（不止最初认定的 4 个）。其中 `space / mode / use / setup` 4 个是"写错目录 / 读错目录"，另外 12 个只读命令同样读错目录，只是因为假目录里没有 `data.db` 而表现为"空数据"而非"报错"
> **影响版本**：v0.5（commit `7ba2ffd` 修复了 module-resolution 崩溃，但**没有**修复数据目录分裂；见 §三 修订）
> **严重等级**：🟡→🟠 偏高。Hook 与数据未损坏，但**所有命令面板都与事实不符**（"0 turns / default mode"）；且在"非项目目录启动 claude"的真实安装形态下，12 个命令会重新 `ERR_MODULE_NOT_FOUND` 崩溃
> **当前安装方式**：软链接 `~/.claude/skills/my-lingo` → 项目源码目录（非正式 plugin 安装）
> **实测环境**：本次复核在 Linux（`/home/ubuntu`，工程目录 `/data/zibuyu/my_lingo_claude`）上完成。原始记录里的 `/Users/zibuyu/...`、`staff` 组等是另一台 macOS 机器的快照；**目录里具体有哪些文件因机器而异，但"写目录≠读目录"的结构性结论与平台无关**。

---

## 〇、本文档结论速读

| 关键事实 | 结果 |
|---------|------|
| Hook 是否在工作 | ✅ 正在工作。今日已记录 4 条 turn，SQLite `data.db` 含 5 张表（turns/responses/corrections/learning_items/sessions），最新一条 API 调用成功（`latency_ms: 1725`，`fallback: false`） |
| Slash command 显示 turns=0 是否说明 hook 失败 | ❌ **不是**。Hook 数据写到了一个目录，受影响的 slash command 去另一个目录读取，所以读不到 |
| 这是 v0.5 SQLite 迁移引入的回归吗 | 🟡 **是两个独立问题叠加**：(a) v0.5 把命令改成"cwd 相对 import"导致的 module-resolution 崩溃 —— `7ba2ffd` 试图修但只在 `cwd==插件源码目录` 时有效；(b) 数据目录分裂 —— **`7ba2ffd` 完全没碰**，且 16 个命令全部中招（详见 §〇.5）|
| 是 plugin 系统 bug 吗 | ❌ 不是。Claude Code 给软链安装的插件分配独立 `CLAUDE_PLUGIN_DATA` 命名空间是**正确的隔离行为**；问题在我们项目内**两套环境变量约定不一致**：受影响命令读 `CLAUDE_PLUGIN_DATA`，已修复命令通过 `CLAUDE_PLUGIN_ROOT` import `paths.mjs` 间接读 `CLAUDE_PLUGIN_DATA` —— 二者在 hook 进程里都被 Claude Code 注入，**但在 slash command bash 子进程里两者都可能缺失** |
| v0.5 之后 hook 还写 JSONL 吗 | ❌ 不写了。`storage.mjs` 已无任何 `writeFile/appendFile/.jsonl` 引用。`turns/2026-06-08.jsonl` 是 v0.5 迁移前遗留的历史文件 |

---

## 〇.5、本次代码 + Live 系统复核的决定性结论（2026-06-08 修订新增）

原始文档把"slash command bash 子进程到底有没有 `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA`"列为**待用户实测**的未决项（见旧 §3.2/3.3 的"重要不确定性"）。本次复核**直接在运行环境里测了**，结论可以落地：

### 测点 1 — bash 子进程的环境变量（决定性）

```text
$ echo "ROOT=[$CLAUDE_PLUGIN_ROOT]"  →  ROOT=[]
$ echo "DATA=[$CLAUDE_PLUGIN_DATA]"  →  DATA=[]
```

**两个变量在 slash command 走的 Bash 子进程里都是空的。** slash command 的 bash 代码块由模型经 Bash 工具执行，与此处同一条执行通道，故该结果直接代表 slash command 的运行时环境。

> ⚠️ 唯一残留保留：我们是从 Bash 工具侧观测，理论上不能 100% 排除 Claude Code 对"命令体内 bash"与"Agent 主动调用 bash"采用不同注入策略。但下面测点 2/3 的数据分布与"两变量皆缺失"完全自洽，可信度很高。

### 测点 2 — Hook 进程确实拿到了 `CLAUDE_PLUGIN_DATA`（与命令相反）

- 真目录 `…/my-lingo-skills-dir/my-lingo/data.db` 的 mtime 是**本 session 内的 22:11**（用户本次发的中文 prompt 触发 `user-prompt-submit` 写入）。
- 即 hook 进程**写到了 skills-dir 真目录** → 证明 hook 的 `CLAUDE_PLUGIN_DATA` 被注入且指向 skills-dir。
- 机制差异：`hooks.json` 里命令写法是 `node "${CLAUDE_PLUGIN_ROOT}/scripts/..."`，`${CLAUDE_PLUGIN_ROOT}` 是 **Claude Code 在拼 hook 命令串时做的模板展开**；而 slash command 里命令依赖 `process.env.CLAUDE_PLUGIN_ROOT` 作为**真实环境变量**。两者是不同机制 —— 这正是 hook 能工作、命令不能的根本原因。commit `7ba2ffd` 的 message 把二者当成"同一约定"，是**误判**。

### 测点 3 — 因此：所有命令实际都在读"假目录"

| 命令组 | 现象 | 直接原因 |
|--------|------|----------|
| `space` + 12 个"已修复"只读命令 | 读到空数据（"0 turns"），**不报错** | `getDataDir()` 拿不到 `CLAUDE_PLUGIN_DATA` → fallback 假目录；import 之所以没崩，是因为本机 `cwd == 插件源码目录`（软链 target 与 cwd 相同），`process.cwd()` 兜底恰好能 import 到 `scripts/lib/*.mjs` |
| `mode / use / setup` | 读写假目录，hook 看不到 | 内联 `node -e` 直接读 `CLAUDE_PLUGIN_DATA` → 缺失 → fallback 假目录 |

```text
$ readlink -f ~/.claude/skills/my-lingo   →  /data/zibuyu/my_lingo_claude   (== 当前 cwd)
```

### 测点 4 — Hook 进程也很可能没有 `CLAUDE_PLUGIN_ROOT` 环境变量（代码实测新增）

`grep -rn CLAUDE_PLUGIN_ROOT scripts/` → **零命中**。即**没有任何 hook 脚本读 `process.env.CLAUDE_PLUGIN_ROOT`**；hook 之所以能定位脚本，纯靠 `hooks.json` 命令串里的 `${CLAUDE_PLUGIN_ROOT}` 被 Claude Code **模板展开**，与 hook node 进程内是否有这个环境变量**无关**。因此不能假设 hook 进程里 `process.env.CLAUDE_PLUGIN_ROOT` 非空 —— 按它与命令 bash 的对称性，**很可能同样为空**。

- **对方案 F 的直接影响（关键）**：原 Plan F 草稿写 `plugin_root: process.env.CLAUDE_PLUGIN_ROOT`，若该 env 在 hook 进程为空，指针里的 `plugin_root` 就是 `undefined`，"命令定位模块"那半个目标**静默失效**。修正：`plugin_root` 必须由 `import.meta.url` 推导（`scripts/` 的上一级），这是 hook 进程内 100% 可靠、零环境依赖的自身定位。详见 §六-F 改后的代码与 B11。
- **反面对照**：`CLAUDE_PLUGIN_DATA` 作为**真实环境变量**则有直接铁证 —— `hooks.json` 通篇**没有** `${CLAUDE_PLUGIN_DATA}`，而 hook 却写进了 skills-dir 真目录，唯一可能就是 `paths.mjs` 读到了 `process.env.CLAUDE_PLUGIN_DATA`。故 F 里 `data_dir: getDataDir()` 这半是稳的。

### 由此可纠正原文三处判断

1. **受影响命令不是 4 个，是 16 个全部。** 12 个只读命令并未被 `7ba2ffd` 真正修好；它们读的也是假目录，只是空目录表现为"0"而非"错值"。
2. **`7ba2ffd` 没有修复数据目录问题，只修复了 module-resolution 崩溃，而且这个修复本身是 cwd 依赖的**：仅当 `cwd == 插件源码目录`（当前开发形态）时命令才不崩。一旦用户**在别的工程目录里启动 claude**（真实安装的常态），`CLAUDE_PLUGIN_ROOT` 仍为空 → fallback `process.cwd()` 指向陌生工程 → `import` 立即 `ERR_MODULE_NOT_FOUND`，**回归 bug 原样复现**。
3. **旧 §3.3 关于 `space.md` 的两种解释里，事实是"第一种 + 第二种同时成立"**：`CLAUDE_PLUGIN_ROOT` 与 `CLAUDE_PLUGIN_DATA` 都没注入。`space.md` 的 `CLAUDE_PLUGIN_ROOT || process.cwd()` 兜底只影响"能否 import 到模块"，**不影响数据目录** —— 数据目录永远由 `getDataDir()` 决定（`loadSpaces()` 内部也调 `getDataDir()`，见 `config.mjs:84`）。

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
| Hook 进程 | Claude Code 检测到 `hooks.json` → 命令串 `node "${CLAUDE_PLUGIN_ROOT}/scripts/..."` 经**模板展开**后执行 | ✅ 命令串模板展开（定位脚本可用） | ✅ 注入为环境变量 `…/my-lingo-skills-dir` | 真目录 ✅ |
| Slash command 内联 bash 进程 | Claude Code 执行 `commands/*.md` 里的 bash 代码块 → bash 启动 `node`/`node -e` | ❌ **实测为空**（命令读 `process.env.CLAUDE_PLUGIN_ROOT`，无模板展开） | ❌ **实测为空** | fallback → 假目录 ❌ |

> **✅ 不确定性已消除（2026-06-08 实测，见 §〇.5）**：在 slash command 的 bash 子进程里，`CLAUDE_PLUGIN_ROOT` **和** `CLAUDE_PLUGIN_DATA` **都为空**。
>
> 关键机制区分：`hooks.json` 用 `node "${CLAUDE_PLUGIN_ROOT}/..."`，`${...}` 由 Claude Code **拼命令串时模板展开**，所以 hook 能定位到脚本；而 slash command 内的 node 读的是 `process.env.CLAUDE_PLUGIN_ROOT` 这个**真实环境变量** —— 它没被注入。commit `7ba2ffd` 的 message 把这两者当成同一约定（"matches hooks.json convention"），是误判：hook 那条 `${CLAUDE_PLUGIN_ROOT}` 的可用性**不能反推** `process.env.CLAUDE_PLUGIN_ROOT` 在命令进程里可用。
>
> 之所以 12 个"已修复"命令当前不崩，纯粹是因为本机 `cwd == 插件源码目录`，`|| process.cwd()` 兜底恰好能 import 到模块（但数据目录仍走 fallback 假目录）。

### 3.3 `space.md`：数据目录与 import 解析是两条**正交**的链路

`space.md` 第 15 行：

```javascript
const ROOT = process.env.CLAUDE_PLUGIN_ROOT || process.cwd();
```

要害在于：**`ROOT` 只用于 `import(ROOT + '/scripts/lib/...')`，它决定"能否加载到代码"，不决定"数据目录"。** 数据目录恒由 `getDataDir()` 决定，而 `space.md` 用的 `loadSpaces()`（`config.mjs:84`）、`countTurnsForSpace()`、`countCorrectionsForSpace()` 内部统统调 `getDataDir()` → 读 `CLAUDE_PLUGIN_DATA`。

实测（§〇.5）后真相是**两个变量都缺失**，于是出现这套确定性行为：

| `CLAUDE_PLUGIN_ROOT` | `cwd` | import 结果 | `CLAUDE_PLUGIN_DATA` | 数据目录 | 观感 |
|----------------------|-------|-----------|----------------------|---------|------|
| 空（当前） | == 插件源码（当前开发形态） | ✅ 成功 | 空 | fallback 假目录 | **静默读到 0 turns**（= 用户所见） |
| 空 | 陌生工程（真实安装常态） | ❌ `ERR_MODULE_NOT_FOUND` | 空 | —— | **命令直接崩溃** |
| 有（正规 plugin 安装时） | 任意 | ✅ | 有 | 真目录 | 正常 |

→ 即 `space.md` 当前是"第一行"：不报错、但读了假目录。旧文这里在两种解释间摇摆，实测后可定为"两变量皆空、且当前 cwd 恰为插件源码"这一条确定路径。

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

> 下表是本次 Linux 机实测快照。**具体文件存在与否因机器而异**（旧 macOS 快照里假目录有 `spaces.json`，本机两边都没有）；不变的是"写目录 = 真(skills-dir)、读目录 = 假(default)"这个结构。**注意：`data.db / config.json / spaces.json / circuit.json` 四类文件全部经 `getDataDir()` 解析，所以它们的"写到哪/读到哪"完全同构。**

真目录 `~/.claude/plugins/data/my-lingo-skills-dir/my-lingo/`（hook 写、命令读不到）：

| 文件 | 本机实测 | 谁在写 |
|------|---------|--------|
| `data.db` | SQLite 单库，~68KB，5 张表（turns/responses/corrections/learning_items/sessions），mtime = 本 session 22:11 | ✅ Hook |
| `circuit.json` | 存在（断路器状态） | ✅ Hook（`api.mjs:94` 经 `getDataDir()`） |
| `turns/2026-06-08.jsonl` | 存在，mtime 20:08 —— **当前 v0.5 代码不再写 JSONL**（storage.mjs 全部走 SQLite），系**当日早些时候旧版代码遗留** | （历史） |

假目录 `~/.claude/plugins/data/my-lingo/`（命令读写、hook 读不到）：

| 文件 | 本机实测 | 谁在读/写 |
|------|---------|-----------|
| `data.db` | **不存在** → 故 `space`+12 命令读到 0 | 命令试图读 |
| `config.json` | **不存在** → `mode` 显示 `(default)` | `mode/setup` 读写 |
| `spaces.json` | **不存在**（旧 macOS 快照里有）→ `use/space` 用代码默认 | `use/setup/space` 读写 |
| `circuit.json` | 存在，mtime 2026-06-06 | （06-06 hook 还在用 fallback 时写的，见下） |
| `turns/2026-06-06.jsonl` | 存在 → v0.4 时期遗留 | （历史） |

> **新发现 1 — 假目录里也有 hook 写的痕迹（circuit.json + 06-06 jsonl）。** skills-dir 命名空间是 06-08 17:39 才出现的；**之前 hook 自己也写 fallback 假目录**。这说明 hook 的 `CLAUDE_PLUGIN_DATA` 注入**并非自始稳定**，而是随某次 Claude Code 行为/版本变化才指向 skills-dir。任何"数据合并"都必须把**两个目录的 data.db / jsonl / circuit.json 全部纳入**，不能只看 `spaces.json`。
>
> **新发现 2 — `spaces.json` 双向不可见的更严重隐患依然成立。** hook 进程读真目录（无 `spaces.json` → 用 `loadSpaces()` 硬编码默认 english），用户用 `use/setup` 改的是假目录。即：**用户新增/切换语言空间，hook 完全不知道**。这是 §五/§七 要单列的高危项。

---

## 五、影响评估

### 已确认受影响的命令（写/读错目录、表现最明显的 4 个）

| 命令 | 表现 | 根因 | 严重度 |
|------|------|------|--------|
| `/my-lingo:space` | turns / corrections 永远 0 | `space.md` 走 import 链，但 `CLAUDE_PLUGIN_DATA` 在子进程缺失 → fallback 到假目录 | 中 |
| `/my-lingo:mode` | 永远显示 `(default)`，且 `mode` 切换写入的也是假目录 → hook 进程读不到 | `mode.md` 内联 node -e 直接读 `CLAUDE_PLUGIN_DATA`，未走 `paths.mjs` | 🔴 高（写入路径错误导致用户无法切换 mode） |
| `/my-lingo:use` | 切换空间写到假目录，hook 看不到 | 同上 | 🔴 高（同理） |
| `/my-lingo:setup` | 初始化 `spaces.json` 写到假目录，hook 看不到；后续 `config.json` 也写到假目录 | 同上 | 🔴 高（核心初始化命令） |

### 同样受影响的 12 个只读命令（实测已确认，非"待复测"）

`errors / export / last / lesson / profile / purge / recent / review / sentences / spaces / status / vocab` —— 实测 `CLAUDE_PLUGIN_DATA` 为空（§〇.5），所以**这 12 个命令也都在读假目录**：

- **当前开发形态**（`cwd == 插件源码目录`）：import 成功 → 读假目录 → 因假目录无 `data.db` 表现为"空数据"，不报错。本质与 `mode/use/setup` 相同，只是不戏剧化。
- 🔴 **真实安装形态**（用户在别的工程里启动 claude，`cwd` 为陌生目录）：`process.env.CLAUDE_PLUGIN_ROOT` 仍为空 → `|| process.cwd()` 指向陌生工程 → `import` 抛 `ERR_MODULE_NOT_FOUND` → **命令直接崩溃**。即 `7ba2ffd` 声称修复的回归在生产形态下**并未真正修复**。可本机复现：`cd /tmp && <跑任一命令的 bash 块>`。

### 未被影响

- 所有 hook 行为（prompt 优化、turn 记录、Stop 捕获、SessionEnd 分析）—— hook 进程经 `${CLAUDE_PLUGIN_ROOT}` 模板展开定位脚本、且 `CLAUDE_PLUGIN_DATA` **当前**被注入指向 skills-dir（但 §四"新发现 1"提示这注入历史上并不稳定）。
- 已生成的数据 —— 没有数据**丢失**风险，但数据**分裂在两个目录**：真目录有 06-08 起的 `data.db`，假目录有 06-06 的旧 jsonl/circuit。
- `getDataDir()` **永不使用 `process.cwd()`** —— 所以即便命令在陌生工程里运行，也**不会把数据误写进用户工程目录**；最坏是 import 崩溃，不是数据污染。这一点可让用户放心。
- v0.5 测试套件（222+12）—— 测试 `runCommandBlock` 显式设了 `CLAUDE_PLUGIN_ROOT` + `CLAUDE_PLUGIN_DATA` 指向临时目录，于是两条链人为汇合、全绿。**测试恰好屏蔽了这两个变量在生产里缺失这一真正的失败面** —— 这是该回归"测试全绿仍然坏"的根因，建议在 §六修复时一并补一个"不设这两个变量"的用例。

---

## 六、可选修复方案对比

### 方案 A — 把 4 个遗漏命令对齐 `7ba2ffd` 的修复模式

**做法**：把 `space.md / mode.md / use.md / setup.md` 全部改为 `node --input-type=module --eval` + `import(ROOT + '/scripts/lib/...mjs')` 的形式，让它们走 `paths.mjs`，与已修复的 12 个命令一致。

| 维度 | 评估 |
|------|------|
| 修复彻底度 | ❌ **实测后已知无效**。`CLAUDE_PLUGIN_DATA` 在命令 bash 里为空（§〇.5），把 4 个命令对齐到 import→`getDataDir()` 链，只会让它们和那 12 个一样**整齐地读假目录**；统一了"实现风格"，没统一"数据目录"。**且会把"陌生 cwd 崩溃"扩散到这 4 个命令**（它们目前至少还能跑） |
| 改动面 | 中（4 个 .md 文件，结构性重写） |
| 价值 | 仅作为 §六-D/F 的**配套清理**有意义（统一风格便于维护），单独用解决不了根因 |

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
| 修复彻底度 | 🟡 中→高。能解决"数据目录"分裂（即使 `CLAUDE_PLUGIN_DATA` 缺失也能探到 skills-dir）。**但解决不了"命令连 `paths.mjs` 都 import 不到"的问题** —— 在陌生 cwd 下 `import(ROOT+'/scripts/lib/paths.mjs')` 仍 `ERR_MODULE_NOT_FOUND`，探测逻辑根本跑不到。所以 D 必须先解决"如何定位插件根"才成立 |
| 改动面 | `paths.mjs` 一处 + 4 个 .md 重写 |
| 副作用 | ⚠️ 探测逻辑**硬编码了 `-skills-dir` 后缀和插件名**；若 Claude Code 改命名方案即失效。更稳的做法是"探哪个候选目录里有 `data.db`/非空就用哪个"，而非匹配字符串后缀 |
| 风险 | 探测只在 `CLAUDE_PLUGIN_DATA` 缺失时触发；当真目录、假目录**都存在 data.db** 时（如本机历史状态）需定义优先级（建议按"含 turns 行数多者"或 mtime 新者），否则又会选错 |
| 与未来发布兼容 | ✅ 兼容（正规安装时 `CLAUDE_PLUGIN_DATA` 一定有，探测分支为死代码） |

### 方案 F — Hook 落一个"指针文件"，命令零环境依赖地读它（实测后新增，**推荐主线**）

**洞见**：本问题的本质是"**hook 进程知道真相（两个变量都有），命令进程一无所知**"。与其让命令去猜目录，不如让**知情的一方把真相写下来**。

**做法**：

1. Hook（`user-prompt-submit` 等）在每次运行时，把解析好的两条绝对路径写进一个**固定的、与环境变量无关的位置**：

   ```javascript
   import { fileURLToPath } from 'node:url'

   // ⚠️ plugin_root 必须来自 import.meta.url，不能来自 process.env.CLAUDE_PLUGIN_ROOT！
   // 代码已实测确认：没有任何 hook 脚本读 process.env.CLAUDE_PLUGIN_ROOT，
   // hook 仅靠 hooks.json 里 ${CLAUDE_PLUGIN_ROOT} 的"命令串模板展开"定位自己，
   // hook 进程内该 env 变量很可能与命令 bash 一样为空（见 §〇.5 测点 4 / B11）。
   // import.meta.url 是 hook 进程内 100% 可靠、与环境变量无关的自身定位手段。
   const here = path.dirname(fileURLToPath(import.meta.url))   // …/scripts
   const pluginRoot = path.dirname(here)                       // …/<plugin root>

   const pointer = path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json')
   const payload = JSON.stringify({
     plugin_root: pluginRoot,
     data_dir: getDataDir(),               // = CLAUDE_PLUGIN_DATA/my-lingo（真目录，env 已实测可用）
     updated_at: new Date().toISOString(),
   }, null, 2)
   // 原子写 + 仅在内容变化时写，避免每条 prompt 都 rewrite（B7/B12）
   try {
     if (fs.readFileSync(pointer, 'utf8') === payload) return  // 已是最新，跳过
   } catch {}
   fs.mkdirSync(path.dirname(pointer), { recursive: true })
   const tmp = pointer + '.tmp'
   fs.writeFileSync(tmp, payload)
   fs.renameSync(tmp, pointer)
   ```

   注意指针文件本身写在**固定 fallback 目录**（不依赖任何变量），所以命令一定找得到它。`updated_at` 参与 diff 会导致每次都写，可在比较时忽略该字段或干脆去掉它。

2. `paths.mjs::getDataDir()` 与命令的"定位插件根"逻辑，按优先级回退：
   `CLAUDE_PLUGIN_DATA`（正规安装） → 读 `install.json.data_dir`（命令场景的主路径） → 探测 `-skills-dir`（方案 D 的兜底） → fallback 假目录。
   命令定位插件根同理优先读 `install.json.plugin_root`，省掉对 `CLAUDE_PLUGIN_ROOT` 的依赖。

3. **命令侧引导片段（16 个 .md 的真正改动量）**。命令要先用纯 Node 内建（无需任何插件 import）读指针拿到 `ROOT`，再 import 插件模块。这段 boilerplate 因"读指针才能 import"的鸡生蛋约束**必须内联复制进每个命令**，无法抽成共享模块：

   ```javascript
   import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
   let ROOT = process.env.CLAUDE_PLUGIN_ROOT;
   if (!ROOT) {
     try {
       const p = path.join(os.homedir(), '.claude', 'plugins', 'data', 'my-lingo', 'install.json');
       ROOT = JSON.parse(fs.readFileSync(p, 'utf8')).plugin_root;
     } catch {}
   }
   ROOT = ROOT || process.cwd();   // 最末兜底（仅开发期 cwd==源码时有效）
   const { getDataDir } = await import(ROOT + '/scripts/lib/paths.mjs');
   ```

   → 这 16 处内联改动（不是只改 4 个）才是 F 的主要工作量；评估改动面时不要低估。

| 维度 | 评估 |
|------|------|
| 修复彻底度 | ✅ 高。**同时解决两个子问题**：命令既能定位模块（plugin_root）又能定位数据目录（data_dir），且**不依赖命令进程的任何环境变量**。前提：`plugin_root` 用 `import.meta.url` 而非 `process.env.CLAUDE_PLUGIN_ROOT`（B11） |
| 改动面 | hook 入口加约 10 行（含 import.meta.url 推导 + 原子写）+ `paths.mjs` 回退链 + **16 个命令**内联引导片段改读指针（不是 4 个 —— 12 个只读命令同样要去掉对 `CLAUDE_PLUGIN_ROOT` env 的隐性依赖，否则陌生 cwd 仍崩，B1）|
| 副作用 | 指针可能**短暂过期**（首次安装后、hook 尚未跑过一次之前，命令读不到指针 → 退回方案 D 探测）。可接受：发一条 prompt 触发 hook 即自愈 |
| 鲁棒性 | ✅ 不硬编码 `-skills-dir` 后缀，对未来命名方案变化免疫 |
| 与未来发布兼容 | ✅ 正规安装时走第一优先级，指针分支为冗余兜底 |

### 方案 E（修订）— 推荐落地组合：**F（主）+ D（兜底）+ A（清理）+ 数据合并 + 测试补强**

实测已把"前置诊断"这一步**做掉了**（结论：两变量在命令里皆空），所以不再需要"先诊断再二选一"，直接按下面执行：

1. **F 为主**：hook 落 `install.json` 指针；`getDataDir()` 与命令定位逻辑按上面的优先级回退。
2. **D 为兜底**：指针还不存在时，`paths.mjs` 探测候选目录中**含 `data.db` 且 turns 最多/最新**者，避免硬编码后缀。
3. **A 为清理**：把 `mode/use/setup` 三个内联 `node -e` 改为统一经 `paths.mjs`（消除第 5 套路径逻辑），但这是**收尾**而非根因修复。
4. **数据合并（一次性脚本）**：把假目录里的 **`data.db`（若有）、`turns/*.jsonl` 旧记录、`config.json`、`spaces.json`** 全部并入真目录 —— 不能只搬 `spaces.json`（§四"新发现 1"：假目录里也有 hook 早期写的数据）。合并 `data.db` 需按主键去重 INSERT，不能直接覆盖。
5. **测试补强**：
   - 修 PT-013：**新增一个"既不设 `CLAUDE_PLUGIN_ROOT` 也不设 `CLAUDE_PLUGIN_DATA`、cwd 设为陌生临时目录"的用例** —— 这才是生产真实形态，现有用例因显式设了这两个变量而漏掉了它。
   - 扩展覆盖 `mode/use/setup/space` 4 个命令的"读写同一目录"断言（写后由另一进程/另一条读链读回）。
   - 加一个"指针文件存在时命令能定位真目录"的用例。

---

## 七、边界与极端情况分析（2026-06-08 新增）

修复方案落地前必须考虑下列边界，否则容易"修了主路径、漏了角落"：

| # | 边界场景 | 当前行为 | 对修复的要求 |
|---|---------|---------|-------------|
| B1 | **在陌生工程目录启动 claude** 后调用任一只读命令 | 12 命令 `ERR_MODULE_NOT_FOUND` 崩溃；4 命令读假目录 | F 的指针文件 / D 的探测必须**不依赖 cwd**；测试要覆盖"陌生 cwd + 无环境变量" |
| B2 | **首次安装、hook 一次都没跑过** 就调用命令 | 指针文件还不存在 | F 必须能优雅退回 D（探测）或假目录，并提示"先发一条消息初始化" |
| B3 | **真目录与假目录都存在 `data.db`**（本机历史就是这样） | 探测可能选错 | D/F 探测需定义确定性优先级：优先 `install.json` → 否则按 turns 行数/ mtime |
| B4 | **`data.db` 合并**（迁移时两库都有数据） | 直接覆盖会丢数据 | 必须按主键去重 INSERT（`turns/responses/corrections/learning_items/sessions` 各有 id），不能 `cp` 覆盖 |
| B5 | **将来从软链改为正规 `/plugin install`** | 出现第三个命名空间，`CLAUDE_PLUGIN_DATA` 变化 | 数据要能再迁一次；F 的指针会被新 hook 自动刷新，天然适配 |
| B6 | **Windows** | `setup.md` Step 2 用 bash heredoc + `$HOME`，在 cmd/PowerShell 下不执行 | 若要跨平台，setup 的 spaces.json 初始化应改为 `node -e`（与 mode/use 一致），不要用 bash 专有语法 |
| B7 | **并发写同一文件**（hook 与命令同时写 config.json/spaces.json） | 目前因目录隔离反而不冲突，但合并后会进同一目录 | `config.mjs::writeSpaces()` 已用 `tmp + rename` 原子写；`mode.md` 的内联写**不是**原子的（直接 `writeFileSync`），合并目录后建议统一走 `writeConfig()` |
| B8 | **`CLAUDE_PLUGIN_DATA` 被全局强行设置后又装别的插件**（方案 B 的副作用） | 其他插件被骗到 `…/my-lingo-skills-dir/<other>/` | 不要用方案 B 做永久方案 |
| B9 | **`getDb()` 句柄缓存** | db.mjs 多半按路径缓存连接；同一进程内 `getDataDir()` 是确定值，无碍 | 若 F 让 `getDataDir()` 读指针，注意**不要每次 stat**，可在进程内缓存一次解析结果 |
| B10 | **指针文件被用户手动删除 / 损坏** | 命令读 JSON 失败 | F 的读取要 `try/catch` 退回探测，不能因指针坏了就崩 |
| B11 | **Hook 进程内 `process.env.CLAUDE_PLUGIN_ROOT` 也为空**（代码实测：无脚本读它，仅靠 hooks.json 模板展开定位） | 若 F 用 `process.env.CLAUDE_PLUGIN_ROOT` 写指针，`plugin_root` 会是 `undefined` | F 的 `plugin_root` **必须**来自 `import.meta.url`（`scripts/` 上级），不得依赖该 env；见 §〇.5 测点 4 |
| B12 | **指针写入频率**：F 的 hook 每条 prompt 都触发 `user-prompt-submit` | 每次都 rewrite `install.json` 是无谓 IO，且非原子写可能被并发命令读到半截 | 用 `tmp + rename` 原子写，并"内容未变则跳过"（忽略 `updated_at` 或去掉它）；见 §六-F 代码 |

## 七.4、实施就绪度评估（2026-06-08 新增）

**结论：根因与方案方向已完全坐实，可以进入实施；但落地前还卡在 2 个"必须先定"的决策点（见 §七.5 的 1、2），以及 1 个已在本轮修正的代码陷阱。**

✅ **已就绪（可直接动手）的部分**：
- 根因（两类进程的环境变量可见性不对称）—— live 实测 + 代码 grep 双重坐实，无悬念。
- 主方案 F 的机制（hook 落指针、命令读指针）—— 自洽、对未来命名变化免疫。
- B1–B12 边界已枚举，每条都有明确的"对修复的要求"。
- 测试缺口已定位（PT-013 显式设两变量 → 屏蔽了生产失败面），补法明确。

⚠️ **本轮已修正、否则会导致 F 半失效的陷阱**（已写入 §六-F / §〇.5 测点 4 / B11）：
- `plugin_root` 原打算取 `process.env.CLAUDE_PLUGIN_ROOT` —— 代码实测无任何 hook 读它，hook 进程内很可能也为空 → 改用 `import.meta.url`。**这是 F 能否成立的关键单点，已修正。**

🚧 **进实施前仍需先拍板（阻塞项）**：
- **D1**：走 **F+D 组合**（保留软链开发形态）还是 **方案 C 转正规安装**（根除 `-skills-dir`）？二者数据迁移脚本不同，先定方向再写代码。
- **D2**：`data.db` 合并策略 —— 确认"按主键去重 INSERT、两目录全量纳入"（§七.5-2/B4）。这决定一次性迁移脚本怎么写，且**不可逆**，必须先确认。

📋 **建议的实施顺序（方向定了之后）**：
1. 先写**数据合并脚本**并备份两目录（最高风险、不可逆，先做完验证）。
2. 改 `paths.mjs` 回退链（F+D），加单测覆盖"无 env / 指针存在 / 指针损坏 / 双 db 选优"。
3. hook 入口加指针写入（import.meta.url + 原子写）。
4. 16 个命令换引导片段；`mode/use/setup` 顺带改原子写（B7）。
5. 补 PT-013"无两变量 + 陌生 cwd"用例 + "写后读回同目录"断言。
6. 跑全量 222+12 测试 + 手动在 `/tmp` 下复现 B1 验证不再崩。

## 七.5、待用户决策的问题

1. ~~是否先做前置诊断~~ —— **已实测，无需再做**（§〇.5：两变量在命令里皆空）。现在的决策是直接选**方案 F+D 组合**还是更激进的**方案 C（转正规安装）**。
2. **数据合并范围**：确认要合并的是**两个目录的全部数据文件**（data.db / jsonl / config.json / spaces.json / circuit.json），而不仅 `spaces.json`（§四"新发现 1"）。`data.db` 是否同意按主键去重合并？
3. **遗留 `turns/*.jsonl`（真目录 06-08、假目录 06-06）如何处理**？建议：先确认是否已进 `data.db`（06-06 那批可能从未导入），导入后归档/删除。已确认当前 v0.5 代码不再写 JSONL。
4. **是否给 `paths.mjs` 加一次性 stderr 警告**：当走到"探测/指针/假目录"兜底分支时打印"⚠ 开发模式部署，数据目录经兜底解析为 X"，便于发布前确认兜底未被生产触发？
5. **`spaces.json` 双向不可见（§四新发现 2）是否单列 issue**：用户新增/切换语言空间 hook 不可知。F 落地后此问题随之消失（统一目录），但在修复前它是高危。
6. **是否顺手把 `mode.md` 的非原子写改为原子写 / 统一走 `writeConfig()`**（B7）？

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

### 环境变量诊断（✅ 已执行，结论见 §〇.5）

```bash
echo "ROOT=[$CLAUDE_PLUGIN_ROOT]  DATA=[$CLAUDE_PLUGIN_DATA]"
# 本机实测输出：ROOT=[]  DATA=[]    ← 两者皆空，即命令读不到环境变量
```

### 复现"陌生 cwd 崩溃"（B1）

```bash
# 在非插件源码目录里跑任一只读命令的 node 块，模拟真实安装形态：
cd /tmp && node --input-type=module --eval "
const ROOT = process.env.CLAUDE_PLUGIN_ROOT || process.cwd();
await import(ROOT + '/scripts/lib/storage.mjs');
"
# 预期：ERR_MODULE_NOT_FOUND（因为 ROOT 退化成 /tmp，且无环境变量）
```

### 确认 hook 当前写到哪个目录

```bash
# 发一条中文 prompt 触发 hook，然后看哪个 data.db 的 mtime 被更新：
stat -c '%y %n' \
  ~/.claude/plugins/data/my-lingo-skills-dir/my-lingo/data.db \
  ~/.claude/plugins/data/my-lingo/data.db 2>/dev/null
# 本机实测：仅 skills-dir 的 data.db 被刷新 → hook 写真目录
```

> 注：本机两个目录里当前都**没有** `spaces.json`，所以旧版"移走 spaces.json 看 hook 回退"的实验在此环境无对象；hook 写入的 `language_space` 直接来自 `loadSpaces()` 的硬编码默认（english）。

---

## 九、与其他文档的关联

- 路径计算逻辑：见 [`07-storage.md`](./07-storage.md)；本问题揭示该节文档默认假设 "`CLAUDE_PLUGIN_DATA` 总会被设置"在 slash command bash 子进程里不成立。
- 命令实现入口：见 [`03-commands.md`](./03-commands.md)；本问题暴露"内联 `node -e`" vs "import storage.mjs" 两种命令实现风格的运行时差异。
- v0.5 Phase 2.5（只读命令 SQLite 化）：见 [`./development/IMPLEMENTATION_PLAN_V0.5_SQLITE.md`](./development/IMPLEMENTATION_PLAN_V0.5_SQLITE.md)；本问题是该 Phase 的回归补充 —— commit `7ba2ffd` 只缓解了 module-resolution 崩溃（且仅在 `cwd==插件源码` 时有效），**数据目录分裂未被修复，且 16 个命令全部中招**。
- 环境变量配置：见 [`12-env-var-config.md`](./12-env-var-config.md)；建议补充"`CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` 的注入边界"一节，并写明本次实测结论：**两变量在 hook 命令串里经模板展开可用，但在 slash command 的 bash 进程里均不可作为环境变量读取**。
- 命令实现风格统一：见 [`13-raw-prefix-rename.md`](./13-raw-prefix-rename.md) 同期的命令清理思路；本问题暴露当前存在"内联 `node -e` 直读 env" vs "import storage.mjs 经 getDataDir" 两套路径逻辑，建议借修复一并收敛为一套（方案 A 的清理目标）。
