# 第 5 章：定义工具——从功能实现到交互体验，pi 都想到了

## 一、pi-agent 的工具系统，好在哪里

先打破一个常见错觉：「让 AI 调接口嘛，function calling，一行代码的事。」

function calling 的**概念**确实不难——你定义一个 JSON 描述工具，大模型自己决定调哪个函数、传什么参数，你这边代码跑完把结果塞回去。听着很清爽。

但真上手写，你会发现「让 AI 调函数」本身只占工作量的 10%。剩下 90% 全是繁琐重复的活：

- LLM 该传数字的，给你传个字符串，你得自己写校验；
- 数据库挂了，你得自己 try/catch；
- 用户嫌慢中途想取消，你得自己搭一套取消机制；
- 每个工具还要打日志、要审计、要拦危险操作……

这些活每个项目都得来一遍，重复、无趣，还容易出 bug。

pi-agent 做的事，就是把这 90% 的繁琐活全接管了。你只管写 `execute` 里那一小部分业务逻辑，周边的事框架兜着。

具体好在哪？五个亮点，整理成一张表：

| 亮点 | 没框架时你要自己干 | pi-agent 帮你做了 |
|------|---------------------|-------------------|
| **`execute` 参数把上下文一次给全** | 自己到处传 userId、取消信号、工作目录、打日志 | 5 个参数拿全：校验好的参数、取消信号、进度回调、调用 ID、运行时环境（模型/目录/会话） |
| **参数校验自动做** | 在 execute 里手写 `if (typeof x !== 'number')` | 你写 Schema，框架校验，错了自动告诉 LLM |
| **错误处理框架兜底** | try/catch 包一切，throw 了程序崩 | throw 也不崩，框架自动把错误返回给 LLM |
| **工具调用全过程可编排** | 在每个工具里复制粘贴日志/拦截代码 | 事件钩子统一处理（第 6 章详讲） |
| **工具好管理** | 手工维护工具列表、可见性 | 注册注入 / 白名单控制 / 文件拆分 |

其中第一个亮点——`execute` 参数——尤其值得展开：一个工具函数能拿到的上下文（参数、取消信号、进度回调、运行时环境），框架全通过 5 个参数提供给你，各种业务场景都能接得上。后面会逐个拆开讲。

本章重点讲自定义工具怎么写，事件钩子（亮点第四项）是第 6 章的重点，这里先不讲。

### 顺带认识内置工具（做垂直基本用不上）

pi-agent 自带 7 个通用工具，覆盖了「读写文件 + 执行命令 + 搜索」——但这些都是给**命令行编程助手**准备的，做垂直智能体基本用不上，你只需知道它们存在、到时候会藏。先扫一眼清单：

| 工具 | 能干什么 | 默认启用 |
|------|---------|---------|
| `read` | 读文件内容（支持分页） | 是 |
| `bash` | 执行 shell 命令 | 是 |
| `write` | 写文件 | 是 |
| `edit` | 编辑文件（精确文本替换） | 是 |
| `grep` | 在文件中搜索（正则） | 否 |
| `find` | 查找文件（通配符） | 否 |
| `ls` | 列出目录内容 | 否 |

你要做的是垂直智能体，对这默认开着的 4 个要留意：它们能力都不小，而且其中 3 个能改你的文件系统。

什么意思？`bash`、`write`、`edit` 这三个，能直接改你的文件系统；`bash` 更危险，能执行任意命令。对你业务没用还是小事，有安全风险才是大事。

所以做垂直智能体的第一件事，往往不是「加工具」，而是「藏工具」。把用不上的内置工具先藏起来（方法后面讲），只留确实要用的。

下面进入正题：怎么写你自己的工具。

---

## 二、先跑通一个最小工具

学东西的顺序我有个建议：先跑通，再回头理解概念。跑起来了你才有感觉，有感觉了再看概念就不慌。

下面是 DataAgent 的第一个工具 `query_data`，查销售数据的。新建 `L05-tools/05a-query-data.ts`（完整代码看那个文件，这里我只贴核心，`querySales` 是个读 CSV 的辅助函数，略）：

```typescript
import { Type } from "typebox";
import { createAgentSession, defineTool, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

// querySales：读 sales.csv + 按条件过滤（数据访问细节，完整实现见 05a-query-data.ts）
function querySales(column: string, operator: string, value: string, limit = 20) { /* ... */ }

// ═════════ ① 说明书：告诉 LLM 这工具干什么、怎么调 ═════════
const queryDataTool = defineTool({
  name: "query_data",
  label: "查询销售数据",
  description: "查询销售数据（sales.csv）。按指定列的条件过滤，返回匹配的行。字段：日期、产品、地区、销售额、数量、销售人员。",
  parameters: Type.Object({
    column: Type.String({ description: "要过滤的列名，如：地区、产品、销售人员、销售额" }),
    operator: Type.Union(
      [Type.Literal("="), Type.Literal("!="), Type.Literal(">"), Type.Literal("<"),
       Type.Literal(">="), Type.Literal("<="), Type.Literal("contains")],
      { description: "比较运算符：= != > < >= <= contains" },
    ),
    value: Type.String({ description: "过滤条件的值" }),
    limit: Type.Optional(Type.Number({ description: "最多返回行数，默认 20" })),
  }),

  // ═════════ ② 干活：params 已被框架校验好，直接取用 ═════════
  async execute(_id, params) {
    const text = querySales(params.column, params.operator, params.value, params.limit);
    return { content: [{ type: "text", text }], details: {} };
  },
});

// ═════════ ③ 注册 + 运行：把工具塞给会话，问个问题 ═════════
const modelRuntime = await ModelRuntime.create();
const model = (await modelRuntime.getAvailable())[0];
if (!model) throw new Error("没有可用模型，请检查 ~/.pi/agent/models.json");

const { session } = await createAgentSession({
  model, modelRuntime,
  customTools: [queryDataTool],     // ★ 注入自定义工具
  sessionManager: SessionManager.inMemory(),
});

try {
  session.subscribe((event) => {
    if (event.type === "tool_execution_start") console.log(`🔧 调用工具：${event.toolName}`);
    else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta")
      process.stdout.write(event.assistantMessageEvent.delta);
  });
  console.log("💬 问：华东地区一共多少销售额？\n");
  await session.prompt("华东地区一共多少销售额？");
  console.log("\n");
} finally {
  session.dispose();
}
```

运行（在 `pi_sdk_learn/code/` 目录下）：`npx tsx L05-tools/05a-query-data.ts`。

你会看到一个挺神奇的过程：Agent 自己跑去调 `query_data`，传 `column="地区", operator="=", value="华东"`，拿到华东那几行数据，自己加出个销售额总和，最后用通俗的话回答你。

「华东」这个参数值，是 LLM 自己从你的问题里提取出来的。它读懂了「华东地区」对应 `value="华东"`，你什么都没做，是它自己判断出来的。

这就是它的工作方式——Agent 自己决定调工具、自己从你的问题里提取出参数，你什么都没做。机制其实就这么简单。

回过头看，这个例子里你到底写了什么？就三件事：

1. **说明书**（name + label + description + parameters）：告诉 LLM 这工具是干什么的、怎么调
2. **干活代码**（execute）：你的业务逻辑
3. **注册**（customTools）：把工具塞给会话

前两件事，都写在一个 `defineTool({...})` 里。`defineTool` 是 pi-agent 给的工具定义函数——你把"说明书"和"干活代码"填进去，它打包成一个工具对象，框架只认这个对象。**一次 `defineTool` 调用 = 一个工具**。第三件事的"注册"，就是把这个工具对象塞给会话。

至于参数校验、错误处理、结果传回 LLM、LLM 重试，这些你一行都没写，框架全做了。

下面把这三件事逐个讲清楚。

---

## 三、一个工具的三件事：说明书、干活、框架兜底

### 3.1 说明书：name / label / description / parameters

这几个字段，是写给谁看的？name 和 description 写给 LLM，label 写给 UI。

先说 **`label`**——它是工具在界面上显示的人话名字。`name` 是程序用的标识符（`query_data`），`label` 是给人看的标题（`查询销售数据`）。源码里 `label` 是必填字段，不填会编译报错。

再说 **`name`** 和 **`description`**——这两个是写给 LLM 的。它就靠这两个字段，决定「这工具我该不该调、参数传什么」。

这里面，**`description` 是最值得你花时间打磨的字段**。真的，别图省事。

写得好，LLM 该调的时候精准调用；写得烂，LLM 要么该调不调，要么不该调的时候乱调。怎么写好？三个要点：

- **说清能干什么**：`查询销售数据` 就比 `数据工具` 强
- **说清什么时候用**：`需要查销售数据时调用` 就比 `用于查询` 强
- **把边界划清楚**：`仅支持 SELECT 查询，不能修改数据` 这种，能避免误用

`parameters` 呢，用 TypeBox 定义。TypeBox 是什么？其实就是一个数据结构定义库，跟 Python 里的 Pydantic 一个意思。你用它写个 Schema，框架拿这个 Schema 做两件事：

1. 转成 JSON Schema 发给 LLM：LLM 看着它决定每个参数填什么值
2. 运行时校验 LLM 传来的参数：不合法就由框架挡掉

最常用的几种类型，我直接贴代码：

```typescript
Type.Object({
  name: Type.String({ description: "用户名" }),              // 字符串
  age: Type.Number({ description: "年龄" }),                 // 数字
  status: Type.Union(                                        // 枚举（固定值选一个）
    [Type.Literal("active"), Type.Literal("inactive")],
    { description: "账户状态" },
  ),
  limit: Type.Optional(Type.Number({ description: "返回行数" })),  // 可选
  tags: Type.Array(Type.String(), { description: "标签列表" }),    // 数组
})
```

推荐用 TypeBox（不强制，你手写 JSON Schema 也行）。用 TypeBox 还有个额外好处：附带 TypeScript 类型提示。你写 `Type.String()`，execute 里的 `params.column` 就自动是 `string`，字段名写错了编译期就能报出来。

一次定义，处处受益。

---

### 3.2 干活：execute，以及框架在背后替你做了什么

execute 是你的业务代码。签名长这样：

```
async execute(toolCallId, params, signal, onUpdate, ctx) { ... }
```

5 个参数。看着多，其实按「解决什么问题」分成几组，一下就清楚了：

| 参数 | 解决什么问题 |
|---|---|
| `params` | 工具靠什么输入来干活 |
| `signal` / `onUpdate` | 长任务下，让用户**能取消、看得到进度**——这两个专门提升用户体验 |
| `ctx` | 工具运行的环境和能力从哪来（目录、模型、会话……）|
| `toolCallId` | 给"这次调用"一个唯一标识 |

其中 `params` 几乎每个工具都用，重点先讲它。`signal` 和 `onUpdate` 是一对，都只为"慢任务"服务——查个大数据库、调个慢接口，用户干等着难受，这两个就派上用场了，后面逐个讲。`ctx` 和 `toolCallId` 用到再说。

下面我逐个拆。先说最重要那个 `params`。

---

#### params：LLM 传来的参数，框架已经帮你校验过了

`params` 是个普通对象，结构就是你前面 `parameters` 里定义的那个 Schema 的实例——字段名一一对应，值是 LLM 从用户的问话里提炼出来的。还是 query_data：

```typescript
async execute(_id, params) {
  // params 的字段就是你上面 parameters 里定义的 name
  // 框架已校验过类型，这里直接用，不用担心 column 不是字符串
  const { column, operator, value, limit } = params;
  // ... 用这几个值查数据
}
```

一句话：**`params` 的字段名 = 你 `parameters` 里定义的键名**，框架把 LLM 传的值按这个名字塞进去，你只管取、只管用。

**注意：你拿到的 params，一定是合法的。**

为什么？因为框架在调你的 execute 之前，已经用你写的 TypeBox Schema 把它校验过了。

那如果 LLM 传错了呢？比如该传数字的，给你传个字符串 `"abc"`，会怎样？

```mermaid
flowchart TD
    A["LLM 传错参数<br/>column = 123（应为字符串）"] --> B["框架用你的 Schema 校验"]
    B --> C{"合法？"}
    C -->|不合法| D["把错误返回给 LLM<br/>不调用你的 execute"]
    D -.重试.-> A
    C -->|合法| E["调用你的 execute"]
```

可以看到：你的 execute 根本不会被调用。

框架会自动把「参数类型错误：column 应为 string」塞回给 LLM，LLM 自己改对参数，重新来一遍。改对了，才会调用你的 execute。

**所以你在 execute 里，一行校验代码都不用写。** 类型对不对、参数合不合法这些事，框架全替你处理了。

这是 pi-agent 相比直接用 function calling，最省心的地方。

顺便说一下 execute 的**返回值**。你看到示例里返回的是 `{ content: [...], details: {} }`：

- **`content`**：发给 LLM 的内容数组。最常用的就是 `{ type: "text", text: "结果文本" }`。框架把这个数组发给 LLM，LLM 拿到的是工具的"回答"。
- **`details`**：给日志和 UI 用的结构化数据，LLM 看不到它。绝大多数工具留空对象 `{}` 就行。它是**必填字段**（源码里没有 `?`），不填会类型报错。

所以最小返回值就是：`return { content: [{ type: "text", text: "你的结果" }], details: {} }`。

---

#### signal：框架给的取消信号

先想清楚一个场景：用户在前端点了「停止」按钮，这个"停止"是怎么一路传到你工具的请求里、把它掐断的？链路是这样：

```
用户点「停止」（前端）
  → session.abort()
  → 框架触发一个取消信号
  → 作为第三个参数传进 execute(signal)
  → 你把它透传给 fetch / mysql2，请求立刻断
```

`signal` 做的就是这件事：通知你"这次调用该中断了"。怎么用？你的工具要发外部请求，把它透传给请求库就行：

```typescript
async execute(_id, params, signal) {
  // 把 signal 接到 fetch 上——用户中断时请求立刻断
  const res = await fetch("https://api.example.com/data", { signal });
  return { content: [{ type: "text", text: await res.text() }] };
}
```

`fetch`、`mysql2`、`axios` 这些主流库，都支持 `signal` 参数。

不用纠结 signal 内部是什么对象，只要知道：框架一收到中断，它就会触发；你把它接到外部请求上，请求就会立刻断开。

不接外部请求的工具（纯计算那种），忽略它就行。

> **超时控制是进阶用法，看不懂可以先跳过**：绝大多数工具用框架自带的 `signal`（就是上面那段）就够了。等哪天你的工具真的需要「最多等 5 秒」这种限制，再回来看这块。

超时的思路其实很简单：再建一个「N 秒后自动触发」的信号，跟框架的 `signal` 合并一下，谁先触发都算中断。用到两个浏览器内置 API：

- `AbortSignal.timeout(5000)`：5 秒后自动触发的信号
- `AbortSignal.any([signal, timeout])`：把两个信号合成一个

```typescript
async execute(_id, params, signal) {
  const timeout = AbortSignal.timeout(5_000);          // 5 秒后自动触发
  const combined = AbortSignal.any([signal, timeout]); // 和框架的 signal 合并：谁先触发都断
  const res = await fetch(url, { signal: combined });
  // ...
}
```

把合并后的 `combined` 接到 fetch 上，用户中断也好，超时也好，请求都会立刻断。错误处理（try/catch）的事，后面再说。

---

#### onUpdate：给用户报进度

工具执行可能很慢。等待那段时间，用户什么都看不到，不知道工具跑到哪一步了，只能干等。

`onUpdate` 就是框架提供的一个回调函数。长任务里你调它，报一下进度。它的参数跟 execute 的返回值结构一样——是个包含 `content` 和 `details` 的对象（就是 `AgentToolResult`）：

```typescript
async execute(_id, params, _signal, onUpdate) {
  const items = await loadItems();
  for (let i = 0; i < items.length; i++) {
    await process(items[i]);
    if (i % 100 === 0) {
      onUpdate({                                    // 报进度：传 AgentToolResult 对象
        content: [{ type: "text", text: `已处理 ${i}/${items.length}...` }],
        details: {},
      });
    }
  }
  return { content: [{ type: "text", text: "全部处理完成" }], details: {} };
}
```

你调 `onUpdate` 之后，到底发生了什么？

它会发出一个 `tool_execution_update` 事件，跟你前面用 `session.subscribe(...)` 订阅的那套事件，是同一个机制：

```
你的工具调 onUpdate({ content: [{ type: "text", text: "已处理 50%..." }], details: {} })
  → 框架发出 tool_execution_update 事件
  → 谁订阅了 session 的事件流，谁就能拿到这段进度文本
  → 前端拿到后渲染成「正在处理...已处理 50%...」
```

至于「前端怎么订阅事件流、怎么渲染」，那是**第 7 章（流式输出与 SSE）**的内容。

这章你只要知道：**`onUpdate` 报的进度，会变成事件流里的一条，前端收得到**。绝大多数业务工具用不上它，知道有这个方法就行。

---

#### 另外两个参数

- **`toolCallId`**：这次调用的唯一 ID。绝大多数业务工具用不上，主要给两类场景：把这次调用跟日志/监控系统关联起来；或者像 pi 自带的子 agent 工具那样，用它派生一个确定的子任务 ID。
- **`ctx`**：运行时环境，提供一组能力。常用到的有：`ctx.cwd`（当前目录，做文件工具时用它解析路径）、`ctx.ui`（能在工具执行中途向用户弹窗确认/选择）、`ctx.sessionManager`（读历史对话、拿会话 ID）、`ctx.model`（当前模型）、`ctx.abort()`（直接中止整个 agent）。另外 `ctx.signal` 跟上面讲的第三个参数 `signal` 是同一个东西的两个出口。

execute 这 5 个参数，常用程度差别很大。记不住正常，用到的时候回来翻这张表：

| 参数 | 是什么 | 多常用 |
|---|---|---|
| `params` | LLM 传来的参数（已校验）| ★★★ 几乎每个工具都用 |
| `signal` | 取消信号，接外部请求 | ★★ 调 API / 查库才用 |
| `onUpdate` | 给用户报进度 | ★ 长任务才用 |
| `ctx` | 运行环境与能力（目录/UI/会话/模型）| ★★ 看需求，文件工具、危险操作、读历史会用到 |
| `toolCallId` | 本次调用唯一 ID | ☆ 业务基本不用；审计/派生 ID 才用 |

---

### 3.3 工具出错了怎么办

工具执行难免出错——数据库连不上、API 超时、文件不存在，都是常事。出错后关键就一条：**把错误信息返回给模型，模型会自己决定下一步**（换参数重试、换个思路、或如实告诉用户）。

返回错误时，尽量按错误类型把话说清楚——**为什么错了、怎么改**——模型才能少走弯路。比如别只回一句"查询失败"，告诉它"表不存在，库里只有 sales、products、users"，它马上就知道换表名。

如果一时梳理不出有哪些错误，也没关系：**原样把错误信息返回就行，框架会兜底**。下面分两层讲。

#### 首先：框架兜底，不会崩

你在 execute 里**抛出异常**（`throw new Error(...)`），pi-agent 会自动捕获，把它当成一条带 `isError: true` 的结果发给 LLM。**你的程序绝不会因为工具报了个错就整个崩掉。**

```
execute 里 throw new Error("连接超时")
  → 框架捕获，转成结果：{ content: "连接超时", isError: true }
  → 当作正常的工具结果发给 LLM
  → LLM 看到「连接超时」，决定下一步怎么办
```

这是底线：你什么都不做，工具也不会让整个 Agent 崩掉。

#### 但兜底只是基础：错误信息自己组织，效果更好

框架兜底给你的，只是异常对象上那句 `error.message`——干巴巴的「连接超时」或「ECONNREFUSED」。LLM 看到这种，往往不知道哪错了、更不知道怎么修。

更好的做法：你在 execute 里自己 `catch` 住异常，组织一条 LLM 能看懂的错误信息，**再抛出异常**。框架捕获后，会拿你这条信息当 content、标上 `isError: true` 发给 LLM（就是上一节那张链路）。注意是抛异常，**不是** `return { content, isError: true }`：

```typescript
async execute(_id, params) {
  try {
    return await queryDB(params.sql);
  } catch (err: any) {
    // 不把原始异常直接抛，而是抛一条 LLM 能看懂的提示
    let hint = "查询失败";
    if (err.code === "ER_NO_SUCH_TABLE")
      hint = `表不存在。这个数据库里只有：sales、products、users`;
    else if (err.code === "ER_PARSE_ERROR")
      hint = `SQL 语法有错：${err.message}。常见原因：少了引号或逗号`;
    throw new Error(hint);
  }
}
```

> 为什么这里要抛异常，**不用** `return { ..., isError: true }`？因为 execute 的返回值类型里**根本没有 `isError` 这个字段**——你写在返回对象里的 `isError: true` 会被框架静默忽略，LLM 收到的反而是「成功结果」。框架判定"这次调用失败了"的唯一信号，就是 execute 抛出了异常。

对比一下，LLM 看到两种错误信息，反应天差地别：

| 你返回的错误信息 | LLM 看到后会怎样 |
|---|---|
| `查询失败`（框架兜底的）| 一头雾水，只能乱猜或放弃 |
| `表不存在。这个数据库里只有：sales、products、users` | 知道用错了表名，换成 sales 重新查 |

差别就在这：**错误信息越具体、越带"怎么修"的提示，LLM 的自我修复能力越强。** 抛出异常，是告诉 LLM"这次失败了"（框架据此标 `isError: true`）；而你抛出去的那段文字，是告诉它"为什么失败、怎么改"。

---

## 四、工具的组织和管理

到这儿，你已经会写工具了。

但真实项目里，工具会越写越多：怎么组织代码？怎么管理这一堆工具？这一节，解决实操问题。

### 4.1 注册方式

**方式一：customTools（最直接）**

创建会话的时候，把工具数组直接传进去。前几章一直是这么做的：

```typescript
const { session } = await createAgentSession({
  model, modelRuntime,
  customTools: [queryDataTool, queryTool, reportTool],
  sessionManager: SessionManager.inMemory(),
});
```

**方式二：扩展里 pi.registerTool（配合拦截）**

有时候你要「工具 + 拦截」配套，比如注册一个 SQL 工具，同时拦住危险 SQL。这时候就用扩展方式。

这块第 6 章会细讲，这里你先知道有这么个方式就行：

```typescript
const loader = new DefaultResourceLoader({
  extensionFactories: [
    (pi) => {
      pi.registerTool(queryTool);           // 注册工具
      pi.on("tool_call", handler);          // 配套拦截
    },
  ],
});
```

### 4.2 工具拆分到文件

工具写着写着会变长。我的建议是：**一个工具一个文件**。

其实 pi-agent 自己的内置工具就是这么做的：`core/tools/` 下面，bash.js、read.js、write.js 各占一个文件。

拆分不需要什么特殊机制，工具就是个普通对象，`export` / `import` 就行。本教程的主线工具 `query_data` 就这么抽出来了——完整定义在 `shared/lib/tools/query-data.ts`，后面第 6、7 章直接 `import` 复用它，不在每章重写一遍。

### 4.3 控制工具可见性：白名单

默认情况下，你注册的所有自定义工具 + 默认启用的内置工具（`read`/`bash`/`edit`/`write` 共 4 个），**都对 LLM 可见**。

但前面说过，做垂直智能体，`bash`/`write` 这些内置工具往往用不上，还有风险，得藏起来。怎么藏？

pi-agent 只给你一个机制：**白名单**（`setActiveToolsByName`）。

你列出「允许 LLM 用的工具名」，没列的全部不可见，内置的、自定义的，一视同仁：

```typescript
// 只让 LLM 看到 query_data 和 read，其余（含 bash/write 等内置）全部隐藏
session.setActiveToolsByName(["query_data", "read"]);
```

几个点你记住：

- **没有「黑名单」，也没有「单独禁用某个工具」的 API**。想藏谁，就用白名单把它排除掉。这是 pi-agent 的设计取舍：白名单更安全，默认不信任，只放行明确允许的。这点我个人挺认可。
- **白名单为空**（`setActiveToolsByName([])`）的时候，所有工具都看不见，LLM 的 Function Calling 直接失效，退化成纯文本聊天。第 3 章接不支持 FC 的模型时，我们就用过这个做法。
- 白名单按 session 生效，不同会话可以用不同的工具集（多用户场景下按角色分配权限时会用到）。

所以做垂直智能体的标准动作，就一句话：**创建会话之后，立刻拿白名单把工具收缩到「我这个业务真正要用的那几个」**，把无关的内置工具，全挡在门外。

---

## 结尾

到这里，工具系统的核心讲完了。

你其实就写了三件事：说明书、干活、注册。参数校验、错误兜底、结果传回 LLM、LLM 重试……这些繁琐活，框架全替你处理了。

但有些场景，你不一定要换工具，只想在工具执行前后介入一下：比如拦危险查询、给工具调用打日志、改工具结果。

这就用到了 pi-agent 的扩展系统——事件钩子机制。

下一章，讲它。



---

## 附录：知识点—源码对照（v0.83.0）

> 本章涉及的 API / 机制，在 `repo/`（v0.83.0 checkout）中的源码位置。**行号会随版本漂移**，定位时以符号名为主、行号为辅。

| 知识点 | 源码位置 | 一句话说明 |
|--------|---------|-----------|
| `defineTool` 定义与导出 | `extensions/types.ts:509-513`；`index.ts:152` | 从 `@earendil-works/pi-coding-agent` 导出 |
| `ToolDefinition` 必填 `label` | `extensions/types.ts:451,453` | `label: string`，UI 显示用，无默认值 |
| `execute` 五参数签名 | `extensions/types.ts:480-486` | `(toolCallId, params, signal, onUpdate, ctx)` |
| `AgentToolResult` 字段（**无 isError**） | `repo/packages/agent/src/types.ts:355-369` | 只有 content / details / usage? / addedToolNames? / terminate? |
| 错误判定：throw → isError:true | `agent/src/agent-loop.ts:675-703,756-760` | 成功返回硬编码 isError:false；catch 才 isError:true |
| `details` 是必填字段 | `agent/src/types.ts:357-359` | 无 `?`，返回值必须带（可空对象 `{}`） |
| isError 下发给 LLM 的映射 | `ai/src/api/anthropic-messages.ts:1105` 等 | Anthropic `is_error`、Google 包 `{error}`、Mistral 加前缀 |
| 参数校验（TypeBox / JSON Schema） | `ai/src/utils/validation.ts:278-307`；`agent-loop.ts:615-663` | 校验失败不调 execute，直接回错误给 LLM |
| `onUpdate` → `tool_execution_update` 事件 | `agent-loop.ts:679-692`；`agent/src/types.ts:436,377` | 进度回调（`AgentToolUpdateCallback`）映射到事件 |
| 7 个内置工具 + 默认激活 4 个 | `sdk.ts:245`；`agent-session.ts:2533-2535` | read/bash/edit/write 默认开；自定义工具 includeAllExtensionTools 时自动加入 |
| 自定义工具默认对 LLM 可见 | `agent-session.ts:397-399,2506,2530` | `includeAllExtensionTools:true` |
| `setActiveToolsByName` 白名单 | `agent-session.ts:926-941` | 空数组 = 无工具 |
| `customTools` 注入 | `sdk.ts` createAgentSession 选项 | 把 defineTool 产物塞进会话 |
| 扩展式注册 `pi.registerTool` / `pi.on("tool_call")` | `extensions/types.ts:1238,1228` | 扩展里注册工具 / 拦截工具调用 |
