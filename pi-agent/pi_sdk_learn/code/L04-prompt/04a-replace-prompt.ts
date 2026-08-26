/**
 * 第 4 章 · 示例 04a：完全替换系统提示词 —— 数据分析助手（DataAgent 登场）
 *
 * 演示 systemPromptOverride（完全替换）和 appendSystemPromptOverride（清空）。
 * 运行：npx tsx L04-prompt/04a-replace-prompt.ts
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();
const model = (await modelRuntime.getAvailable())[0];
if (!model) throw new Error("没有可用模型，请检查 ~/.pi/agent/models.json");

const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  // ★ 完全替换基础人设（忽略 base，直接返回新提示词）
  systemPromptOverride: () => `你是一个企业数据分析助手，帮业务方分析销售数据、定位问题、给出建议。

## 工作规则
1. 回答前先确认已知信息和未知信息
2. 不要编造数据，未知就说未知
3. 给出的分析要按可能性从高到低排序，并附验证方法`,
  // ★ 清空追加规则（避免加载 .pi/APPEND_SYSTEM.md）
  appendSystemPromptOverride: () => [],
});
await loader.reload();

const { session } = await createAgentSession({
  model,
  modelRuntime,
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});

try {
  session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  console.log("💬 问：上月销售额下降了 15%，可能的原因有哪些？\n");
  await session.prompt("上月销售额下降了 15%，可能的原因有哪些？");
  console.log("\n");
} finally {
  session.dispose();
}

console.log("\n✅ 完成");
