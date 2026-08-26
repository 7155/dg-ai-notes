# Pi Agent Book

基于 Astro 5 + React 19 + MDX 的双轨电子书，承载 [Pi Agent](https://github.com/earendil-works/pi) 的两套教程。

## 两个系列

电子书用一个 Astro content collection（`modules`）承载两个系列，靠 frontmatter 的 `book` 字段区分：

| 系列 | book 值 | 章节前缀 | 规模 | 语言变体 |
|------|---------|----------|------|----------|
| 🚀 实战上手篇 | `practice` | P01–P08 | **8 章** | TypeScript |
| 🔬 源码精读篇 | `internals` | M01–M10 | 10 章 | TypeScript + Python 双版本 |

- **实战上手篇**：用企业数据分析助手贯穿 P01–P07 的 SDK 二次开发，P08 再把单 Session Web Demo 补成真正的 Runtime 架构：多会话隔离、恢复、分叉与 Runtime 重建。
- **源码精读篇**：系统拆解 SDK 源码设计。每章 TS + Python 双版本，顶栏一键切换。

> 🌐 在线版本：https://dg-ai-notes.pages.dev

---

## 快速开始

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # 生产构建，输出到 dist/
npm run preview
```

**环境要求**：Node.js ≥ 20，任意现代浏览器。

---

## 源内容在哪里

| 内容 | 路径 |
|------|------|
| Web 富内容源 | `src/content/modules/` |
| 实战上手 Markdown | `../pi_sdk_learn/docs/` |
| 实战上手配套代码 | `../pi_sdk_learn/code/` |
| 源码精读 TS Markdown | `../docs/typescript/` |
| 源码精读 Python Markdown | `../docs/python/` |

### 阅读界面操作

| 操作 | 效果 |
|------|------|
| 首页双入口 | 「实战上手」「源码精读」分别进入两系列 |
| 顶栏 TS / Python | 仅源码精读篇显示语言切换 |
| `F` / 沉浸式阅读 | 右栏淡出、正文加宽（宽屏） |
| 左侧 TOC | **按系列隔离**：P01–P08 与 M01–M10 不串台 |
| 右侧 On-This-Page | 当前页面标题大纲 |
| 底部 ← 上章 / 下章 → | **同系列内**按 `displayOrder` 连续阅读 |

---

## 内容系统设计

`src/content/config.ts` 的关键 frontmatter：

```yaml
book: internals | practice
module: M01..M10 | P01..P08
variant: ts | python
displayOrder: <number>
status: published | draft | planned
```

系列隔离由两处共同保证：

```text
frontmatter.book
      ↓
getPublishedModules(book)
      ↓
getAdjacentModules(order, book)
      ↓
TOC / PrevNext 只在自己的系列里移动
```

所以 P08 的 `displayOrder: 8` 不会和 M08 串章。

### P08 的新增桥梁

```text
P07
Browser → Express/SSE → 一个 AgentSession

P08
conversationId
    ↓
Durable Session / Session Tree
    ↓
AgentSessionRuntime
    ↓
AgentSession → Agent → Agent Loop
```

P08 同时有：

- Web MDX：`src/content/modules/pr08-runtime-architecture.mdx`
- Markdown：`../pi_sdk_learn/docs/第8章-Agent服务Runtime架构-从单Session到多会话服务.md`
- 配套代码：`../pi_sdk_learn/code/L08-runtime/08-runtime-lifecycle.ts`

---

## 主要功能

- 三栏阅读布局：左 TOC / 正文 / 右大纲
- 双系列首页与系列内导航
- 源码精读篇 TS/Python 双版本
- Shiki 代码高亮、复制、长代码折叠
- SVG 图表与正文锚点联动
- 构建时统计字数、代码行数与阅读时长

---

## 构建 / 校验

```bash
npm run build
npm run check:counterpart
npm run build:pdf
```

> P08 只有 TypeScript 版，因此不需要 Python counterpart；`book: practice` 的章节也不会参与源码精读篇的语言配对逻辑。

## 许可

代码采用 [MIT License](../../LICENSE)，文档采用 [CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/)。
