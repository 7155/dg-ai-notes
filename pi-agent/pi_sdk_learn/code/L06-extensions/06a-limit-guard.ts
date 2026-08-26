/**
 * 示例 06a：扩展拦截危险查询 —— tool_call 事件的 block 用法
 *
 * 给第 5 章的主线工具 query_data 加一道「执行前」安全门：
 *   - 用户问「帮我导出所有销售记录」→ LLM 调 query_data 时想传 limit: 9999
 *   - 扩展在工具真执行前拦住，返回 reason
 *   - LLM 收到 reason 后改口告诉用户「单次最多 100 行，请缩小范围」
 *
 * 演示：
 *   1. extensionFactories 注入扩展
 *   2. pi.on("tool_call") 拦截 + block + reason 回流
 *   3. 扩展内 pi.registerTool 配套注册工具
 *
 * 运行：cd pi_sdk_learn/code && npx tsx L06-extensions/06a-limit-guard.ts
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { queryDataTool } from "../shared/lib/tools/query-data.ts"; // ★ 复用第 5 章主线工具

// ── 扩展：在工具执行「前」检查 limit 是否过大 ─────────────
function limitGuardExtension(pi: ExtensionAPI) {
  const MAX_LIMIT = 100; // 单次最多返回 100 行

  // pi.on("tool_call", ...) 盯住「工具执行前」这个事件
  pi.on("tool_call", async (event) => {
    // 只盯 query_data 这把工具，别的工具不管
    if (event.toolName !== "query_data") return;

    // event.input 是 LLM 准备传给工具的参数对象；?. 是「可选链」，input 为空也不报错
    const limit = event.input?.limit;
    if (limit && limit > MAX_LIMIT) {
      // 返回 { block: true, reason } → 框架拦住这次调用，把 reason 喂回给 LLM
      return {
        block: true,
        reason: `单次最多返回 ${MAX_LIMIT} 行，你请求了 ${limit} 行。请加更精确的过滤条件后重试。`,
      };
    }
    return undefined; // 不拦，放行
  });
}

// ── 装载 ──────────────────────────────────────────────────
const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  extensionFactories: [
    (pi: any) => {
      pi.registerTool(queryDataTool); // 用扩展方式注册主线工具（配套挂事件）
    },
    limitGuardExtension, // 安全门
  ],
});
await loader.reload();

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
  session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      console.log(`🔧 调用工具：${event.toolName}`);
    } else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  // 这句会诱导 LLM 调 query_data 并传一个很大的 limit，触发拦截
  console.log("💬 问：帮我把所有销售记录一次性全部导出来\n");
  await session.prompt("帮我把所有销售记录一次性全部导出来，一条都不要漏");
  console.log("\n");
} finally {
  session.dispose();
}
