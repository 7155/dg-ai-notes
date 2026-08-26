/**
 * 第 3 章 · 示例 03a：模型管理 —— getModel / setModel / thinkingLevel
 *
 * 演示 ModelRuntime 的核心模型管理 API。
 * 运行：cd pi_sdk_learn/code && npx tsx L03-model/03a-model-management.ts
 */
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();
const available = await modelRuntime.getAvailable();

console.log(`\n📦 可用模型（共 ${available.length} 个）：`);
available.forEach((m, i) => {
  console.log(`  ${i + 1}. ${m.provider}/${m.id} (${m.name})`);
});

if (available.length === 0) {
  console.error("❌ 没有可用模型，请先在 ~/.pi/agent/models.json 配置 Provider");
  process.exit(1);
}

// ★ getModel：按 provider/id 精确查找（同步，不查 Key 是否存在）
// 第一个可用模型当默认
const firstModel = available[0];
const preciseModel = modelRuntime.getModel(firstModel.provider, firstModel.id);
console.log(`\n🔍 getModel("${firstModel.provider}", "${firstModel.id}")：`);
if (preciseModel) {
  console.log(`  provider       : ${preciseModel.provider}`);
  console.log(`  id             : ${preciseModel.id}`);
  console.log(`  name           : ${preciseModel.name}`);
  console.log(`  reasoning      : ${preciseModel.reasoning}`);
  console.log(`  contextWindow  : ${preciseModel.contextWindow}`);
  console.log(`  maxTokens      : ${preciseModel.maxTokens}`);
} else {
  console.log("  未找到");
}

// ★ thinkingLevel：控制推理模型的思考深度（off/minimal/low/medium/high/xhigh/max）
// 仅对 reasoning: true 的模型生效，普通模型会被钳到 "off"
const { session } = await createAgentSession({
  model: firstModel,
  modelRuntime,
  thinkingLevel: "medium",
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

  console.log(`\n🤖 使用模型：${firstModel.provider}/${firstModel.id}\n`);
  console.log("💬 问：用一句话介绍你自己\n");
  await session.prompt("用一句话介绍你自己。");
  console.log("\n");

  // ★ setModel：运行时切换模型（对话历史保留）
  // 如果有第二个可用模型，演示切换
  if (available.length > 1) {
    const secondModel = available[1];
    console.log(`\n🔄 切换到：${secondModel.provider}/${secondModel.id}\n`);
    await session.setModel(secondModel);
    console.log("💬 问：再说一句\n");
    await session.prompt("再说一句话。");
    console.log("\n");
  }
} finally {
  session.dispose();
}

console.log("\n✅ 完成");
