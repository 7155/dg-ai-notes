# 2026-08-29 学习笔记：Agent 运行时取消机制——AbortSignal 与 Tool 执行

> 这份笔记记录今天真正打通的一条源码链：**一次 Agent Run 如何创建取消控制器，signal 如何传入 Tool，Tool 如何登记自己的取消函数，以及用户停止后为什么能让正在运行的 Tool 收到取消通知。**
>
> 不先背 Event Loop / Promise 定义，先按真实源码调用顺序理解。

---

## 1. 先把对象关系摆正

Pi 里不是 `Agent` 持有 `Session`，而是上层逐层持有下层：

```text
InteractiveMode（TUI）
        ↓
AgentSessionRuntime
        ↓
AgentSession
        ↓
Agent
        ↓
Agent Loop
        ↓
Tool.execute()
```

日常的一次用户输入大致是：

```text
TUI
 ↓
AgentSession.prompt()
 ↓
Agent.prompt()
 ↓
runAgentLoop()
 ↓
模型返回 ToolCall
 ↓
executeToolCalls()
 ↓
具体 Tool.execute()
```

这里要区分两件事：

```text
构造期：Session 把 model / tools / cwd / hooks 等组装进 Agent
运行期：一次 Run 把本轮的 signal 向 Model / Tool 传递
```

**Session 对象本身不会一层层传到 Tool。**

---

# 2. 一次 Run 开始时，Agent 创建 AbortController

源码：

```text
packages/agent/src/agent.ts
```

核心结构：

```ts
private async runWithLifecycle(
  executor: (signal: AbortSignal) => Promise<void>
): Promise<void> {
  const abortController = new AbortController();

  this.activeRun = {
    promise,
    resolve: resolvePromise,
    abortController,
  };

  try {
    await executor(abortController.signal);
  } finally {
    this.finishRun();
  }
}
```

最关键的是：

```ts
const abortController = new AbortController();
```

这一轮 Run 得到一对对象：

```text
AbortController
      │
      └── AbortSignal
```

Controller 是“触发取消”的一侧；Signal 是“向下游传播取消状态/事件”的一侧。

然后：

```ts
executor(abortController.signal)
```

把同一个 `signal` 交给本轮 Agent Loop。

---

# 3. Agent Loop 不负责知道每种 Tool 怎么取消

源码：

```text
packages/agent/src/agent-loop.ts
```

真正执行 Tool 的地方：

```ts
const result = await prepared.tool.execute(
  prepared.toolCall.id,
  prepared.args,
  signal,
  onUpdate,
);
```

也就是说 Loop 做的事情很简单：

```text
Run signal
    ↓
Agent Loop
    ↓
tool.execute(..., signal)
```

Loop 不会写：

```text
如果是 Bash → kill process
如果是 Fetch → abort request
如果是 Write → 停止文件写入
```

因为 Loop 不知道每种 Tool 底层资源是什么。

所以原则是：

> **Loop 负责传递取消信号；真正拥有资源的 Tool / 底层 operation 决定收到取消后怎么办。**

---

# 4. 以 Write Tool 为例：监听函数就在 Tool 内部登记

源码：

```text
packages/coding-agent/src/core/tools/write.ts
```

真实结构可以压缩成：

```ts
async execute(
  _toolCallId,
  { path, content },
  signal?: AbortSignal,
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Operation aborted"));
      return;
    }

    let aborted = false;

    const onAbort = () => {
      aborted = true;
      reject(new Error("Operation aborted"));
    };

    signal?.addEventListener("abort", onAbort, {
      once: true,
    });

    (async () => {
      await ops.mkdir(dir);
      if (aborted) return;

      await ops.writeFile(absolutePath, content);
      if (aborted) return;

      signal?.removeEventListener("abort", onAbort);
      resolve(successResult);
    })();
  });
}
```

这里分成三块看。

### 4.1 定义取消时要干什么

```ts
const onAbort = () => {
  aborted = true;
  reject(new Error("Operation aborted"));
};
```

这就是 Write Tool 自己的取消处理函数。

### 4.2 把取消函数登记到本轮 signal

```ts
signal?.addEventListener("abort", onAbort, {
  once: true,
});
```

可以用下面这个心智模型理解：

```text
本轮 signal
   │
   ├── listener A
   ├── listener B
   └── write.onAbort
```

这里的“监听”不是另起一个线程不断检查，也不是 `while` 轮询。

它只是：

> 把 `onAbort` 这个回调提前登记起来；以后有人触发这个 signal 的 abort 事件时，再调用它。

### 4.3 然后 Tool 正常工作

```ts
await ops.mkdir(dir);
if (aborted) return;

await ops.writeFile(absolutePath, content);
if (aborted) return;
```

---

# 5. 用户按停止：真正的入口只有 controller.abort()

还是：

```text
packages/agent/src/agent.ts
```

Agent 暴露：

```ts
abort(): void {
  this.activeRun?.abortController.abort();
}
```

上层的 `AgentSession.abort()` 最终会调用这里。

所以停止链可以压成：

```text
TUI Stop / ESC
      ↓
AgentSession.abort()
      ↓
Agent.abort()
      ↓
当前 activeRun.abortController.abort()
```

到这里以前是普通函数调用链。

接下来不是 Session 再去找：

```text
Write
Bash
Fetch
...
```

而是：

```text
controller.abort()
      ↓
对应 signal 触发 "abort"
      ↓
signal 上之前登记的 listener 被触发
```

例如：

```text
signal
├── write.onAbort
├── bash.onAbort
└── 某个网络请求的 abort handler
```

一次 `abort()` 相当于向这个 signal 上的订阅者广播取消。

所以更准确的说法不是“递归调用 Tool”，而是：

> **上层找到当前 Run 的总开关；总开关触发当前 signal；signal dispatch 已注册的 abort listener。**

---

# 6. 它怎么知道哪些函数需要运行？

答案：

> **谁注册在这个 signal 上，就触发谁。**

例如：

```ts
signal.addEventListener("abort", stopWrite);
signal.addEventListener("abort", stopBash);
```

之后：

```ts
controller.abort();
```

可以粗略理解成：

```text
触发 stopWrite()
触发 stopBash()
```

如果一个 Tool 已经正常结束，会移除自己的 listener：

```ts
signal.removeEventListener("abort", onAbort);
```

那么后面再发生 abort 时，它就不再属于需要通知的对象。

不同 Run 也各自拥有自己的 controller / signal：

```text
Run #1
  controller1 → signal1

Run #2
  controller2 → signal2
```

`activeRun.abortController.abort()` 只操作当前 Run。

---

# 7. `await` 和 abort listener 到底是什么关系？

今天最容易混淆的是这里。

结论先记：

> **abort listener 的注册和触发机制，本身不依赖 await。**
>
> `await` 解决的是“当前 async 函数等待异步结果时，别把整个 JS 主线程堵住”。

例如：

```ts
const result = await tool.execute(signal);
```

意思不是：

```text
整个程序停住
```

而是：

```text
当前这个 async 函数先暂停
 ↓
JS 主线程可以处理别的事件
 ↓
等 Promise resolve / reject
 ↓
这个 async 函数再从 await 后面恢复
```

所以一个典型时序是：

```text
Agent Loop
  ↓
await tool.execute()
  ↓
Agent Loop 这条 async 调用暂停

与此同时 JS Runtime 仍可处理：
  - 用户输入
  - timer
  - 网络事件
  - stdout
  - Stop/ESC
```

用户 Stop 对应的回调有机会运行，于是调用：

```ts
controller.abort();
```

然后触发之前注册的 abort listener。

所以不要理解成：

```text
await 在不停检查 abort
```

也不要理解成：

```text
listener 在另一个线程不停监听
```

更合适的理解是：

```text
Tool 启动时登记回调
       ↓
当前 async 调用可以 await 让出执行权
       ↓
以后外界某个事件真正调用 controller.abort()
       ↓
AbortSignal dispatch 已登记回调
```

---

# 8. Write Tool 的取消并不等于“文件一定没写”

这一点非常重要。

Write 默认底层：

```ts
fsWriteFile(path, content, "utf-8")
```

Pi 的 Write Tool 没有继续把本轮 `signal` 传给这个默认 `fsWriteFile`。

因此如果代码已经运行到：

```ts
await ops.writeFile(absolutePath, content);
```

这时用户取消：

```text
onAbort()
 ↓
aborted = true
 ↓
外层 Promise reject
```

Agent Runtime 可以马上认为这个 Tool 被取消。

但是已经交给 Node / OS 的文件写入不一定同步停止。

所以必须区分：

```text
取消等待 / 取消 Tool 的逻辑结果
            ≠
撤销已经发生或正在发生的 side effect
```

这也是为什么 Runtime correctness 不能只看：

```text
Promise 是否 reject
```

还要看：

```text
底层资源真的停了吗？
副作用发生了吗？
取消以后是否还能产生 late result？
```

---

# 9. Bash 为什么比 Write 更容易做到“硬取消”？

Bash Tool 底层运行的是独立 OS process。

它的取消 handler 可以做：

```ts
signal.addEventListener("abort", () => {
  killProcessTree(child.pid);
});
```

所以：

```text
signal abort
 ↓
执行 Bash 的取消 callback
 ↓
killProcessTree(pid)
 ↓
真正终止底层 process / process group
```

而 Write 的 handler 当前主要做的是：

```text
reject Promise
+ 设置 aborted 标记
```

所以两种 Tool 的 cancellation guarantee 并不一样。

可以记成：

```text
Write：更多是逻辑取消
Bash：可以进一步做到资源级终止
```

---

# 10. 今天最终打通的完整链

```text
① Agent Run 开始
   agent.ts
   new AbortController()
        ↓
② signal 传给 Agent Loop
        ↓
③ Loop 调 Tool
   tool.execute(id, args, signal, onUpdate)
        ↓
④ Tool 自己登记取消回调
   signal.addEventListener("abort", onAbort)
        ↓
⑤ Tool 正常执行 / await 异步 operation
        ↓
⑥ 用户 Stop
   TUI
    ↓
   AgentSession.abort()
    ↓
   Agent.abort()
    ↓
   controller.abort()
        ↓
⑦ signal dispatch abort
        ↓
⑧ 当前仍登记的 Tool cancellation callbacks 被调用
        ↓
⑨ Tool 根据自己的资源类型真正做 cleanup / kill / reject
```

一句话：

> **Pi 的 Run cancellation 不是 Session 逐层寻找所有正在运行的 Tool 再调用 stop，而是 Agent 为每次 Run 创建 AbortController，把同一个 signal 向下传；各 Tool 启动时把自己的取消处理器登记到 signal，外部只需要触发当前 Run 的 controller.abort()。**

---

# 11. 源码阅读索引

今天这条线只需要记三个主文件：

```text
packages/agent/src/agent.ts
```

看：

```text
ActiveRun
runWithLifecycle()
abort()
finishRun()
```

```text
packages/agent/src/agent-loop.ts
```

看：

```text
executeToolCalls()
executePreparedToolCall()
prepared.tool.execute(..., signal)
```

```text
packages/coding-agent/src/core/tools/write.ts
```

看：

```text
execute(..., signal)
onAbort
addEventListener("abort", ...)
ops.mkdir
ops.writeFile
removeEventListener
```

然后对照：

```text
packages/coding-agent/src/core/tools/bash.ts
```

观察 Bash 如何把相同的 abort 通知翻译成真正的 process-tree termination。

---

# 12. 当前可以直接复述的四句话

1. **每次 active Agent Run 自己有一个 AbortController。**
2. **Agent Loop 不知道每个 Tool 怎么取消，只负责把同一个 signal 传给 Tool。**
3. **Tool 或它依赖的底层 operation 自己登记 / 处理 abort，并决定如何释放真实资源。**
4. **取消 Promise 不等于撤销副作用；Runtime 需要单独定义每种 Tool 的 cancellation guarantee。**

---

# 13. 下一步继续读什么

沿着今天这条 Runtime 主线，不应马上跳去学更多框架，而应继续追下面几条：

```text
A. Parallel / Sequential Tool Execution
   └─ 多个 Tool 同时执行时，signal / result / failure 怎么汇合

B. Tool Result Finalization
   └─ success / error / abort 后为什么只能产生一个最终结果

C. Retry
   └─ retry 创建的到底是什么；如何避免重复副作用

D. Event Settlement
   └─ agent_end 为什么还不等于 idle；listener 为什么要 flush

E. Session Persistence / Resume
   └─ 进程退出后，哪些是可以恢复的状态，哪些运行中状态不能恢复

F. Compaction / Context Transform
   └─ context 在什么时候变换，compaction 与正在运行的 Turn 怎么隔离

G. Extension Runtime
   └─ beforeToolCall / afterToolCall / provider hook 如何插入主执行链而不破坏 Runtime invariant
```

学习时继续坚持同一种方式：

> **先追一条真实源码调用链，再解释抽象；先看 success path，再追 cancel / error / retry failure path。**
