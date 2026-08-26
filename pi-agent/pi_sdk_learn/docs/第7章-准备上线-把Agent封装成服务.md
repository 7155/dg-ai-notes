# 第 7 章：准备上线——把 Agent 封装成一个服务

## 一、pi-agent 怎么用起来：四种接入方式

要把 Agent 用起来，最典型的场景是类似 Chatbox 的网页：用户在输入框输入，Agent 在下方回答。这个场景和普通「一问一答」的接口不同，有两个要求：

- **回答需要逐字输出。** 不能让用户等待十几秒后一次性看到全部内容，而要逐段显示。
- **Agent 的处理过程也要实时展示。** Agent 中途会调用工具查询数据，网页上要同步显示「正在查询…」的卡片，查询完成后再填入结果。

这两点决定了要做两件事：把 Agent **封装成一个能被前端调用的 Web 服务**；前端要能**流式接收回答和处理过程**，而不是等待全部完成后一次性返回。本章解决的就是这个问题。

动手之前，先看一个更基础的问题：**pi-agent 提供了几种使用方式？** 翻看源码，答案是四条路径，对应 CLI 的几种「运行模式」，外加一种直接调用库的方式：

| 接入方式 | 怎么用 | 说明 | 跨语言？ |
|---------|--------|--------|--------|
| **交互模式（TUI）** | `pi` 直接打开 | 在终端里交互使用，就是前几章的界面 | — |
| **打印模式** | `pi -p "问题"` 或 `pi --mode json "…"` | 一次性运行：发送一个 prompt，输出结果后退出。适合在脚本或管道中使用 | ✅ 任何语言都能启动进程 |
| **RPC 模式** | `pi --mode rpc` | 无头模式：从 stdin 读取 JSON 命令、向 stdout 输出 JSON 事件。**这是官方为「让其他程序驱动 pi-agent」提供的方式** | ✅ 任何能读写 JSON 的语言 |
| **进程内嵌 SDK** | `import { createAgentSession }` 后直接创建 session | 在自己的 Node 进程中完全控制 Agent，前几章和本章用的就是这种方式 | ❌ 只能用 Node.js |

前两种面向人使用，比较直观。重点说后两种：

**RPC 模式**——它的设计目标是让其他程序接入 pi-agent，`rpc-mode.ts` 开头的注释写得很明确：*「Used for embedding the agent in other applications」*。运行 `pi --mode rpc` 后，它会从 stdin 读取 JSON 命令（`prompt` / `abort` / `get_state` / `get_messages` 等），每收到一条就执行，并把 Agent 产生的所有事件以 JSON 形式输出到 stdout。这种方式适合**宿主程序不是用 Node 写的**情况——例如有一个 Python 后台或 Go 服务要调用 pi-agent，启动一个 RPC 子进程、读写 JSON 即可。代价是多了一个子进程、多了一层进程间通信。

**进程内嵌 SDK**——直接 `import`，在自己的 Node 进程里调用 `createAgentSession()`，拿到 `session` 对象后就能调用 `prompt()`、`subscribe()`、`abort()`。前几章用到的所有能力（`pi.on` 钩子、自定义扩展、`defineTool`）在这里都能继续使用，控制力最强，也最直接。

本章选择**进程内嵌 SDK**：本来就用 Node 写 Web 服务，直接 `import` 最直接，不需要再启动子进程；而且控制力最强，前几章的扩展能力都能继续用。



选定进程内嵌后，还有一个问题：这个 Node 服务提供给谁？两种做法——**只服务自家前端**（最简单，全栈 JS 一条链路），或**封装成独立的 Agent 服务对外开放**（任何语言都能通过 HTTP 调用）。本章采用后者，因为它涵盖了前者，并且能讲清楚「怎么把 pi-agent 对外暴露成一个与语言无关的接口」：

```
┌─────────────────┐   HTTP/SSE    ┌────────────────────┐   HTTP/SSE    ┌──────────────┐
│  Java 后端       │──────────────▶│  Agent 服务（Node）  │◀─────────────│  浏览器前端    │
│  Python 后端     │  POST /chat   │  Express 包一层      │  POST /chat  │  fetch       │
│  Go 后端 …       │◀──────────────│  createAgentSession  │─────────────▶│              │
└─────────────────┘  SSE 推事件    └────────────────────┘  SSE 推事件   └──────────────┘
```

对调用方来说，中间的 Agent 服务就是一个普通的后端 API：发送一个 `POST /chat`，响应就是一条流式事件流。Java 用 OkHttp、Python 用 httpx、浏览器用 fetch 都能调用——**完全不需要了解 pi-agent，那些都是服务内部的事**。

---

## 二、把 DataAgent 接进 Web

### 整体流程

先看一张图，建立全貌：

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器                                                      │
│    ┌────────────────────────────────────────────────┐       │
│    │  对话区：文本气泡（逐字）+ 工具卡片             │       │
│    └────────────────────────────────────────────────┘       │
└─────────┬──────────────────────────────────────▲────────────┘
          │ POST /chat { message }               │ 同一请求的响应体
          │                                      │ = SSE 事件流
          ▼                                      │
┌─────────────────────────────────────────────────┼────────────┐
│  Node.js + Express                              │            │
│                                                 │            │
│   ① session.prompt(msg) ──► Pi Agent 处理       │            │
│                              │ 不断产生事件      │            │
│                              ▼                  │            │
│   ② session.subscribe(event => {                │            │
│        res.write(translateEvent(event));  ──────┘            │
│      })                                                       │
│   ③ finally { res.write(done); res.end(); }                  │
└───────────────────────────────────────────────────────────────┘
```

整条链路只有一个请求：浏览器 POST 一条消息，Node 服务用 `session` 驱动 Agent 处理，Agent 处理时不断产生事件，服务把这些事件翻译后通过同一条连接推回浏览器。**关键角色是 `session`——它既是驱动 Agent 的把手，也是获取 Agent 过程的入口。**

用三步代码走完整个流程。

**第 1 步：组装 DataAgent，拿到 session**

```typescript
// L07-streaming/07a-sse-server.ts
import { createAgentSession, DefaultResourceLoader, getAgentDir,
         ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { queryDataTool } from "../shared/lib/tools/query-data.ts";

// 组装 DataAgent（人设、模型、工具，细节同第 5、6 章）
const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  systemPromptOverride: () => "你是企业数据分析助手。回答必须基于 query_data 工具查到的真实销售数据，不要编造数字。用中文，结论先行，必要时给出明细。",
  extensionFactories: [(pi: any) => { pi.registerTool(queryDataTool); }],
});
await loader.reload();
const modelRuntime = await ModelRuntime.create();
const model = (await modelRuntime.getAvailable())[0];

// ★ 关键：创建会话，拿到 session。后面所有操作都靠它
const { session } = await createAgentSession({
  model, modelRuntime, resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});
```

这一步的关键不是 DataAgent 具体怎么组装（前几章讲过了），而是**拿到 `session`**。

**第 2 步：一个 POST /chat 接口，用 session 干三件事**

```typescript
const app = express();
app.use(express.json());
let busy = false;  // 单用户防并发

app.post("/chat", async (req, res) => {
  const { message } = req.body ?? {};
  if (busy) return res.status(429).json({ error: "Agent 正忙，稍等" });
  busy = true;

  // 设置 SSE 响应头（固定格式，含义见下方「补充：SSE」）
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  // ★ 这个接口用到了 session 的三个能力：
  const off = session.subscribe((event) => {        // ① 收事件：Agent 处理时不断产生事件
    const payload = translateEvent(event);           //    翻译成前端要的格式（见第三节）
    if (payload) res.write(payload);                 //    推给浏览器
  });

  req.on("close", () => { off(); session.abort(); }); // ② 打断：浏览器断开时中止 Agent

  try {
    await session.prompt(message);                   // ③ 发消息：触发 Agent 处理
  } finally {
    res.write(sse("done", {}));                      //    结束时通知前端
    res.end();
    busy = false;
  }
});

app.listen(3000, () => console.log("→ http://localhost:3000"));
```

这个接口把 `session` 的三个能力都用上了：**`subscribe` 收事件、`prompt` 发消息、`abort` 打断**。其中 `subscribe` 是重点——它是 Agent 把处理过程交给前端的通道，第三节展开。

代码里的 `translateEvent` 和 `sse` 是两个辅助函数：接口的响应是 SSE 流，推给前端的数据要按 SSE 格式传输，**`translateEvent` 的作用就是把 `subscribe` 监听到的事件，转换成前端要的 SSE 格式**（具体怎么实现，看仓库代码即可，核心是知道每个事件里有什么字段，第三节会讲）。`sse` 是拼消息的辅助函数。

上面的代码片段省略了仓库中实际代码的几处健壮性处理（避免分散注意力）：`prompt` 抛错时走 `catch` 分支、给前端发一条 `error` 事件而不是让请求挂死；`req.on("close")` 里用 `settled` 标志防止 `prompt` 已结束后重复 `abort`；Express 还通过 `express.static` 托管了前端页面（`public/index.html`）。这些是常规 Web 服务健壮性写法，看仓库代码即可。

讲完这个接口，就得到了一个完整的 Agent 服务接口。给同事（或前端）的接口文档如下：

---

**`POST /chat` — 发送消息，响应是 SSE 事件流**

```bash
curl -N -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "华东地区笔记本卖了多少？"}'
```

`curl -N` 禁用缓冲，可以实时看到流式输出。响应头是 `Content-Type: text/event-stream`，响应体是一条 SSE 流，持续收到以下事件：

| 事件 `type` | `data` | 含义 | 建议客户端处理 |
|--------|--------|------|---------------|
| `text` | `{"delta": "华"}` | 回答的一段文字 | 追加到气泡（逐字显示）|
| `thinking` | `{"delta": "..."}` | 思考的一段 | 追加到可折叠的思考区 |
| `tool_start` | `{"id","name","args"}` | 工具开始执行 | 显示「执行中」卡片 |
| `tool_end` | `{"id","name","result","isError"}` | 工具执行结束 | 更新卡片结果 |
| `done` | `{}` | 彻底结束 | 恢复输入框 |
| `error` | `{"message": "..."}` | Agent 出错 | 显示错误 |

**中断正在运行的 Agent**：直接断开这个请求（关闭连接 / 取消 HTTP 请求）。服务端检测到连接断开会自动调用 `session.abort()`，不需要单独的接口。注意：单用户服务一次只处理一个请求，正在运行时再次发送 `/chat` 会返回 `429 {"error":"Agent 正忙，稍等"}`。

同事拿到这份文档，用自己使用的语言发送 POST、读取响应流、按 `type` 处理即可——**完全不涉及 pi-agent**。

---

**第 3 步：前端调用**

```javascript
// 前端发一个 POST，然后持续读响应流（完整界面代码见仓库 L07-streaming/public/index.html）
const res = await fetch("/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message }),
});
const reader = res.body.getReader();
// ... 逐块读取响应流、更新界面 ...
```

前端做的事就是发一个 POST、然后读响应流，原理和调普通接口一样，区别只是响应流式不断返回。这部分属于前端常规工作，不展开。

运行方式（在 `pi_sdk_learn/code/` 目录下）：

```bash
npx tsx L07-streaming/07a-sse-server.ts
# 浏览器打开 http://localhost:3000
```

### 补充：SSE 是什么

> 这一节是背景知识，了解即可，不影响理解前面的内容。**对 SSE 已经有概念的读者，可以跳过。**

接口响应设了 `text/event-stream` 头，前端用读流的方式接收。这层技术叫 **SSE（Server-Sent Events）**。

一句话：**SSE 就是一个「不关闭」的 HTTP 响应。** 平时写接口，`res.json({...})` 写完后结束并关闭连接，客户端拿到完整结果；SSE 的区别是——**写完后不关闭连接，让它一直挂着，服务器随时可以再 `write` 一段数据，客户端就持续接收。** Agent 的回答是逐字产生的，用这种「不关闭的响应」正好一段段推过去。

响应头要设成固定格式：

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

`text/event-stream` 标识这是 SSE 流；`no-cache` 和 `keep-alive` 防止中间代理缓存或中途断开。客户端（不只是浏览器，Java/Python 的 HTTP 库也一样）看到这个头，就知道按 SSE 方式接收。

为什么用 SSE 不用 WebSocket？判断标准是：需要「服务器向客户端推」还是「双向互推」。Agent 对话属于前者（用户偶尔发、Agent 持续推），用 SSE；WebSocket 是双向的，对 Agent 对话场景偏重，只有像「多人实时协作画板」这种需要双向频繁推送的场景才需要。另外 SSE 基于 HTTP，不需要像 WebSocket 那样单独握手升级，更简单。

> SSE 消息的具体格式属于实现细节，需要时查仓库代码或 SSE 文档即可。这一节只要记住：**SSE 是个不关闭的响应，用来把 Agent 的过程一段段推给前端。**

---

## 三、session.subscribe：拿到 Agent 的处理过程

接口代码里，`session.subscribe` 是核心。这一节展开讲它怎么用、能拿到什么。

先建立一个关键认知，后面所有内容都围绕它：

> **前端需要展示什么，在 `subscribe` 收到的事件里通常都能找到对应。**

也就是说，用 `subscribe` 的思路是「按需取用」——先看前端要展示什么，再去事件里找对应的：

| 前端要展示 | subscribe 里对应的事件 |
|-----------|----------------------|
| 逐字显示回答 | `message_update`（里面有逐段文字）|
| 显示工具调用卡片 | `tool_execution_start` / `tool_execution_end` |
| 显示思考过程 | `message_update`（里面也有思考片段）|
| 知道何时结束 | `prompt()` 结束，或 `agent_settled` 事件 |

理解 pi-agent 在其中的角色：**pi-agent 是「事件源」**——Agent 处理时，每个环节（开始回答、产生一段文字、调用工具、调用结束、本轮结束）都会发出一个事件；**你的代码负责「订阅」**——用 `session.subscribe` 订阅需要的事件，收到后取出数据，交给 `translateEvent` 翻译推送。

第 6 章提到过：`session.subscribe`（外部层）和 `pi.on`（扩展层）能监听的**事件不完全相同**，这里只看 `subscribe` 这一层。它能稳定收到的事件不少，按「Agent 处理的环节」排列，前端常用的有这几个（`turn_*` / `message_start` / `tool_execution_update` / `queue_update` 等也会收到，本章用不到，略过）：

| 环节 | 事件名 | 关键字段 | 用途 |
|------|--------|---------|-----------|
| 一轮开始 | `agent_start` | — | 显示「思考中…」 |
| 文本流出 | `message_update` | `assistantMessageEvent`（嵌套，见下） | **逐字显示回答，核心** |
| 一条消息结束 | `message_end` | `message` | 收尾、统计 token |
| 工具开始执行 | `tool_execution_start` | `toolName`、`args`、`toolCallId` | **显示工具卡片** |
| 工具执行结束 | `tool_execution_end` | `toolName`、`result`、`isError`、`toolCallId` | 更新工具卡片结果 |
| 本轮循环结束 | `agent_end` | `messages`、`willRetry` | 一轮结束（重试时会多发，见下）|
| 彻底结束 | `agent_settled` | — | 终局事件（本例用 `finally`，见下）|

其中 **`message_update` 是逐字显示回答的关键事件**，但它内部还嵌套了一层：`event.assistantMessageEvent` 这个字段的 `type` 决定这段更新的内容类型，常见的有两种——`"text_delta"`（回答正文的一段）和 `"thinking_delta"`（思考过程的一段），内容都在 `.delta` 字段。把收到的所有 `delta` 按顺序拼接，就是完整的回答（或完整的思考）。

再看另外两个常用事件的字段细节，`translateEvent` 翻译时就是从这里取数据：

**`tool_execution_start`**（工具开始执行）：

| 字段 | 含义 |
|------|------|
| `toolCallId` | 本次工具调用的唯一编号——和 `tool_execution_end` 配对，靠它把「开始」和「结束」对应到同一张卡片 |
| `toolName` | 工具名，如 `"query_data"` |
| `args` | 传给工具的参数，如 `{"column": "地区", "operator": "=", "value": "华东"}` |

**`tool_execution_end`**（工具执行结束）：

| 字段 | 含义 |
|------|------|
| `toolCallId` | 配对编号（同 `tool_execution_start`）|
| `toolName` | 工具名 |
| `result` | 工具返回的结果对象——文字内容在 `result.content[0].text` |
| `isError` | 是否执行失败（`true` 时前端把卡片标红）|

关于「何时结束」：接口代码里 `done` 是在 `prompt()` 的 `finally` 里发的，没有去监听 `agent_end` 或 `agent_settled`。原因是 `agent_end` 每轮循环结束都发（Agent 默认开启自动重试，LLM 返回异常时会重试一轮，`agent_end` 就多发一次，还带 `willRetry: true`），用它判断结束会提前恢复输入框；`agent_settled` 虽然是彻底结束的收尾事件、可以用，但在单接口模式下，`prompt()` 这个 Promise 本身就是更直接的终局——它结束时 `agent_settled` 也已经发过了，不如直接用 `finally`。

---

## 结尾

到这里，把 Agent 封装成 Web 服务的核心内容就讲完了。总结一下：

- **整体流程**：组装 DataAgent 拿到 `session` → 接口里用 session 的三个能力（`subscribe` 收事件、`prompt` 发消息、`abort` 打断）→ 前端发 POST、读响应流。
- **SSE**：一个「不关闭」的 HTTP 响应，用来把 Agent 的过程一段段推给前端。
- **核心：`session.subscribe`**：前端要展示什么，在 subscribe 的事件里通常都有对应；订阅这些事件、翻译成前端要的格式推送出去。**这是 pi-agent 在 Web 集成里的关键作用。**

不过，目前的 Agent 服务仍是**单人专用**——一个 `AgentSession`，同一时间只服务一个用户。要支持多用户并发（每人有独立的会话历史、互不影响），需要做会话隔离，这是进阶内容，本教程不展开，可以参考 SDK 官方文档。

回顾整个教程走过的内容：第 1 章跑通第一个 Agent；第 2 章读懂核心架构；第 3 章接入各种模型；第 4 章换上垂直人设；第 5 章给 Agent 装上业务工具；第 6 章挂上事件钩子；第 7 章把事件流推送到浏览器。一个「能调用业务、能挂事件、能流式输出」的 Agent Web 服务，到这里就能搭建起来了。接下来，就是把这些能力应用到实际业务中。

---

## 附录：知识点—源码对照（v0.83.0）

> 本章涉及的 API / 机制，在 `repo/`（v0.83.0 checkout）中的源码位置。**行号会随版本变化**，定位时以符号名为主、行号为辅。

| 知识点 | 源码位置 | 说明 |
|--------|---------|-----------|
| `message_update` 携带 assistantMessageEvent | `repo/packages/agent/src/types.ts:432` | 仅在 assistant 流式期间发送 |
| `text_delta` / `thinking_delta` 变体 | `repo/packages/ai/src/types.ts:504,507` | 两者都有 `delta: string` 字段 |
| 文本增量字段名 `delta` | `ai/src/types.ts:504` | 逐字显示时取这个字段 |
| SSE 桥接 = 教程自写（SDK 无 HTTP/SSE） | `packages/agent`、`packages/coding-agent` 中无 HTTP 服务器代码 | `packages/ai/` 中的 `text/event-stream` 是 LLM provider 消费用途，不是对外提供 SSE 服务；`packages/server` 是 Unix-socket IPC，不是 HTTP |
| 单接口（POST 响应即 SSE 流）= 本章选型 | 教程自定的接口组织方式 | 对比双接口（POST 发 + GET/events 收）：单接口天然一一对应、便于并发，实际项目更常用 |
| `agent_settled` 是 session 层事件 | `agent-session.ts:146,581-589` | core AgentEvent 里查不到，subscribe 能收到 |
| `agent_settled` 在 finally 必发一次 | `agent-session.ts:1061,1071` | 回归测试表明重试时也只发 1 次 |
| `agent_end` 带 `willRetry`（session 层） | `agent-session.ts:142-145,622` | core 层无此字段；重试多轮时多次发送 |
| 默认开启自动重试 | `settings-manager.ts:801,813-819` | `retry.enabled ?? true`，`maxRetries ?? 3` |
| `tool_call`/`tool_result`/`context`/`before_agent_start` 扩展层独有 | `extensions/types.ts:671,700,854,915` | subscribe 收不到，对应的是 tool_execution_start/end |
| `tool_execution_start`/`end` 载荷 | `agent/src/agent-loop.ts:388-392,765-773` | toolCallId / toolName / args / result / isError |
| subscribe 即发即弃 | `agent-session.ts:184,800,548-551` | `_emit` 不 await 监听器 |
| 入口导出 | `index.ts:8,79,152,180,193,206,242` | createAgentSession / ModelRuntime / SessionManager / defineTool 等 |
| 三种运行模式（text/json/rpc）分发 | `cli/args.ts:10`、`main.ts:109-120` | `resolveAppMode()` 按 `--mode` / stdin 是否 TTY 选择 rpc/json/print/interactive |
| RPC 模式 = 无头 stdin/stdout | `modes/rpc/rpc-mode.ts:1-12` | 文件头注释明确写 "Used for embedding the agent in other applications" |
| `RpcClient` 程序化接入 | `modes/rpc/rpc-client.ts` | 启动 `pi --mode rpc` 子进程，把 JSON 命令封装成类型化方法（prompt/abort/onEvent 等）|
| 实验性 `pi-server` 包 | `packages/server/` | Unix socket IPC 管理多个 Agent 实例；README 标注 "Experimental" |
