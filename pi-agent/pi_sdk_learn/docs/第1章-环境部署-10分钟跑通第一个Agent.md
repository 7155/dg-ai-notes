# 第 1 章：环境部署——10 分钟跑通你的第一个 Agent

---

## 零、先把话说在前面

### 为什么还要学一个框架

先承认个现实：现在大部分代码，是 AI 帮你写的。

那学一个 SDK 还有多大必要？API 让 AI 查、代码让 AI 写，不就行了？

这话对一半。**API 级别的细节，确实可以交给 AI**——哪个函数叫什么、参数怎么传，让 AI 翻文档写代码，比你手敲快。但另一半是：**你得看得懂它写出来的东西、出问题知道往哪查、AI 卡住时给得了方向**。这靠的不是 API 记忆，是对框架运作机制的理解。

这就是学框架的意义变了的地方：以前是为了自己写，现在更多是为了**驾驭 AI 写**。一个懂机制的人指挥 AI，能判断架构对不对、能在 AI 跑偏时一句话拉回来；不懂的人只能全盘照收，出了问题不知道从哪查。

Pi Agent 的麻烦在于：官方文档相当全，光扩展系统、事件类型、认证方式就有好几十种配置。你让 AI 直接读，它能给你整出十几种方案，但哪种适合你的场景、哪些是低频的边缘功能，它分不清——**这个判断得你自己来**。

所以这本教程不是再写一份 API 字典（那个官方文档已经是了），而是**用一个具体案例（一个企业数据分析 Agent），把 pi-agent 二次开发时的特点和机制，做个框架性的介绍**：它分几层、每层管什么、你改业务时动的是哪一层。有了这张地图，你再用 AI 去写去改，就知道每一步在动哪里、为什么。

### 取舍原则

围绕这个目标，取舍就这几条：

1. **场景驱动**：每章从「做业务会碰到的真需求」切入，不从 API 列表切入；
2. **讲机制重于讲参数**：重点说清「它替你做了什么、你改业务时动哪一层」，具体 API 细节让 AI 去查文档；
3. **低频功能直接砍**：生产里很少用到的配置项、边缘用法，明确标「略过」，不展开；
4. **不替代官方文档**：被砍掉的部分、最新 SDK 的完整 API 细节，回 [pi.dev](https://pi.dev) 查。

最终目标：带你走完从「环境搭好」到「能在 Web 后端里调起一个带自定义工具的垂直 Agent」的完整路径。

> **一句话定位**：本教程用 pi-agent 做**集成在 Web 应用里的垂直 Agent**——不教 CLI 工具，砍掉低频功能，给你一张能驾驭 AI 干活的机制地图。

### 不要担忧：不用很懂 TypeScript 也能跟上

Pi Agent 的 SDK 是用 TypeScript 写的，所以本教程的示例代码也是 `.ts` 文件。**但你不用很懂 TypeScript——不用会写，大致看得懂、能照着改改参数跑起来就行。**如果你有代码基础，要做到看得懂并不难。

而且本章最后我放了一张「**TS 与 Python 代码对照表**」：后面 7 章里出现的 TS 写法，全部和 Python 一一对照。**会 Python 的话，看一遍那张表就能读懂全部示例**；后面遇到看不懂的写法，随时回去查。

---

## 一、Pi Agent 到底帮你省了什么力气

写一个垂直 Agent（数据查询助手也好、领域客服也好、内网知识问答也好），底下都在做同样的几件事：

调 LLM、跑工具循环、管上下文、处理流式输出。

这些是所有 Agent 的**共性**，每个项目都得来一遍，重复，还无趣。

但每个业务的**个性化**又各有差异：不同的提示词、不同的工具、不同的钩子。这才是你应该花力气的地方。

Pi Agent 的分工正好对应这条分界线：

- **共性部分它内置**：Agent 思考循环、工具调度、上下文管理、流式事件协议，全包了，你不用操心；
- **个性化部分它开放**：提示词、工具、扩展钩子，几行代码就能接上。

简单说，整本教程的本质，就是带你把这三样个性化部分（提示词、工具、扩展）依次接管。

本章先不讲这些。只做一件事：**把环境搭好，让 Agent 在你的终端里开口说话。**

但话说回来，在实际开发中，环境也不需要你自己搭，AI会处理，所以这章读起来应该毫无压力。

> 先说一下：这本教程会带你从零搭一个**企业数据分析助手**（我们叫它 DataAgent）——第 4 章给它换人设、第 5 章给它装查询工具，一路长成一个能上线的 Agent 服务。接下来每一章你见到的，都是同一个 Agent 在进化。

---

## 二、先确认 Node.js

Pi Agent SDK 要求 Node.js `22.19` 或更高版本（这是 SDK `package.json` 里 `engines.node` 的硬约束，低于这个版本跑不起来）。在终端里运行：

```bash
node --version   # 期望看到 v22.19.x 或更高
```

如果版本太低，去 [nodejs.org](https://nodejs.org) 下载 LTS 版安装，重新打开终端再试。如果你机器上已经有旧版 Node（比如 18/20），又不想覆盖升级，可以用 [nvm](https://github.com/coreybutler/nvm-windows)（Windows）或 [fnm](https://github.com/Schniz/fnm)（跨平台）切换 Node 版本。

---

## 三、初始化项目

> **配套代码**：本教程所有章节的示例代码都在 `pi_sdk_learn/code/` 下（已配好 `package.json` + 依赖）。你可以从零跟着下面步骤建一遍，也可以直接 `cd pi_sdk_learn/code && npm install` 用现成的。后续章节的运行命令默认在 `pi_sdk_learn/code/` 目录下执行。

找个工作目录，建项目骨架：

```bash
mkdir pi-learning
cd pi-learning
npm init -y
```

打开生成的 `package.json`，把 `"type": "module"` 加上（Pi Agent 运行就靠这一行）：

```json
{
  "name": "pi-learning",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {}
}
```

> 没加这一行，Node 会按 CommonJS 解析 `.ts` 文件，常见报错是 `SyntaxError: Cannot use import statement outside a module`（无法识别 `import`）或 `Top-level await is currently not supported`（无法识别顶层 `await`）。遇到这个报错别慌，回来补上就行。

---

## 四、装 SDK 和执行器

```bash
npm install @earendil-works/pi-coding-agent
npm install -D tsx
```

这两个分别是：

- `@earendil-works/pi-coding-agent`：Pi Agent SDK，本教程的主角；
- `tsx`：TypeScript 执行器，让你不用先编译成 JS，直接 `npx tsx xxx.ts` 就能运行。

> 本教程基于 SDK `0.83.0`。`npm install @earendil-works/pi-coding-agent` 默认会装最新版（写进 `package.json` 时带 `^` 前缀，表示「允许小版本升级」），后续 SDK 升级可能引入 break。想确保版本和教程完全一致，建议显式锁定：
>
> ```bash
> npm install @earendil-works/pi-coding-agent@0.83.0
> ```
>
> 这条命令会把 `pi-coding-agent` 以及它依赖的 `pi-agent-core`、`pi-ai` 一起装好。

---

## 五、配模型

Pi Agent 默认就支持 OpenAI、Anthropic、DeepSeek、通义千问这些主流 Provider。

但你得告诉它——用哪个 Provider、哪个 API Key、哪个模型。这些写在一个配置文件里。

#### 1. 建配置目录

Pi Agent 从 `~/.pi/agent/` 目录读配置：

```bash
# Windows PowerShell
mkdir $env:USERPROFILE\.pi\agent

# macOS / Linux
mkdir -p ~/.pi/agent
```

> **没有用户主目录写权限？** `~/.pi/agent/` 在你的**用户主目录**下。公司服务器、容器、多人共享开发机，都可能没有写权限。Pi Agent 留了两种办法，把配置放到项目目录：
>
> - **环境变量 `PI_CODING_AGENT_DIR`**——设了它，配置就从你指定的目录读，不再找 `~/.pi/agent/`：
>   ```bash
>   # macOS / Linux：在项目根目录建 .pi-config/，把 models.json 放进去
>   PI_CODING_AGENT_DIR=./.pi-config npx tsx L01-env/01-hello.ts
>   # Windows PowerShell
>   $env:PI_CODING_AGENT_DIR = "$PWD\.pi-config"; npx tsx L01-env/01-hello.ts
>   ```
> - **SDK 参数 `agentDir`**——写正式服务时，在代码里直接固定配置目录，不依赖运行环境记得设变量：
>   ```ts
>   const { session } = await createAgentSession({
>     agentDir: path.join(process.cwd(), ".pi-config"), // 指向项目内
>     // ...其他参数
>   });
>   ```

后续章节的示例默认走 `~/.pi/agent/`，受限环境里照上面任选一种切换即可，效果完全一样。

#### 2. 写 `models.json`

在 `~/.pi/agent/` 下新建 `models.json`，填进你已经有 Key 的 Provider。下面是 OpenAI 兼容接口的通用模板（国内厂商大多兼容这套）：

```json
{
  "providers": {
    "你的Provider名": {
      "baseUrl": "https://api.example.com/v1",
      "api": "openai-completions",
      "apiKey": "你的_API_KEY",
      "models": [
        { "id": "model-id", "name": "显示名" }
      ]
    }
  }
}
```

几个字段是什么意思，看这张表：

| 字段 | 含义 |
|------|------|
| `baseUrl` | Provider 的接口地址 |
| `api` | 接口协议，`openai-completions` 表示 OpenAI 兼容 |
| `apiKey` | 你的 API Key（**生产环境建议用环境变量或 auth.json，别硬编码进 git**）|
| `models` | 这个 Provider 提供哪些模型（**注意**：Provider 名与内置重名时，这里列的是「叠加 / 覆盖」而非替换——`getAvailable()` 仍会返回该内置 Provider 的全部模型；想用干净的自定义清单，换个不重名的 Provider 名）|

再举几个常见 Provider 的配置示例——**任选一个**你有 Key 的填进去：

```json
{
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "api": "openai-completions",
      "apiKey": "sk-...",
      "models": [
        { "id": "gpt-4o", "name": "GPT-4o" },
        { "id": "gpt-4o-mini", "name": "GPT-4o Mini" }
      ]
    },
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/v1",
      "api": "openai-completions",
      "apiKey": "sk-...",
      "models": [
        { "id": "deepseek-chat", "name": "DeepSeek Chat" }
      ]
    },
    "qwen": {
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "api": "openai-completions",
      "apiKey": "sk-...",
      "models": [
        { "id": "qwen-plus", "name": "通义千问 Plus" }
      ]
    }
  }
}
```

> 多 Provider 怎么管、运行时怎么动态注入 Key、企业内网模型怎么接——这些是第 3 章的内容。本章你跑通就行。

---

## 六、跑通你的第一个 Agent

在项目里建文件 `L01-env/01-hello.ts`：

```bash
mkdir -p L01-env
```

写入下面这段：

```typescript
import { createAgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
//     ↑ 从 SDK 里「导入」要用的两个工具，就像 JS 里 require

// 1. 加载 ~/.pi/agent/ 下的配置（models.json、auth.json）
//    await 是因为「读文件」是异步操作，得等它读完才能往下走
const modelRuntime = await ModelRuntime.create();

// 2. 拿到「配了 Key、真正能用」的模型列表
const available = await modelRuntime.getAvailable();
const model = available[0];   // 取列表里第一个能用的

if (!model) {
  console.error("❌ 没找到可用模型，请检查 ~/.pi/agent/models.json");
  process.exit(1);
}

// 3. 创建 Agent 会话
//    createAgentSession() 会返回一个对象，里面有好几个字段；
//    这里用 { session } 这种「解构赋值」写法，只把 session 字段挑出来用
const { session } = await createAgentSession({ model, modelRuntime });

try {
  // 4. 订阅事件：Agent 每生成一小段文字，就推一个事件过来
  //    这里只关心「文字增量」这一种事件，收到就立刻打印出来
  session.subscribe((event) => {
    if (
      event.type === "message_update" &&                // 是「消息更新」类事件
      event.assistantMessageEvent.type === "text_delta"  // 而且是「文字增量」子类型
    ) {
      // 用 process.stdout.write 而不是 console.log，是为了不换行，
      // 让文字一段段拼出来（流式打字机效果）
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  console.log(`🤖 使用模型：${model.provider}/${model.id}\n`);
  await session.prompt("用一句话介绍你自己。");   // 发问，等 Agent 答完才继续
  console.log("\n");
} finally {
  session.dispose();   // 释放资源（关监听、断连接）。用 try/finally 包起来，保证出错也能清理
}
```

在项目根目录运行：

```bash
npx tsx L01-env/01-hello.ts
```

看到 Agent 输出一段自我介绍——恭喜，**环境搭好了。**

---

## 七、所以刚才到底发生了什么

这 12 行代码，你先这么理解就行：

- `ModelRuntime.create()` 读了你刚配的 `models.json`，把可用模型列出来；
- `createAgentSession()` 建了个 Agent 会话，内部自动注册工具、加载资源、连上 LLM；
- `session.subscribe()` 订阅事件流——Agent 思考、调工具、生成文字，每一步都给你推事件；
- `session.prompt()` 把你的问题发给 Agent，等它回完。

具体每一行背后做了什么、为什么这么写、`subscribe` 里那一串判断是什么意思——**第 2 章会逐行讲清楚。**

本章的目标只有一个：让 Agent 在你机器上开口说话。它做到了，本章的目标就达成了。

下一章见。

---



---

## 八、TS 与 Python 代码对照表

> 会 Python 就能读懂本教程的全部代码。这张表把后面 7 章里出现的 TS 写法，和 Python 一一对照，分三层：第一层是「不认识就读不动」的核心语法，第二层是「认识就行、不用会写」的类型标注，第三层是「和 Python 几乎一样、对一遍确认」的控制流。看不懂哪行，回这儿查。

### 第一层：7 个核心语法（贯穿全书，必须认识）

这些写法每章都出现，是读懂示例的前提。好在它们在 Python 里都有直接对应。

**① 导入与变量声明**

TS 用 `import` 从包里拿东西；`const` 声明不可重新赋值的变量，`let` 声明可变的。Python 里 `from pkg import X` 和直接赋值就是一回事。

```typescript
import { createAgentSession } from "@earendil-works/pi-coding-agent";
const name = "Pi";      // 不可重新赋值
let count = 0;          // 可重新赋值
```

```python
from pi_coding_agent import create_agent_session
NAME = "Pi"             # Python 没有 const，约定大写表示常量
count = 0
```

**② 异步：async / await**

和 Python 几乎一模一样——`await` 等一个异步操作跑完再往下。本教程里读文件、发请求、创建会话，都要 `await`。

```typescript
const modelRuntime = await ModelRuntime.create();
await session.prompt("你好");
```

```python
model_runtime = await ModelRuntime.create()
await session.prompt("你好")
```

**③ 函数：箭头函数 `=>`**

TS 的匿名函数，长得像箭头。单行能省 `return`，多行要花括号 + `return`。对应 Python 的 `lambda`（单行）或 `def`（多行）。

```typescript
const add = (a, b) => a + b;                            // 单行，自动 return
session.subscribe((event) => { console.log(event); });  // 多行，要花括号
```

```python
add = lambda a, b: a + b
# 多行的话用 def：
def on_event(event):
    print(event)
session.subscribe(on_event)
```

**④ 解构赋值：从对象 / 数组里挑字段**

`const { session } = obj` 从对象挑名叫 `session` 的字段；`const [a, b] = arr` 按位置取数组元素。这是本教程最常出现的「怪写法」，Python 没有对象解构，只能近似。

```typescript
const { session } = await createAgentSession();   // 从返回对象挑 session 字段
const [first, second] = available;                // 按位置取数组
const { column, value } = params;                 // 工具参数里常用
```

```python
result = await create_agent_session()
session = result.session              # 对象没有解构，只能这么取
first, second = available             # 列表可以解包
column, value = params["column"], params["value"]
```

**⑤ 模板字符串：`${var}`**

反引号包字符串、`${}` 插值，就是 Python 的 f-string。`console.log` 就是 `print`。

```typescript
console.log(`🤖 使用模型：${model.provider}/${model.id}`);
```

```python
print(f"🤖 使用模型：{model['provider']}/{model['id']}")
```

**⑥ 属性访问：`.` `?.` `??`**

`.` 取属性，和 Python 一样。多两个符号：`?.` 是「前面可能是空，是空就不报错、返回空」，对应 Python 的 `.get()`；`??` 是「左边是空就用右边」，对应 Python 的 `or`（但只认 null，不认 0 和空串）。

```typescript
event.type                              // 取属性
session.model?.id                       // model 为空也不报错
const model = found ?? available[0];    // found 为空才用右边
```

```python
event["type"]
session.get("model", {}).get("id")      # 近似 ?.
model = found if found is not None else available[0]  # 近似 ??
```

### 第二层：类型标注（认识就行，不用会写）

TS 比 JS 多的就是类型标注。**你不用会写这些标注，但得认识**——不然看到 `: string` 会愣住。记住一条总纲：**冒号后面那一段，运行时全被抹掉，纯粹是给人看的，读代码可以当它不存在。**

**① 基本类型标注**

变量、参数、返回值后面跟冒号和类型名。Python 也有类型标注，长得几乎一样。

```typescript
function greet(name: string, age: number): string {
  return `你好 ${name}`;
}
const x: number = 1;
```

```python
def greet(name: str, age: int) -> str:
    return f"你好 {name}"
x: int = 1
```

差别在：TS 的标注编译期强制检查，Python 的运行时不强制。但对「读代码」来说，冒号后面都是「这是什么类型」，照着认就行。

**② 对象类型与字典类型**

描述「一个对象长什么样」用 `{ 字段: 类型; ... }`；描述「键值都同类型的字典」用 `Record<键类型, 值类型>`。第 4 章配置用户表时就用到了 `Record`。

```typescript
const users: Record<string, { name: string; role: string }> = {
  u1: { name: "张三", role: "admin" },
};
```

```python
from typing import Dict
users: Dict[str, dict] = {
    "u1": {"name": "张三", "role": "admin"},
}
```

**③ 泛型：`Map<K, V>`**

尖括号 `<...>` 里塞类型参数，叫泛型。最常见的是 `Map<K, V>`——一个「带方法的字典」，要用 `.get()` `.set()` 调，不能像 Python 字典那样 `[]` 取。第 6 章审计工具耗时就用了它。

```typescript
const startTimes = new Map<string, number>();
startTimes.set("id1", Date.now());          // 存
const t = startTimes.get("id1");             // 取，没有就返回 undefined
```

```python
start_times = {}                             # Python 直接用 dict
start_times["id1"] = time.time()
t = start_times.get("id1")                   # 没有时 .get() 返回 None
```

**④ 类型别名与类型导入：`type X = ...`**

给一个复杂类型起短名字，方便复用。`import { type X }` 表示「只导入类型、运行时不存在」——纯给编辑器看的。

```typescript
type ExtensionFactory = (pi: any) => void;   // 给「函数类型」起名
import { type ExtensionFactory } from "..."; // 只拿类型
```

```python
from typing import Callable
ExtensionFactory = Callable[..., None]       # Python 用类型别名
# Python 没有「只导入类型」这个区分
```

**⑤ 非空断言 `!` 与联合类型 `|`**

`getModel(...)!` 末尾的 `!` 是「我保证它不是空，别警告我」（读代码时直接忽略这个感叹号）。`string | undefined` 表示「可能是字符串，也可能是空」。

```typescript
const model = modelRuntime.getModel("zhipu", "glm-4")!;   // ! = 保证非空
let name: string | undefined;                             // 可能空
```

```python
from typing import Optional
model = model_runtime.get_model("zhipu", "glm-4")  # Python 无 ! 语法
name: Optional[str] = None                         # 等价于 str | None
```

### 第三层：控制流（和 Python 几乎一样，对一遍确认）

下面这些和 Python 高度相似，主要差别是「括号 vs 缩进」「花括号 vs 冒号」。过一遍就能对上号，后面遇到不会再卡。

**① 条件：if / else 与三元运算符**

`if` 写法只差在条件要加括号、代码块用花括号。三元 `条件 ? 真值 : 假值`，对应 Python 的 `真值 if 条件 else 假值`，顺序正好反过来。

```typescript
if (!model) {
  console.error("没模型");
} else {
  console.log("有模型");
}
const label = isError ? "失败" : "成功";
```

```python
if not model:
    print("没模型", file=sys.stderr)
else:
    print("有模型")
label = "失败" if is_error else "成功"
```

**② 异常：try / catch / finally 与 throw**

`catch` 对应 Python 的 `except`，`finally` 一模一样，`throw new Error(...)` 对应 `raise XxxError(...)`。第 5 章讲工具出错处理时就是这套。

```typescript
try {
  return await queryDB(params.sql);
} catch (err: any) {
  throw new Error("查询失败：" + err.message);
} finally {
  session.dispose();
}
```

```python
try:
    return await query_db(params["sql"])
except Exception as err:
    raise RuntimeError(f"查询失败：{err}")
finally:
    session.dispose()
```

**③ 循环：for...of 与数组方法**

`for...of` 对应 Python 的 `for x in ...`。TS 数组还自带一堆方法：`.find()` 找第一个满足条件的、`.map()` 把每个变形、`.forEach()` 纯遍历。对应 Python 的列表推导式或 `for` 循环。

```typescript
for (const msg of messages) { console.log(msg); }
const found = list.find((m) => m.id === 1);
const names = list.map((m) => m.name);
list.forEach((m) => console.log(m));
```

```python
for msg in messages:
    print(msg)
found = next((m for m in lst if m["id"] == 1), None)
names = [m["name"] for m in lst]
for m in lst:
    print(m)
```

**④ 分支：switch / case**

对应 Python 3.10+ 的 `match/case`，或更早版本的 `if/elif/else` 连串。注意一个坑：TS 的 `switch` 每个分支末尾要写 `break`，不写会「穿透」到下一个 case；Python 的 `match/case` 不会穿透。

```typescript
switch (event.type) {
  case "agent_start":
    console.log("开始");
    break;
  case "agent_end":
    console.log("结束");
    break;
  default:
    console.log("其他");
}
```

```python
match event["type"]:
    case "agent_start":
        print("开始")
    case "agent_end":
        print("结束")
    case _:
        print("其他")
```

---

这三层覆盖了本教程 7 章里出现的全部 TS 写法。后面遇到陌生的，回这儿查就行。真要系统学 TS，那是另一门课的事——但你跟着这本教程走完，不耽误。

---

## 附录：知识点—源码对照（v0.83.0）

> 本章涉及的 API / 机制，在 `repo/`（v0.83.0 checkout）中的源码位置。**行号会随版本漂移**，定位时以符号名为主、行号为辅。

| 知识点 | 源码位置 | 一句话说明 |
|--------|---------|-----------|
| 配置目录 `~/.pi/agent/` | `repo/packages/coding-agent/src/core/config.ts:515` | `getAgentDir() = join(homedir(),".pi","agent")` |
| 三个配置文件路径 | `config.ts:529,534,539` | models.json / auth.json / settings.json 都在 agentDir 下 |
| 环境变量 `PI_CODING_AGENT_DIR` | `config.ts:495,515` | 设了它，配置目录就改成你指定的 |
| `createAgentSession({ agentDir })` | `sdk.ts:42,171` | 用参数钉死配置目录 |
| `ModelRuntime.create()` 读哪些文件 | `model-runtime.ts:136-139` | 读 auth.json + models.json，合并内置 Provider，默认不联网 |
| auth.json 存取后端 | `auth-storage.ts:31,180` | `FileAuthStorageBackend` 默认指向 agentDir/auth.json |
| `getAvailable()` 过滤逻辑 | `repo/packages/ai/src/models.ts:394-409` | Provider 没配 Key 就返回空数组 |
| 入口导出 `createAgentSession`/`ModelRuntime` | `index.ts:180,206` | 从 `@earendil-works/pi-coding-agent` 顶层导出 |
| 事件 `message_update` + `text_delta` + `.delta` | `agent-session.ts:740-746`；`ai/src/types.ts:504` | 文本流的字段名是 `delta` |
| `subscribe` / `prompt` / `dispose` | `agent-session.ts:800,1114,837` | subscribe 返回取消订阅；prompt 阻塞；dispose 清理 |
| Node 版本要求 `>=22.19` | 三个包的 `package.json` engines | `"engines":{"node":">=22.19.0"}` |
| models.json schema 字段 | `model-config.ts`（ModelsConfigSchema） | `providers[].{baseUrl,api,apiKey,models[{id,name}]}` |
| `$VAR` / `${VAR}` / `!cmd` 插值 | `resolve-config-value.ts` | apiKey 等字段支持环境变量/命令插值 |
