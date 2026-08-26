# Pi-Agent 双轨教程

> 两条互补路线学习 [pi-agent](https://github.com/earendil-works/pi)：**实战上手**（从零搭一个能服务真实用户的 Agent）+ **源码精读**（看懂 SDK 与 Runtime 为什么这样设计）。

## 🚀 实战上手篇 · 8 章

用企业数据分析助手 DataAgent 贯穿全程：先跑通 SDK，再配置模型、人设、工具和事件，接着用 Express + SSE 接进 Web，最后在 P08 把单 Session Demo 升级成真正的多会话 Runtime 架构。

> 路径：[pi_sdk_learn/docs/](./pi_sdk_learn/docs/) · 配套代码：[pi_sdk_learn/code/](./pi_sdk_learn/code/) · 在线版：https://dg-ai-notes.pages.dev

| 章节 | 主题 | Markdown |
|------|------|----------|
| P01 | 环境部署 —— 10 分钟跑通第一个 Agent | [📖](./pi_sdk_learn/docs/第1章-环境部署-10分钟跑通第一个Agent.md) |
| P02 | 读懂第一个 Agent —— 核心 API 与架构 | [📖](./pi_sdk_learn/docs/第2章-先看全貌-搞懂pi-agent工作机制.md) |
| P03 | 模型配置关键点 —— 判断企业内网模型能否接入 | [📖](./pi_sdk_learn/docs/第3章-模型配置的关键-判断企业内网能否接入.md) |
| P04 | 系统提示词 —— 必须覆盖默认 Agent 人设 | [📖](./pi_sdk_learn/docs/第4章-系统提示词-必须覆盖默认Agent人设.md) |
| P05 | 定义工具 —— 从功能实现到交互体验 | [📖](./pi_sdk_learn/docs/第5章-定义工具-从功能到交互pi都想到了.md) |
| P06 | 事件监听 —— 实现你的个性化需求 | [📖](./pi_sdk_learn/docs/第6章-事件监听-实现你的个性化需求.md) |
| P07 | 接进 Web —— Express + SSE 流式 Agent 服务 | [📖](./pi_sdk_learn/docs/第7章-准备上线-把Agent封装成服务.md) |
| **P08** | **真正的 Runtime —— 从单 Session 到多会话 Agent 服务** | [📖](./pi_sdk_learn/docs/第8章-Agent服务Runtime架构-从单Session到多会话服务.md) |

> P01–P07 配套代码来自当前实战课程基线；P08 新增 [L08-runtime/08-runtime-lifecycle.ts](./pi_sdk_learn/code/L08-runtime/08-runtime-lifecycle.ts)，专门验证 `AgentSessionRuntime` 的 Session replacement 与重新绑定。

### P08 补上的关键桥梁

```text
P07：Browser → HTTP/SSE → 一个 AgentSession
                         ↓
P08：conversationId → Durable Session / Tree
                         ↓
                   AgentSessionRuntime
                         ↓
                    AgentSession
                         ↓
                       Agent
                         ↓
                    Agent Loop
```

核心原则：**Session 是长期事实源，Agent 是当前活跃 Run 的内存控制器；不要持久化 JavaScript Agent 对象，而要让 Runtime 能从 Session 重建。**

## 📝 学习记录

- [2026-08-26 · 模型调用、工具系统与事件机制](./docs/typescript/学习笔记-2026-08-26-模型调用工具系统与事件机制.md) — M04/M05 追问整理：Tool 执行流水线、Extension Loader、`pi` / `factory`、Operations、`pi.on` vs `subscribe`、事件传播、Coding Agent 消息与 `convertToLlm()`。

## 🔬 源码精读篇 · 10 章

10 章拆解 Pi 的核心源码设计。建议学习顺序：先用实战篇建立 API 手感，再回到这里追 `ai → agent → coding-agent` 的实现边界。

> 🧪 **补充材料**：[notebooks/agent-loop.ipynb](./notebooks/agent-loop.ipynb) 是第 3 章 Agent Loop 的可执行实验场，可以单步运行、改参数、观察 loop 状态。

> 源码精读 Markdown 最初基于 Pi **v0.80.2** 编写，源码链接可能跟随 `main` 演进；实战篇当前依赖 `@earendil-works/pi-* ^0.83.0`。P08 额外区分了 `AgentSessionRuntime` 与当前 `main` 新增的 Generic Agent Harness，避免把不同层混在一起。

```text
M01 开篇总览    →  M02 架构       →  M03 Agent Loop  →  M04 模型调用  →  M05 工具系统
                                                                      ↓
M06 消息系统    →  M07 事件驱动   →  M08 上下文工程  →  M09 上下文压缩 →  M10 会话管理
```

| 章节 | 主题 | TS 版 | Python 版 |
|------|------|-------|-----------|
| M01 | 开篇 - Pi-Agent 框架总览 | [📖](./docs/typescript/第1章-开篇-Pi-Agent框架总览.md) | [🐍](./docs/python/第1章-开篇-Pi-Agent框架总览.md) |
| M02 | 架构 - 项目骨骼 | [📖](./docs/typescript/第2章-三层架构-Pi-Agent项目的骨骼.md) | [🐍](./docs/python/第2章-三层架构-Pi-Agent项目的骨骼.md) |
| M03 | Agent Loop - 模型转动起来的引擎 | [📖](./docs/typescript/第3章-Agent-Loop-让模型转动起来的引擎.md) | [🐍](./docs/python/第3章-Agent-Loop-让模型转动起来的引擎.md) |
| M04 | 模型调用 - 一行代码驾驭多模型 | [📖](./docs/typescript/第4章-模型调用-一行代码驾驭多个模型.md) | [🐍](./docs/python/第4章-模型调用-一行代码驾驭多个模型.md) |
| M05 | 工具系统 - Agent 的手脚如何被管住 | [📖](./docs/typescript/第5章-工具系统-Agent的手脚是怎么被管住的.md) | [🐍](./docs/python/第5章-工具系统-Agent的手脚是怎么被管住的.md) |
| M06 | 消息系统 - Agent 的记忆组织与传递 | [📖](./docs/typescript/第6章-消息系统-Agent的记忆如何组织与传递.md) | [🐍](./docs/python/第6章-消息系统-Agent的记忆如何组织与传递.md) |
| M07 | 事件驱动 - Agent 的神经系统 | [📖](./docs/typescript/第7章-事件驱动-Agent的神经系统.md) | [🐍](./docs/python/第7章-事件驱动-Agent的神经系统.md) |
| M08 | 上下文工程 - 让有限窗口装下无限对话 | [📖](./docs/typescript/第8章-上下文工程-让有限窗口装下无限对话.md) | [🐍](./docs/python/第8章-上下文工程-让有限窗口装下无限对话.md) |
| M09 | 上下文压缩 - 当对话太长怎么办 | [📖](./docs/typescript/第9章-上下文压缩-当对话太长怎么办.md) | [🐍](./docs/python/第9章-上下文压缩-当对话太长怎么办.md) |
| M10 | 会话管理 - 对话的存储恢复与分叉 | [📖](./docs/typescript/第10章-会话管理-对话的存储恢复与分叉.md) | [🐍](./docs/python/第10章-会话管理-对话的存储恢复与分叉.md) |

## 📚 三种阅读方式

| 方式 | 入口 | 适合场景 |
|------|------|----------|
| 🌐 **Web 在线版**（推荐） | https://dg-ai-notes.pages.dev | 双系列切换、目录导航、配图联动 |
| 📥 **Markdown 下载版** | 上表链接 | 配合 AI 边读边问、对照源码 |
| 📕 **PDF 版** | [GitHub Releases](https://github.com/buchidonggua/dg-ai-notes/releases) | 离线阅读、打印、长期存档（源码精读篇） |

## 🚀 本地运行 Web 电子书

```bash
cd web
npm install
npm run dev      # http://localhost:4321
```

详细说明见 [web/README.md](./web/README.md)。

## 📜 License

- 代码：[MIT](../LICENSE)
- 文档：[CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/)
