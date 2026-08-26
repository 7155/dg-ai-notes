/**
 * 第 6 章 · 示例 06b：全景图 —— Agent 一轮对话到底发射了哪些事件？
 *
 * 这个示例不解决任何业务问题，它只做一件事：
 *   把扩展能监听的「主要事件」全注册一遍，每个事件触发时打一行日志。
 *   跑完一遍，你就能亲眼看到 Agent 回答一个问题，内部到底「喊了多少次、喊了啥」。
 *
 * 运行：在 pi_sdk_learn/code/ 目录下
 *   npx tsx L06-extensions/06b-see-all-events.ts
 *
 * 读代码提示：带中文注释的行是给你看的，不用管 TS 语法。
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

// ── 这就是「扩展」：一个普通函数，框架启动时会调它，把遥控器 pi 传进来 ──
function seeAllEventsExtension(pi: any) {
  // 一个小工具：返回一个「打印器函数」，省得每个事件都写一遍 console.log
  //  event 是框架传来的事件数据，我们这里只关心它叫啥名，不展开细节
  const stamp = (label: string) => (_event: any) => {
    console.log(`    📡 ${label}`);
  };

  console.log("\n========== 扩展已就绪，下面是 Agent 这一轮的所有事件 ==========\n");

  // ── ① 会话生命周期：会话刚起来时喊一次 ──
  pi.on("session_start", stamp("session_start         ── 会话启动"));

  // ── ② Agent 主循环：一次 prompt 的开始 / 结束，以及中间每一轮 ──
  //   注意 before_agent_start 是「扩展独有」事件，外部层 subscribe 收不到
  pi.on("before_agent_start", stamp("before_agent_start    ── Agent 主循环开始前（扩展独有）"));
  pi.on("agent_start", stamp("agent_start           ── Agent 主循环开始"));
  pi.on("turn_start", stamp("turn_start            ── 单轮开始（Agent 可能跑多轮）"));
  pi.on("turn_end", stamp("turn_end              ── 单轮结束"));
  pi.on("agent_end", stamp("agent_end             ── Agent 主循环结束"));
  pi.on("agent_settled", stamp("agent_settled         ── 一次 prompt 彻底跑完（v0.83 新增，含 retry/compaction）"));

  // ── ③ 用户输入：用户发消息进来 ──
  //   input 也是「扩展独有」，subscribe 收不到
  pi.on("input", stamp("input                ── 收到用户输入（扩展独有）"));

  // ── ④ 调 LLM 前后：每次给大模型发请求，都喊这几嗓子 ──
  //   context / tool_call / tool_result / before_agent_start / input 这 5 个是「扩展独有」
  pi.on("context", stamp("context              ── 即将发给 LLM 的消息列表（扩展独有，可改）"));
  pi.on("before_provider_request", stamp("before_provider_req.. ── HTTP 请求发出前（可改请求体）"));
  pi.on("after_provider_response", stamp("after_provider_resp  ── 收到 LLM 的 HTTP 响应（只读）"));

  // ── ⑤ 消息流式输出：LLM 回话时，文本是一个字一个字往外吐的 ──
  pi.on("message_start", stamp("message_start        ── 一条消息开始（user/assistant/toolResult）"));
  pi.on("message_update", stamp("message_update       ── 消息流式更新（逐 token，很频繁）"));
  pi.on("message_end", stamp("message_end          ── 一条消息结束"));

  // ── ⑥ 工具：工具从「决定调用」到「执行完」的全过程 ──
  //   tool_call / tool_result 是「扩展独有」，能拦截、能改结果
  pi.on("tool_call", stamp("tool_call            ── 工具调用前（扩展独有，可拦截！）"));
  pi.on("tool_execution_start", stamp("tool_execution_start ── 工具真正开始执行"));
  pi.on("tool_execution_update", stamp("tool_execution_update── 工具执行中的进度片段"));
  pi.on("tool_execution_end", stamp("tool_execution_end   ── 工具执行结束"));
  pi.on("tool_result", stamp("tool_result          ── 工具结果返回后（扩展独有，可改结果！）"));

  // ── ⑦ 模型切换（本示例不会触发，列出来让你知道有这些）──
  pi.on("model_select", stamp("model_select         ── 切换了模型"));
  pi.on("thinking_level_select", stamp("thinking_level_select─ 切换了思考强度"));

  // ── ⑧ 会话树 / 压缩（多用于 CLI 分叉对话，本示例不触发）──
  pi.on("session_before_compact", stamp("session_before_compact─ 压缩上下文前"));
  pi.on("session_compact", stamp("session_compact      ── 压缩完成后"));
}

// ── 装载：把扩展塞进 DefaultResourceLoader ────────────────
const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  extensionFactories: [seeAllEventsExtension],   // ★ 我们的扩展放这儿
});
await loader.reload();

// ── 选模型、创建会话（跟前几章一模一样的套路）──
const modelRuntime = await ModelRuntime.create();
const model = (await modelRuntime.getAvailable())[0];
if (!model) throw new Error("没有可用模型，请检查 ~/.pi/agent/models.json");

const { session } = await createAgentSession({
  model,
  modelRuntime,
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});

try {
  console.log("💬 问：1 加 1 等于几？（一个简单问题，让 Agent 少调点工具）\n");
  await session.prompt("1 加 1 等于几？用一句话回答。");
  console.log("\n========== 事件流结束 ==========\n");
} finally {
  session.dispose();
}
