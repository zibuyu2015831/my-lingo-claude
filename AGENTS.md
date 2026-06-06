# My Lingo — AI 协作指南

本文件面向所有 AI 编程助手（Claude、Cursor、Copilot 等）。

## 快速上手

阅读 [`dev_docs/INDEX.md`](./dev_docs/INDEX.md) 以了解：

- 项目定位与技术栈
- 目录结构与文件职责
- 核心工作流（Hook 路径时序）
- 关键技术决策速查表
- MVP 实现状态与待办阶段
- 涉及具体模块时应阅读哪份详细文档

## 文档导航

| 文档 | 用途 |
|------|------|
| [`dev_docs/INDEX.md`](./dev_docs/INDEX.md) | **入口**，先读这里 |
| [`dev_docs/00-decisions.md`](./dev_docs/00-decisions.md) | 所有关键架构决策的背景与理由 |
| [`dev_docs/05-hooks.md`](./dev_docs/05-hooks.md) | Hook 实现（最复杂的核心模块）|
| [`dev_docs/06-api-protocol.md`](./dev_docs/06-api-protocol.md) | 外部 API 调用与 Prompt 设计 |
| [`dev_docs/10-mvp-roadmap.md`](./dev_docs/10-mvp-roadmap.md) | 当前实现阶段与验收标准 |

## 重要约定

- **不能在 hook 中调用 `claude` CLI**（会死锁），只用 `spawnSync('curl', [...])`
- **零 npm 依赖**，只用 Node.js 标准库
- **JSONL 存储**，不用 SQLite（MVP 阶段）
- 所有脚本使用 `.mjs` 后缀，import 使用 `node:` 前缀
