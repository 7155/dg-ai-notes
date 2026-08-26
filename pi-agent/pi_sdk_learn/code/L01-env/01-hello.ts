/**
 * 第 1 章 · 示例 01：最小 Agent 验证
 *
 * 目的：跑通环境，确认 SDK + 模型配置正常，看到 Agent 开口说话。
 * 详细逐行解读见《第 2 章 · 先看全貌——搞懂 pi-agent 的工作机制》。
 *
 * 运行：cd pi_sdk_learn/code && npx tsx L01-env/01-hello.ts
 */
// import：从 SDK 里「导入」要用的两个工具，类似 JS 的 require
import { createAgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";

// 1. 加载 ~/.pi/agent/ 下的配置（models.json、auth.json）
//    await：读文件是异步操作，得等它读完
const modelRuntime = await ModelRuntime.create();

// 2. 拿到「配了 Key、真正能用」的模型列表，取第一个
const available = await modelRuntime.getAvailable();
const model = available[0];

if (!model) {
  console.error("❌ 没找到可用模型，请检查 ~/.pi/agent/models.json");
  process.exit(1);
}

// 3. 创建 Agent 会话
//    { session } 是「解构赋值」：从返回对象里只挑出 session 字段
const { session } = await createAgentSession({ model, modelRuntime });

try {
  // 4. 订阅事件：只关心「文字增量」，收到就打印（不换行，拼出打字机效果）
  session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  console.log(`🤖 使用模型：${model.provider}/${model.id}\n`);
  await session.prompt("用一句话介绍你自己。"); // 发问，等 Agent 答完
  console.log("\n");
} finally {
  session.dispose(); // 释放资源。try/finally 保证出错也能清理
}
