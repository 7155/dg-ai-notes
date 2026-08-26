# 实战上手篇 · 配套课程代码

> 与《实战上手篇》8 章逐章配套的可运行 TypeScript 示例。每段代码都能 `npx tsx` 直接跑，注释里标了对应章节。

## 前置准备

1. **Node.js ≥ 22.19**（Pi Agent SDK 的硬约束）：
   ```bash
   node --version   # 期望 v22.19.x 或更高
   ```
2. **配置模型**：在 `~/.pi/agent/models.json` 填入你有 Key 的 Provider（详细步骤见 [第 1 章](../docs/第1章-环境部署-10分钟跑通第一个Agent.md)）。
   - 没有用户主目录写权限？用环境变量 `PI_CODING_AGENT_DIR` 指向项目内目录。

## 安装

```bash
cd code
npm install
```

## 逐课运行

8 组代码与实战上手篇 P01–P08 **一一对应**，直接 `npm run <课号>` 运行：

| 课号 | 命令 | 文件 | 对应章节 | 说明 |
|------|------|------|----------|------|
| 01 | `npm run 01` | [L01-env/01-hello.ts](./L01-env/01-hello.ts) | P01 环境部署 | 最小 Agent，跑通环境 |
| 02 | `npm run 02` | [L02-arch/03-express-ask.ts](./L02-arch/03-express-ask.ts) | P02 机制全貌 | Express 里调 Agent |
| 03 | `npm run 03` | [L03-model/03a-model-management.ts](./L03-model/03a-model-management.ts) | P03 模型配置 | 多 Provider 管理 |
| 04a | `npm run 04a` | [L04-prompt/04a-replace-prompt.ts](./L04-prompt/04a-replace-prompt.ts) | P04 系统提示词 | 替换默认人设 |
| 04b | `npm run 04b` | [L04-prompt/04b-layered-prompt.ts](./L04-prompt/04b-layered-prompt.ts) | P04 系统提示词 | 分层提示词 |
| 04c | `npm run 04c` | [L04-prompt/04c-strip-cwd.ts](./L04-prompt/04c-strip-cwd.ts) | P04 系统提示词 | 剥离 cwd 注入 |
| 05a | `npm run 05a` | [L05-tools/05a-query-data.ts](./L05-tools/05a-query-data.ts) | P05 定义工具 | SQL 查询工具 |
| 06a | `npm run 06a` | [L06-extensions/06a-limit-guard.ts](./L06-extensions/06a-limit-guard.ts) | P06 事件监听 | 限流守卫扩展 |
| 06b | `npm run 06b` | [L06-extensions/06b-see-all-events.ts](./L06-extensions/06b-see-all-events.ts) | P06 事件监听 | 打印全部事件 |
| 07 | `npm run 07` | [L07-streaming/07a-sse-server.ts](./L07-streaming/07a-sse-server.ts) | P07 准备上线 | SSE 流式服务 |
| 08 | `npm run 08` | [L08-runtime/08-runtime-lifecycle.ts](./L08-runtime/08-runtime-lifecycle.ts) | P08 Runtime 架构 | Session replacement、重建与重新订阅 |

> 也可不用 npm 脚本，直接 `npx tsx <文件路径>`。

## 特别说明：L07 · SSE 流式服务

[L07-streaming/07a-sse-server.ts](./L07-streaming/07a-sse-server.ts) 启动一个 Express 服务，前端页面在 [L07-streaming/public/index.html](./L07-streaming/public/index.html)。

```bash
npm run 07
# 终端会打印服务地址（如 http://localhost:3000），浏览器打开即可对话
```

## 特别说明：L08 · Runtime 生命周期

[L08-runtime/08-runtime-lifecycle.ts](./L08-runtime/08-runtime-lifecycle.ts) 不重复造一个完整 Web 后端，而是专门验证 P08 最关键的机制：

```text
create AgentSessionRuntime
        ↓
prompt in Session A
        ↓
runtime.newSession()
        ↓
旧 AgentSession dispose
        ↓
新的 AgentSession + cwd-bound services
        ↓
重新 subscribe
```

```bash
npm run 08
```

`conversationId`、认证、数据库映射、per-session lock 属于你的 Serving Layer，所以课程正文用清晰的架构伪代码讲解，而不是偷偷塞进 Pi SDK 的职责里。

## 目录结构

```text
code/
├── L01-env/          # P01 环境部署
├── L02-arch/         # P02 机制全貌（Express 调 Agent）
├── L03-model/        # P03 模型配置（多 Provider 管理）
├── L04-prompt/       # P04 系统提示词
├── L05-tools/        # P05 定义工具（SQL 查询）
├── L06-extensions/   # P06 事件监听 / 扩展
├── L07-streaming/    # P07 SSE 流式服务
├── L08-runtime/      # P08 Session / Runtime 生命周期
├── prompts/analyst/  # DataAgent 分析师人设提示词
└── shared/           # 跨课复用：数据、工具库
```
