# 跳过优化前缀：`!raw` → `--`

版本：v0.3 — 2026-06-08

---

## 1. 问题

`!raw` 前缀与 Claude Code 的 `!` 元前缀冲突：Claude Code 在 UI 层将 `!foo` 解释为执行终端命令 `foo`，消息不会进入 `UserPromptSubmit` hook，`!raw` 功能完全失效。

代码中虽有注释"MUST be before shouldSkip"来规避 `shouldSkip` 内部对 `!` 的过滤，但这只解决了 hook 内部的顺序问题，无法解决 Claude Code 在更上层拦截 `!` 的根本冲突。

---

## 2. 解决方案

将跳过优化的前缀改为 `--`：

```
-- implement this in Python
```

**为什么选 `--`：**
- Claude Code 不拦截 `--` 开头的消息
- 不触发 `shouldSkip` 中的任何规则（无需特殊处理顺序）
- 符合 CLI 惯例（`--` 表示"不做解释，原样传递"）
- 与 `::` refine 前缀形成视觉对称

---

## 3. 改动范围

### 3.1 代码文件

| 文件 | 改动 |
|------|------|
| `scripts/user-prompt-submit.mjs` | `startsWith('!raw')` → `startsWith('--')`；`slice(4)` → `slice(2)`；更新注释和 systemMessage |
| `scripts/lib/detect.mjs` | 删除 `shouldSkip` 注释中关于 `!raw` 的说明（`--` 不存在此问题） |
| `scripts/session-end.mjs` | 统计输出中 `!raw` 标签 → `--` |

### 3.2 用户文档

| 文件 | 改动 |
|------|------|
| `README.md` | 功能说明 + 示例代码块中的 `!raw` → `--` |
| `README.zh.md` | 同上中文版 |

### 3.3 开发文档

| 文件 | 改动 |
|------|------|
| `dev_docs/02-core-concepts.md` | 前缀说明 |
| `dev_docs/03-commands.md` | 前缀说明 + 示例 |
| `dev_docs/05-hooks.md` | hook 流程描述、代码示例、前缀表格 |
| `dev_docs/00-decisions.md` | 决策记录中的 `!raw` 引用 |
| `dev_docs/10-mvp-roadmap.md` | roadmap 中的前缀说明 |
| `dev_docs/11-integration-tests.md` | 测试用例名称和描述 |
| `dev_docs/development/IMPLEMENTATION_PLAN_V0.1.md` | 实现计划中的所有引用 |

---

## 4. 行为变化

| 场景 | 旧行为 | 新行为 |
|------|--------|--------|
| `!raw foo` | Claude Code 执行 `raw foo` shell 命令，hook 不触发 | 不变（该前缀不再有意义） |
| `-- foo` | hook 不处理（不匹配任何特殊前缀） | hook 检测到 `--`，跳过优化，透传 `foo` |
| shouldSkip 顺序 | `!raw` 必须在 shouldSkip 之前处理 | `--` 无此约束，顺序灵活 |

---

## 5. 实施顺序

1. `scripts/user-prompt-submit.mjs`
2. `scripts/lib/detect.mjs`
3. `scripts/session-end.mjs`
4. `README.md` + `README.zh.md`
5. `dev_docs/` 各文件（批量替换）
