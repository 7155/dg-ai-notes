# 第 2 章：读懂第一个 Agent——核心 API 与三层架构

---

## 一、这章解决什么问题

第 1 章你跑通了 `01-hello.ts`，看到 Agent 输出了一段自我介绍。

但你心里多半还有疑问——代码里那几个 API，到底是什么？

- `ModelRuntime.create()` 究竟读了什么？
- `createAgentSession()` 内部自动做了哪些事？
- `session.subscribe()` 那一堆 `event.type` 判断，什么意思？
- `session.prompt()` 为什么是阻塞的？

这章就把这几个问题讲清楚：先把 12 行代码逐行拆解，再拔高一层，讲清 Pi Agent 的三层核心抽象。

> 关于 `subscribe` 和事件：本章只让你理解"它是订阅事件的入口"。事件有哪些类型、每种怎么用——那是 Web 集成的主场，**第 7 章会系统讲**，这章不展开。

---

## 二、最小示例逐行解读

我们沿用第 1 章那段代码，给它加上详细注释。跳过第 1 章的同学，下面是完整版：

```typescript
import { createAgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();
const available = await modelRuntime.getAvailable();
const model = available.find((m) => m.provider === "zhipu") ?? available[0];

const { session } = await createAgentSession({ model, modelRuntime });

try {
  session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });
  await session.prompt("用一句话介绍你自己。");
} finally {
  session.dispose();
}
```

12 行代码，背后做了 5 件事。下面逐段拆。

### 2.1 导入 SDK

```typescript
import { createAgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
```

整个 SDK，你只需要关心两个入口符号：

- `createAgentSession`：创建 Agent 会话的工厂函数（这是你 90% 时间在用的）；
- `ModelRuntime`：模型与认证的统一管理器（决定 Agent 用哪个 LLM、用哪把 Key）。

`pi-coding-agent` 这个包是 SDK 的「外壳包」——它在 `pi-agent-core`（运行时）和 `pi-ai`（LLM 抽象）之上，封装并导出了一套面向二次开发的入口（`createAgentSession`、`ModelRuntime`、`SessionManager` 等）。**本章示例只需要 import 这一个包。**（需要 `Agent` / `AgentEvent` / `Model` 这类底层类型时，仍要直接引用对应子包——外壳包没有把它们全部重新导出。）

### 2.2 创建 ModelRuntime：加载配置

```typescript
const modelRuntime = await ModelRuntime.create();
```

这一行做了三件事：

1. 读 `~/.pi/agent/auth.json`（如果有）拿到所有 Provider 的 Key；
2. 读 `~/.pi/agent/models.json`（如果有）拿到自定义 Provider 定义；
3. 把内置 Provider（OpenAI / Anthropic / DeepSeek 等）的默认模型定义合并进来。

返回的 `modelRuntime` 对象，其实就是一个「配置仓库」——它**不联网**，只是把配置加载到内存。`await` 是因为读文件是异步操作。

记住「配置仓库」这个比喻，后面你会反复用到它。第 3 章我们讲怎么往这个仓库里**运行时动态注入 Key**（适合多用户场景）、怎么**注册自定义 Provider**（适合接企业内网）。

### 2.3 选模型

```typescript
const available = await modelRuntime.getAvailable();
const model = available.find((m) => m.provider === "zhipu") ?? available[0];
```

`getAvailable()` 会过滤出「真正可用」的模型——也就是**对应 Provider 有 API Key** 的那些。如果你只在 `models.json` 里配了智谱的 Key，那 `available` 数组里就只有智谱的模型，OpenAI 那些内置模型会被过滤掉。（PS为什么作者老是拿智谱举例，不是广告，因为自从他在某次视频上展示了智谱的邀请码，此后就一直被送Token，于是各种测试学习就都使用智谱了……）

`.find(...)` 这一句是「优先选智谱，没有就用第一个」的兜底写法。`??` 是空值合并运算符——只有 `find` 返回 `undefined` 时，才走 `available[0]`。

一个 `model` 对象长这样：

```typescript
{ provider: "zhipu", id: "glm-4-air", name: "GLM-4-Air" }
```

`provider + id` 组合起来，就是模型的唯一标识，后续切换模型、调 API 都用它。

### 2.4 创建会话：createAgentSession 内部做了什么

```typescript
const { session } = await createAgentSession({
  model,
  modelRuntime,        // ① ModelRuntime：管 LLM/Key
  // 下面三个 Runtime 组件不传就用默认值，但要心里有数——后面几章会逐个接管：
  // ② resourceLoader,   默认 DefaultResourceLoader；第 4 章在这里配系统提示词
  // ③ sessionManager,   默认落盘到本地文件（Web 场景要换，见第三节）
  // ④ settingsManager,  默认读 ~/.pi/agent/settings.json
});
```

这是整个 SDK 最关键的调用。`createAgentSession()` 不传参数时用全套默认配置；传参数就按你指定的来——上面代码显式传了 model 和 modelRuntime，**其余三个组件**（resourceLoader / sessionManager / settingsManager）**不传就用默认值**。

它内部自动完成了**五件事**，了解这个清单，比死记 API 有用得多：

```
createAgentSession() 内部：
├── 1. 加载 ModelRuntime（读 auth.json / models.json，合并内置 Provider）
├── 2. 初始化 SettingsManager（读 ~/.pi/agent/settings.json，含压缩策略、retry 等）
├── 3. 初始化 SessionManager（默认把会话持久化到 ~/.pi/agent/sessions/<encoded-cwd>/）
├── 4. 加载 DefaultResourceLoader（发现 skills / extensions / AGENTS.md）
└── 5. 创建 Agent 实例，默认启用四个内置工具：read / bash / edit / write
```

注意第 5 点——**默认只启用 `read`、`bash`、`edit`、`write` 四个工具**。`grep`、`find`、`ls` 这些工具 SDK 也内置了，但默认不启用，需要你显式在 `options.tools` 里列出才会加进去（第 5 章会讲怎么管工具）。

另外，第 3 点的持久化路径值得记一下：默认写到 `~/.pi/agent/sessions/<encoded-cwd>/` 下（`<encoded-cwd>` 是当前工作目录编码后的字符串）。这意味着**不同 cwd 的会话互相隔离**。如果你完全不想落盘，可以传 `SessionManager.inMemory()`——这是 Web 场景的常规做法，第三节会讲清为什么。

这五件事，后续每一件你都能换成自定义实现：第 4 章自定义系统提示词、第 6 章加扩展钩子。本章先用默认值跑通。

返回值是个对象，包含三个字段：`session`（你 90% 时间在用的会话实例）、`extensionsResult`（扩展加载结果，给 UI 层用的）、`modelFallbackMessage`（模型回退时的提示文字）。绝大多数场景你只需要 `session`，所以用 `const { session }` 解构把它取出来就够了。

### 2.5 订阅事件：subscribe

```typescript
session.subscribe((event) => {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});
```

Pi Agent 是**事件驱动**的——Agent 思考、调工具、生成文字，每一步都通过事件推送给你。`subscribe` 就是注册一个监听器，收到事件时跑你写的回调。

这段代码只挑出"文字增量"（`text_delta`）这一种事件，把它打印出来，所以你才看到 Agent 一段段往外吐字。

这里只要记住一点：**`subscribe` 只是注册回调，本身不阻塞**。真正的执行发生在下一行的 `prompt()` 里——这是个常见误解，注意区分。

事件一共有哪些类型、每种里有什么字段、做 Web 服务时怎么用——**第 7 章会专门讲**。本章理解到"`subscribe` 是事件入口、不阻塞"就够了。

### 2.6 发问：prompt

```typescript
await session.prompt("用一句话介绍你自己。");
```

`prompt()` 是**阻塞的**——它会触发 Agent 的 ReAct 循环（思考 → 调工具 → 观察 → 再思考），直到 Agent 回复完才 resolve。这期间所有事件，都会通过你前面 `subscribe` 注册的回调推送过来。

如果你问的是「当前目录有哪些文件」这种需要调工具的问题，Agent 内部会经历这样的循环：

```
prompt("当前目录有哪些文件？")
  ↓
[第 1 轮] LLM 思考 → 决定调 bash 工具（执行 ls）
  ↓
工具返回文件列表
  ↓
[第 2 轮] LLM 根据工具结果生成最终回复
  ↓
prompt() resolve
```

这个「思考 → 行动 → 观察」的循环，就叫 **ReAct 循环**。Agent 框架的核心价值，就是替你跑这个循环——你只管写工具和提示词，循环逻辑都由 SDK 处理。

### 2.7 清理：dispose

```typescript
} finally {
  session.dispose();
}
```

`dispose()` 中止进行中的运行与后台任务（重试 / 压缩 / bash 等）、注销事件监听、失效扩展上下文、清理会话级资源。**这步不能省**，否则可能内存泄漏。

用 `try / finally` 而不是直接在末尾调用，是为了保证即使 `prompt()` 抛异常也能清理。Web 服务里这步尤其重要——一个用户的会话崩了，不能影响下一个用户。

---

## 三、三层核心抽象：Session / Runtime / Tool

12 行代码看完了，但 Pi Agent 的 API 设计哲学还没讲透。

这一节是**拔高**，不是后续实战的必备前提。抽象的东西一开始不容易理解，看不懂可以先跳过，直接进下一章，照样写出能跑的 Agent；等用熟了 API 再回头来看，会更清楚。

它其实就三层抽象。先把这三层和一件你熟悉的事对应一下，再展开。

**打个比方**：把一个 Agent 服务，想成你打电话求助时接线的**客服**。

- 你直接对话的，是**这位客服本人**——你说什么、他答什么，这一来一回就是 **Session**。
- 客服能帮你办事，靠的是公司给他配的一整套**后台支持**：工号权限、能登录的系统、通话软件，还有上岗前发给他的一摞资料——话术手册、技能包、能挂的工具权限。他平时不提，但缺了就干不了活，这一堆是 **Runtime**。
- 他真正动手办事时用的**工具**——查订单、改单、建工单——是 **Tool**。

Pi Agent 也是这么个结构。先看总图，再逐层展开——**而且会标清楚后面每一章在动哪一层**，这是这张图最实际的用处。

```
┌──────────────────────────────────────────────────┐
│ Session（会话）                                   │
│   你和 Agent 的一次对话上下文                      │
│   API: prompt() / subscribe() / dispose()        │
└──────────────────────┬───────────────────────────┘
                       │ 依赖（创建时注入）
        ┌──────────────▼──────────────┐
        │ Runtime（运行时）            │
        │  启动时加载的四个基础设施：   │
        │   - ModelRuntime  管 LLM/Key │
        │   - ResourceLoader 加载资源  │
        │   - SessionManager 管持久化  │
        │   - SettingsManager 管配置   │
        └──────────────┬──────────────┘
                       │ ResourceLoader 加载的扩展，在这里运行
        ┌──────────────▼──────────────┐
        │ ExtensionRuntime（扩展运行时）│
        │   - pi.on(): 挂钩子          │
        │   - pi.registerTool(): 注册工具│
        └──────────────┬──────────────┘
                       │ 工具汇聚到 Agent
        ┌──────────────▼──────────────┐
        │ Tool（工具）                 │
        │   - 内置默认: read/bash/edit/write │
        │   - customTools: 直接传入    │
        │   - 扩展注册: pi.registerTool │
        └─────────────────────────────┘
```

下面逐层展开。

### Session：你唯一直接操作的那一层

Session 是一次连续对话的「容器」——它记住这段对话的上下文：你说过什么、Agent 回过什么、当前进行到哪。

拿到一个 Session 后，整个生命周期就反复做三件事，对应三个方法：

- **`prompt(消息)`**：给 Agent 发一条消息，触发它处理；
- **`subscribe(回调)`**：订阅事件，Agent 处理时的每一步（吐字、调工具、结束）都推给你；
- **`dispose()`**：收摊，释放资源。

就这三个。你 90% 的代码都在和 Session 打交道，但能做的事也就这三件——发消息、看过程、收摊。

两个性质值得记住：

- **一次 Session = 一段独立对话**。多轮记忆靠同一个 Session 持续运转；一旦 dispose 或换了新 Session，上下文就断了。
- **不同 Session 互不相干**。所以 Web 服务里典型做法是**一个用户配一个 Session**，张三的对话不会串进李四那儿（多用户隔离是进阶话题，本教程聚焦单用户）。

顺带一提：**后面第 4~6 章都不在 Session 这层动**。Session 就是你发消息、收过程、收摊的那三个方法，自始至终不变。



### Runtime：Session 背后的四个基础设施

Session 能干活，全靠背后这套「底座」。Runtime 不是一样东西，而是 `createAgentSession` 启动时加载的**四个组件**：

| 组件 | 管什么 | 在本教程里 |
|------|--------|------------|
| **ModelRuntime** | 用哪个 LLM、用哪把 API Key | 第 3 章主场 |
| **ResourceLoader** | 加载资源：系统提示词、扩展、skills、AGENTS.md | 第 4 章主场 |
| **SessionManager** | 对话存哪、怎么存 | 本教程不深入，但持久化有坑（见下）|
| **SettingsManager** | 全局配置：重试、压缩、默认模型… | 本教程不深入，常见配置见下 |

**ResourceLoader**——它管「从磁盘发现并加载一摞资源」：系统提示词、扩展、skills、AGENTS.md 这些上下文文件，都是它读进来的。其中**系统提示词就归它管**——所以第 4 章「配系统提示词」，动的是 ResourceLoader，不是 Session。

**SessionManager**——它管对话的持久化。这一项有个 Web 开发必须分清的场景差异：

- **默认存本地文件，这是 pi-agent 给 CodingAgent 场景设计的**：`createAgentSession()` 不传 SessionManager 时，用的是 `SessionManager.create()`，把对话落到 `~/.pi/agent/sessions/<编码后的工作目录>/`。对 `pi` 命令行工具这种本地、单用户的场景，正好合适。
- **但做 Web 垂直 Agent，一般不这么存**：Web 是多用户、要集中存储的，把对话写到服务器本地文件既不合适也不安全，通常会存进数据库。
- **常规做法是 `SessionManager.inMemory()` + 自己接管存储**：让 SDK 只在内存里跑（不碰本地文件），你再订阅消息事件、把对话写进自己的数据库。具体怎么订阅事件落库，**第 6 章讲扩展时会给方案**（SDK 本身没有内置数据库持久化，得自己写）。

一句话：**默认持久化是 CLI 的设定，做 Web 服务要换成 inMemory 并自己存。**

**SettingsManager**——它管全局配置，从 `~/.pi/agent/settings.json` 读。常见的几项：

- **默认模型**：不指定 model 时用哪个 Provider、哪个模型；
- **自动重试**：LLM 请求失败时重试几次、超时多久（默认开启，最多 3 次）；
- **上下文压缩**：对话太长时怎么压缩历史；
- **thinking level**：模型思考深度的默认值。

这些都有合理的默认值，多数场景不用动。想调的时候改 `settings.json` 即可。**SettingsManager 不是本教程的讲解重点**——能调的项还有很多，需要时自行查 [官方文档](https://pi.dev)。



### ExtensionRuntime：扩展跑起来的地方（第 5、6 章主场）

上面说 ResourceLoader 会「加载扩展」——这些扩展加载进来后，在一个叫 **ExtensionRuntime** 的引擎里运行。这个引擎给你两个能力，恰好对应后面两章：

- **`pi.on("事件", 回调)`**：挂钩子，在 Agent 干活的固定环节塞自己的代码 ← **第 6 章**
- **`pi.registerTool(工具)`**：注册工具 ← **第 5 章自定义工具走这条**

**注意：第 5 章的「定义工具」和第 6 章的「事件钩子」，用的是同一套扩展机制的两个用法。** 你在扩展里 `registerTool(...)` 就是加工具，`on(...)` 就是挂钩子。第 6 章其实是在第 5 章用过的那个 `extensionFactories` 上继续加东西——这点想通了，5、6 两章就不会觉得割裂。



### Tool：Agent 调外部世界的桥梁（第 5 章）

LLM 自己只会「说话」，要读文件、查数据库、调 API，全靠工具。汇聚到 Agent 的工具有**三个来源**：

- **内置默认**：`read`/`bash`/`edit`/`write`（第 1 章你问「当前目录有哪些文件」，Agent 调的就是 `bash`）；另有 `grep`/`find`/`ls` 内置但不默认启用。
- **`customTools` 直接传**：`createAgentSession({ customTools: [...] })`。
- **扩展注册**：在扩展里 `pi.registerTool` 注册 ← **第 5 章自定义工具走这条**。

两个性质：

- **谁来决定用哪个工具？是 Agent 自己。** 它在 ReAct 循环里判断「要不要调工具、调哪个、传什么参数」，你只管注册，剩下交给 Agent。

- **工具定义了 Agent 的能力边界。** 没装查询工具，Agent 就回答不了数据问题（要么说不会，要么瞎编）。所以「给 Agent 装什么工具」基本等于「让它能干什么活」。

  

### 一张图定位：后面每章在动哪里

把总图简化一下，标上章节——它就是你接下来几章的导航：

```
Session      prompt/subscribe/dispose         （第4~6章都不动这里）
   │
Runtime      ModelRuntime   ──────────────── 第3章 接模型
             ResourceLoader(系统提示词/...) ── 第4章 配人设
             SessionManager / SettingsManager（进阶，本教程不展开）
                 │
ExtensionRuntime   pi.on 钩子 ────────────── 第6章 挂事件钩子
                   pi.registerTool ───────── 第5章 注册业务工具
                 │
Tool         内置 / customTools / 扩展注册 ── 第5章 定义工具
```

一句话记住：**第 3 章动 ModelRuntime，第 4 章动 ResourceLoader 里的系统提示词，第 5 章和第 6 章都靠 ExtensionRuntime（一个注册工具、一个挂钩子），第 7 章把 Session 的 subscribe 接到浏览器。** 后面每翻开一章，先回来对照这张图，你就知道自己要动哪里。



---

## 四、自己动手：看一眼 Agent 内部

理论讲完了，动手验证一下。把第 1 章的 `01-hello.ts` 改一行——`subscribe` 里不再过滤，把每个事件的类型都打印出来：

```typescript
session.subscribe((event) => {
  if (event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
    return;
  }
  console.log(`📋 [${event.type}]`);
});

await session.prompt("当前目录有哪些文件？");
```

问一个需要调工具的问题，你会看到事件层面 ReAct 循环的样子：

```
📋 [agent_start]
📋 [turn_start]
📋 [message_start]
📋 [message_update]   ← LLM 决定调 bash
📋 [tool_execution_start]  工具：bash
📋 [tool_execution_end]    工具：bash (成功)
📋 [turn_end]
📋 [turn_start]       ← 第 2 轮
📋 [message_start]

当前目录下有 package.json、 等文件...

📋 [turn_end]
📋 [agent_end]
```

这一眼，你就看清了上一节说的"Agent 在 ReAct 循环里自己调工具"——在事件层面长什么样。每种事件具体什么含义、怎么用在 Web 上，第 7 章会逐一展开。

---

## 结尾

到这里，第 1 章那 12 行代码你应该彻底明白了，也建立起了 Session / Runtime / ExtensionRuntime / Tool 的架构直觉。后面每一章在动哪里，第三节末尾那张导航图已经标清楚了——随时回去对照。

下一章，我们动手配模型（动 ModelRuntime）。

---

## 附录：知识点—源码对照（v0.83.0）

> 本章涉及的 API / 机制，在 `repo/`（v0.83.0 checkout）中的源码位置。**行号会随版本漂移**，定位时以符号名为主、行号为辅。

| 知识点 | 源码位置 | 一句话说明 |
|--------|---------|-----------|
| `createAgentSession` 返回结构 | `sdk.ts:88-95,393-397` | `{ session, extensionsResult, modelFallbackMessage? }`（extensionsResult 非可选） |
| 内部默认「五件事」流程 | `sdk.ts:170-390` | modelRuntime→settingsManager→sessionManager→resourceLoader→Agent，顺序逐字对应 |
| 默认激活工具 | `sdk.ts:245`；`core/tools/index.ts:84` | `[read,bash,edit,write]`；grep/find/ls 内置但不默认激活 |
| 会话持久化路径 | `session-manager.ts:476-489` | `~/.pi/agent/sessions/--<encoded-cwd>--/`（cwd 路径分隔符替换为 `-`，前后加 `--`） |
| SettingsManager 读 settings.json | `settings-manager.ts:195,760-785,813` | 含压缩策略、retry 配置 |
| `ModelRuntime.create()` 不联网 | `model-runtime.ts:135-173` | `allowModelNetwork` 默认不传即 false，不刷新远程目录 |
| `getAvailable()` 过滤 | `model-runtime.ts:242-270,315-330` | 只返回有鉴权的 Provider 的模型 |
| `subscribe` 非阻塞 / `prompt` 阻塞 | `agent-session.ts:800`；`agent/src/agent.ts` | subscribe 仅注册回调 |
| AgentEvent `type` 枚举 | `repo/packages/agent/src/types.ts:422-437`（AgentEvent）；`agent-session.ts:139-181`（AgentSessionEvent 扩展） | agent_start / turn_* / message_* / tool_execution_* / agent_end；agent_settled / compaction_* / auto_retry_* 属于 AgentSessionEvent 扩展 |
| `text_delta.delta` 字段 | `repo/packages/ai/src/types.ts:501-513` | 文本增量字段名就是 `delta` |
| `dispose()` 实际行为 | `agent-session.ts:837-854` | 中止后台任务+注销监听+清资源，**不做持久化写回、不断开连接** |
