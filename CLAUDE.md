# My Lingo — Claude Code 开发指南

## 入口文档

**开始任何开发任务前，请阅读 [`dev_docs/INDEX.md`](./dev_docs/INDEX.md)**

该文档包含：
- 项目完整背景与技术栈
- 所有模块的文档映射（"做 X 时读哪份文档"）
- 核心工作流时序
- 关键决策速查表
- MVP 当前实现状态

## 快速参考

### 项目性质

Claude Code 插件，Node.js ESM，零 npm 依赖，JSONL 存储。

### 最重要的约束

1. **Hook 脚本不能调用 `claude` CLI**（死锁）——只用 `spawnSync('curl', [...])`
2. **不引入任何 npm 包**——只用 `node:fs`、`node:path`、`node:os`、`node:child_process`
3. **JSON 解析必须加 try/catch**——解析失败时安全退出，不崩溃

### 当前任务

项目处于 **v0.1 MVP 实现阶段**。文档体系已完备，代码待从 Phase 0 开始实现。

详见 [`dev_docs/10-mvp-roadmap.md`](./dev_docs/10-mvp-roadmap.md)。

### 参考实现

`claude-english-buddy-ref/`（git-ignored）是可参考的同类项目实现，研究其 `scripts/` 目录中的 hook 模式。

## 文档体系

```
dev_docs/
├── INDEX.md              ← 入口（先读这里）
├── 00-decisions.md       ← 架构决策（遇到"为什么这样做"时查这里）
├── 01-overview.md        ← 产品概述
├── 02-core-concepts.md   ← 语言空间、执行模式、配置层级
├── 03-commands.md        ← 所有 /my-lingo:xxx 命令规格
├── 04-architecture.md    ← 系统架构与数据流
├── 05-hooks.md           ← Hook 实现细节（核心）
├── 06-api-protocol.md    ← 外部 API 设计与 Prompt 规格
├── 07-storage.md         ← JSONL 存储设计
├── 08-plugin-structure.md ← 目录结构与 plugin.json
├── 09-privacy-security.md ← 脱敏规则与安全设计
└── 10-mvp-roadmap.md     ← 实现路线图与验收清单
```
