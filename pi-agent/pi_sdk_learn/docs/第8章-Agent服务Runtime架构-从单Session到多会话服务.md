---
title: 第8章：真正的 Runtime —— 从单 Session 到多会话 Agent 服务
module: P08
displayOrder: 8
status: published
variant: ts
book: practice
summary: 把 P07 的单用户 Demo 升级成真正的 Agent 服务：分清 Session、Agent、AgentSessionRuntime 与服务层的生命周期，完成多会话隔离、恢复、分叉和运行时重建。
prev: pr07-deploy
---

> P07 已经解决了「怎么把 Agent 接进 Web」：`POST /chat`、`session.prompt()`、`session.subscribe()`、SSE 流式返回。
>
> 这一章解决更难、也更接近真实系统的问题：**当用户不止一个、会话不止一条、进程会重启、对话还会分叉时，Agent 到底应该怎么活？**

## 一、为什么 P07 还只是一个单用户 Demo

P07 的核心结构非常适合学习：

```text
Server 启动
   ↓
createAgentSession()
   ↓
得到一个全局 session
   ↓
POST /chat
   ↓
session.prompt()
```

为了避免两个请求同时操作同一个 Session，示例里再加一个全局锁：

```ts
let busy = false;
```

这套结构只有一个问题：**它默认全世界只有一条会话。**

只要进入真实 Web 场景，马上会出现四个问题：

```text
用户 A ─┐
        ├─→ 同一个全局 session ？  → 历史串了
用户 B ─┘

服务器重启
   ↓
内存里的 session / Agent 消失     → 怎么恢复？

用户切到旧消息继续
   ↓
当前 branch 变了                  → 谁负责重建上下文？

1 万个历史会话
   ↓
难道常驻 1 万个 Agent 对象？      → 没必要
```

所以真正的问题已经不是「怎么调用 `prompt()`」，而是：

> **哪些状态必须长期存在？哪些对象只需要在运行时存在？谁负责把长期状态重新装成一个可以运行的 Agent？**

这就是 Runtime 架构。

---

## 二、先分清五层：谁拥有哪一类状态

先不要看 API。把状态归属想清楚，后面的源码会非常自然。

```text
┌──────────────────────────────────────────────────────┐
│ ① Web / Serving Layer                                │
│ userId · conversationId · auth · rate limit · route │
└──────────────────────────┬───────────────────────────┘
                           │ 找到这条会话
                           ▼
┌──────────────────────────────────────────────────────┐
│ ② Durable Session / Session Tree                     │
│ messages · parentId · branch · compaction · config  │
│                ★ 长期事实源                           │
└──────────────────────────┬───────────────────────────┘
                           │ 恢复 / 选分支
                           ▼
┌──────────────────────────────────────────────────────┐
│ ③ AgentSessionRuntime（coding-agent）                 │
│ current AgentSession + cwd-bound services            │
│ new / switch / fork / import / teardown / rebind    │
└──────────────────────────┬───────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────┐
│ ④ AgentSession → Agent                               │
│ prompt / subscribe / model / tools / abort           │
│ Agent：当前 run 的内存控制器                          │
└──────────────────────────┬───────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────┐
│ ⑤ Agent Loop                                         │
│            LLM → Tool → LLM → Tool → ...            │
└──────────────────────────────────────────────────────┘
```

一句话记住：

> **Session 保存“过去发生了什么”；Runtime 决定“现在绑定哪条 Session”；Agent 保存“这一轮怎么跑”；Loop 负责“真的跑起来”。**

### 2.1 Durable Session：长期事实源

它应该回答这些问题：

- 这是谁的哪条会话？
- 历史消息有哪些？
- 当前 branch / leaf 在哪里？
- 每条 Entry 的 `parentId` 是谁？
- 做过哪些 compaction？
- 上次用的模型、思考等级等配置是什么？

这些信息不能只存在 JavaScript 对象里，否则：

```text
Node 进程退出
→ 对象消失
→ 用户的历史也消失
```

所以 Session 的生命周期可以是几天、几个月；**它比任何一个 Agent 实例活得久。**

### 2.2 Agent：当前活跃 Run 的控制器

Agent 更适合保存：

```text
当前 model
当前 tools
当前线性 messages
当前 streamingMessage
AbortController
steering / follow-up queue
listeners
pending tool state
```

这里很多状态只对「正在运行的这一轮」有意义。

因此 Agent 完全可以：

```text
请求到来 → 创建 / 恢复 Agent → 跑完 → 释放
```

也可以在 CLI 这种单用户长进程里一直复用。

**Agent 是否常驻，是 Host 的工程选择，不是会话持久化的前提。**

---

## 三、为什么不能让 Agent 自己管理 Tree、用户和数据库

假设把所有事情都塞进 `Agent`：

```text
Agent
├─ LLM Loop
├─ Tool execution
├─ Session Tree
├─ 数据库
├─ 用户鉴权
├─ conversationId 路由
├─ fork / resume
├─ cwd / resources
└─ HTTP / SSE
```

短期看很方便，长期一定会失控。

因为这些状态的生命周期根本不同：

| 状态 | 生命周期 | 应该属于谁 |
|---|---|---|
| `AbortController` | 一次 Run | Agent |
| 当前 `messages[]` snapshot | 一次活跃 Runtime | Agent |
| Session Tree / parentId | 长期 | Session |
| cwd 对应的工具、资源、Extension | Session Runtime | Coding Agent Runtime |
| `conversationId → session` | 服务长期状态 | Web Serving Layer |
| 用户鉴权、限流 | 请求级 | Web Serving Layer |

所以真正可扩展的设计一定是：

```text
长期状态向下“投影”成短期运行状态

Session Tree
    ↓ build context
messages[]
    ↓ snapshot
Agent Loop
```

而不是让 Loop 反过来拥有整个世界。

---

## 四、为什么还需要 AgentSessionRuntime

这时会冒出一个问题：

> 我已经有 `AgentSession` 了，切会话时直接把 `agent.state.messages` 换掉不就行了吗？

**只换 messages 不够。**

Coding Agent 的一条 Session 不只有聊天记录，它还绑定了当前项目环境：

```text
cwd
├─ ResourceLoader
├─ Settings
├─ Extensions
├─ Tools
├─ Project Trust
└─ SessionManager
```

如果你从项目 A 的 Session 切到项目 B：

```text
messages 换了
但 cwd、工具、Extension 还是 A 的
```

这会直接把两个项目混在一起。

所以 `AgentSessionRuntime` 的职责不是「再包一层 Session」这么简单，而是：

> **当活跃 Session 被替换时，把与它绑定的整套 Runtime 一起安全地拆掉，再按目标 Session 重建。**

它拥有的是：

```text
AgentSessionRuntime
├─ current AgentSession
├─ current cwd-bound services
├─ runtime factory
├─ diagnostics
└─ model fallback info
```

它做的决策主要是：

```text
newSession()       → 新建一条会话
switchSession()    → 恢复另一条会话
fork(entryId)      → 从历史节点创建分支会话
importFromJsonl()  → 导入并切换
```

明确**不归它**的事情：

- 不负责用户鉴权；
- 不负责 HTTP 路由；
- 不决定 `conversationId` 属于哪个用户；
- 不负责 Agent Loop 内部 ToolCall 怎么执行。

---

## 五、源码：一次 Session 替换到底发生什么

当前 Pi 的 `AgentSessionRuntime` 在替换 Session 时，核心流程可以压成：

```text
switch / new / fork
       ↓
1. before-switch hook
       ↓
2. abort 当前 response
       ↓
3. session_shutdown
       ↓
4. dispose 旧 AgentSession
       ↓
5. createRuntime(target cwd, target SessionManager)
       ↓
6. apply(new session + new services)
       ↓
7. rebind UI / listener / extension context
```

源码里的 `teardownCurrent()` 非常值得看：

```ts
private async teardownCurrent(reason, targetSessionFile?) {
  await this.session.abort();
  await emitSessionShutdownEvent(...);
  this.beforeSessionInvalidate?.();
  this.session.dispose();
}
```

然后新 Runtime 创建完成后：

```ts
private apply(result) {
  this._session = result.session;
  this._services = result.services;
  this._diagnostics = result.diagnostics;
  this._modelFallbackMessage = result.modelFallbackMessage;
}
```

这里揭示了一个非常重要的事实：

> **`runtime.session` 是会变的。**

因此你不能这样写完就永远不管：

```ts
const session = runtime.session;
session.subscribe(...);

await runtime.switchSession(...);
// 这里的 session 还是旧对象
```

应该重新绑定：

```ts
let session = runtime.session;
let off = session.subscribe(handleEvent);

await runtime.switchSession(targetPath);

off();
session = runtime.session;
off = session.subscribe(handleEvent);
```

这也是 Runtime 存在的价值：**Session replacement 是一个生命周期动作，不是简单数组赋值。**

---

## 六、`navigateTree()` 和 `runtime.fork()` 不要混

这两个看起来都像「切分支」，但边界不同。

### `session.navigateTree(...)`

在**当前 Session 文件内部**移动当前树位置：

```text
A ─ B ─ C ─ D
        \
         E ─ F

当前 D
  ↓ navigateTree(F)
当前 F
```

还是同一个 `AgentSession` / Session 文件，只是当前上下文路径变了。

### `runtime.fork(entryId)`

从历史节点创建一个**新的分支 Session**，然后替换当前 Runtime：

```text
原 Session
A ─ B ─ C ─ D

      B
      ↓ fork
新 Session
A ─ B ─ E ─ ...
```

所以判断标准是：

> **当前 Session 内导航 → `AgentSession`；要替换整个 Session → `AgentSessionRuntime`。**

---

## 七、把单用户 `/chat` 改成多会话服务

真实服务的 API 不应该只有：

```http
POST /chat
{ "message": "..." }
```

至少需要一个稳定的会话身份：

```http
POST /conversations/:conversationId/messages
```

服务端第一步不是创建 Agent，而是：

```text
conversationId
      ↓
找到它对应的 durable session
      ↓
找到 / 创建当前 Runtime
      ↓
prompt
```

一个最小结构可以是：

```text
用户 A ─→ conversation-A ─→ Runtime A ─→ Session A
用户 B ─→ conversation-B ─→ Runtime B ─→ Session B
用户 C ─→ conversation-C ─→ Runtime C ─→ Session C
```

于是 P07 的：

```ts
let busy = false;
```

应该升级成**每条 conversation 自己的串行化 / lease**：

```text
A 的 Run 正在执行
→ 只阻止 A 同时写 A
→ B 仍然可以正常执行
```

这叫 **per-session single writer**，而不是全局单线程。

---

## 八、`Map<conversationId, Runtime>` 可以有，但它只是缓存

最容易写出的版本是：

```ts
const runtimes = new Map<string, AgentSessionRuntime>();
```

请求来了：

```ts
let runtime = runtimes.get(conversationId);
if (!runtime) {
  runtime = await restoreRuntime(conversationId);
  runtimes.set(conversationId, runtime);
}

await runtime.session.prompt(message);
```

这个思路没问题，但一定要记住：

> **Map 是缓存，不是事实源。**

因为：

```text
Node 重启
↓
Map = 空
```

真正应该能恢复的是：

```text
conversationId
      ↓
Session location / Session id
      ↓
Durable Session Tree
      ↓ hydrate
新的 AgentSessionRuntime
```

于是服务器重启前后：

```text
旧 Agent #A  ──进程退出──> 消失
Session 123                 仍然存在
新 Agent #B  <──恢复────── Session 123
```

`Agent #A !== Agent #B`，但用户看到的是同一条连续对话。

可以把它类比成：

```text
Agent   = 当前值班医生
Session = 病历
```

医生可以换，病历不能丢。

---

## 九、真正的一次 Web 请求应该怎么走

把前面的边界串起来：

```text
POST /conversations/123/messages
        │
        ▼
① Auth：这个用户能访问 123 吗？
        │
        ▼
② Route：123 的 Session 在哪里？
        │
        ▼
③ Lock：取得 conversation-123 的单写锁
        │
        ▼
④ Runtime：命中缓存，或从 Session 恢复
        │
        ▼
⑤ Subscribe：把 AgentSessionEvent 翻译成 SSE
        │
        ▼
⑥ runtime.session.prompt(message)
        │
        ▼
⑦ Session 持久化新的 Entry / 状态
        │
        ▼
⑧ done：释放锁；Runtime 可继续缓存，也可空闲后淘汰
```

浏览器断开时：

```text
HTTP connection close
      ↓
runtime.session.abort()
      ↓
停止当前 Run
```

但已经落盘的 Session 历史仍然保留。

---

## 十、Runtime 到底要不要一直常驻内存

两种策略都合理。

### 方案 A：Session 在线期间常驻

```text
conversation 打开
      ↓
Runtime 常驻
      ↓
prompt #1
prompt #2
prompt #3
      ↓
用户离开 / TTL 到期
      ↓
dispose
```

优点：

- listener 不用反复挂；
- steer / follow-up / abort 很自然；
- 高频聊天少做重复初始化。

适合 CLI、桌面端、小规模服务。

### 方案 B：按需恢复 + 空闲淘汰

```text
请求到来
  ↓
cache miss
  ↓
从 Session 恢复 Runtime
  ↓
run
  ↓
持久化
  ↓
空闲一段时间后 dispose
```

优点：

- 1 万条历史 Session 不等于 1 万个内存 Agent；
- 服务重启天然可恢复；
- 更适合横向扩容。

Web 服务通常更适合：

> **Durable Session 做事实源 + Runtime 做有界缓存 + 每 Session 单写。**

---

## 十一、实际 SDK：怎么创建 AgentSessionRuntime

当前 SDK 提供的标准骨架是：

```ts
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) => {
  // 这些服务与 cwd 绑定：资源、设置、Extension、工具环境等
  const services = await createAgentSessionServices({ cwd });

  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  sessionManager: SessionManager.create(process.cwd()),
});

await runtime.session.prompt("先检查当前项目");
```

现在你拥有的就不只是：

```ts
session.prompt(...)
```

而是一个可以管理 Session replacement 的对象：

```ts
await runtime.newSession();
await runtime.switchSession(sessionPath);
await runtime.fork(entryId);
await runtime.importFromJsonl(filePath);
```

源码入口：

- `packages/coding-agent/src/core/agent-session-runtime.ts`
- `packages/coding-agent/src/core/agent-session-services.ts`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/coding-agent/src/core/session-manager.ts`

---

## 十二、再往下一层：Generic Agent Harness 和它是什么关系

到这里还要防止一个新的混淆：

```text
AgentSessionRuntime ≠ Generic Agent Harness
```

### AgentSessionRuntime（Coding Agent 层）

它知道 Coding Agent 的世界：

```text
cwd
resources
extensions
project trust
AgentSession
SessionManager
```

它解决：

> **Coding Agent 切换 Session 时，如何重建这一整套产品 Runtime？**

### Generic Agent Harness（packages/agent/harness）

当前 Pi `main` 又把更通用的长期运行机制往下抽了一层。它不应该知道 `.pi/`、TUI 或代码项目是什么。

它解决的是：

```text
Durable Session Tree
Lanes
Compaction
Operation state
Queues
Crash recovery
Tool replay policy
Hooks / Events
Usage ledger
Storage transactions
```

所以边界可以画成：

```text
                    Generic Agent Harness
                  /          |            \
          Coding Agent   Browser Agent   Slack Agent
               │
               ▼
      AgentSessionRuntime
     （coding 产品的 Session 替换）
               │
               ▼
       Web Serving Layer
（user / conversation / HTTP / auth / route）
```

注意：Harness 是当前 `main` 更进一步的通用 Runtime 设计；P01–P07 使用的 Coding Agent SDK 仍然可以直接通过 `AgentSession` / `AgentSessionRuntime` 学习和开发。

### 为什么 Harness 不能直接等于 Web Serving Layer？

因为 Harness 不应该知道：

```text
JWT 是什么
用户套餐是什么
HTTP 429 怎么返回
conversationId 的 URL 怎么设计
这个 Session 应该路由到哪台机器
```

这些是你的产品/基础设施决策。

反过来 Serving Layer 也不应该自己实现：

```text
ToolCall 生命周期
Compaction
Tree context
Crash-safe operation state
```

这些才是 Agent Runtime 的共性。

---

## 十三、模型和工具切换放在哪里

你前面已经用过：

```ts
await session.setModel(model);
```

工具也可以由 Coding Agent 的 resource / extension / tool registry 更新，再反映到 Agent 当前状态。

关键不是「能不能改」，而是**什么时候生效最安全**：

```text
长期 Runtime state
      ↓
开始一次 Run
      ↓
Agent 创建 context snapshot
      ↓
Agent Loop 执行
```

因此运行中不要随意把正在执行的 ToolCall 脚下的工具抽走。

更稳妥的原则：

> **模型、工具、system prompt 等动态配置，在 Run / Turn 的安全边界更新，让下一份 snapshot 使用新配置。**

---

## 十四、从 Demo 到真正服务，至少补这几条防线

现在可以把 P07 的「上线」补完整了：

- **身份与隔离**：`userId → conversationId` 权限校验，绝不能只相信前端传来的 id。
- **每 Session 单写**：不要用全局 `busy`；锁粒度至少落到 conversation/session。
- **持久化**：内存 Map 只能做 cache；必须能在进程重启后恢复 Session。
- **中断**：客户端断开后 abort 当前 Run，避免模型和工具继续白跑。
- **SSE 健壮性**：heartbeat、代理层关闭 buffering、处理 backpressure。
- **超时与限流**：请求超时、provider timeout、每用户并发与额度控制。
- **Tool 安全边界**：文件、Shell、网络、凭证权限不要因为“模型调用”就默认放开。
- **可观测性**：记录 sessionId / runId / tool / provider latency / token / cost / error。
- **优雅关闭**：服务退出前停止接新请求，abort/settle 活跃 Run，再 dispose Runtime。
- **多机路由**：如果一条 Session 同一时间只允许一个 writer，Serving Layer 必须保证同一 Session 被路由到正确 owner/worker。

这些不是 Agent Loop 的职责，却决定你的 Agent 能不能成为真正的服务。

---

## 十五、最后把整章压成一张图

```text
                        ┌──────────────────────┐
                        │      Browser / App   │
                        └──────────┬───────────┘
                                   │ conversationId
                                   ▼
┌─────────────────────────────────────────────────────────┐
│ Serving Layer                                            │
│ auth · route · per-session lock · SSE · runtime cache   │
└───────────────────────────┬─────────────────────────────┘
                            │ resolve / restore
                            ▼
┌─────────────────────────────────────────────────────────┐
│ Durable Session                                          │
│ Tree · parentId · branch · compaction · config · facts  │
└───────────────────────────┬─────────────────────────────┘
                            │ hydrate / replacement
                            ▼
┌─────────────────────────────────────────────────────────┐
│ AgentSessionRuntime                                      │
│ current session · cwd services · new/switch/fork/import │
└───────────────────────────┬─────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│ AgentSession → Agent → Agent Loop                        │
│ prompt/subscribe       model ↔ tools ↔ events           │
└─────────────────────────────────────────────────────────┘
```

一句话收尾：

> **不要持久化 Agent 对象；持久化 Session。请求到来时，把 Session 恢复成 Runtime，再让 Agent 跑这一轮。**

这就是从「能聊天的 Demo」走向「可恢复、可分叉、可多用户承载的 Agent 服务」最核心的架构跃迁。

---

## 练习题

1. P07 的全局 `busy` 为什么在多用户场景下不成立？应该把锁缩到什么粒度？
2. Node 进程突然退出时，`Agent`、`AbortController`、Session Tree、`conversationId → session` 映射中，哪些必须能恢复？哪些可以直接重建？
3. `session.navigateTree(entryId)` 与 `runtime.fork(entryId)` 的边界是什么？为什么后者需要 replacement lifecycle？
4. 为什么 `Map<conversationId, AgentSessionRuntime>` 只能叫 Runtime Cache，不能叫 Session Store？
5. 假设服务有 10 万条历史会话、同时只有 50 条活跃，你会让多少个 Runtime 常驻？设计一个简单的 TTL 淘汰策略。
6. **动手题**：把 P07 的 `/chat` 改成 `/conversations/:id/messages`，将全局 `busy` 改成 per-conversation lock；即使先继续使用本地 `SessionManager`，也要保证 A、B 两条会话不会互相串历史。

## 源码继续读

建议按这个顺序：

```text
coding-agent/docs/sdk.md
        ↓
agent-session-runtime.ts
        ↓
agent-session.ts
        ↓
session-manager.ts
        ↓
packages/agent/docs/harness.md   ← 再看当前 main 的通用 durable runtime
```

读源码时始终追问两个问题：

> **这个状态是谁的事实？**
>
> **这个对象挂掉以后，下一次能不能从事实重新构造出来？**
