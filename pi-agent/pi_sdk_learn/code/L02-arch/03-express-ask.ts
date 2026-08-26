/**
 * 第 2 章 · 示例 03：把 Agent 装进 Express 路由
 *
 * ⚠️ 演示用，不能直接上生产：
 *   - 每个请求都新建 session（慢）
 *   - 对话历史无法跨请求保留
 *   - 高并发下资源开销大
 *
 * 正确做法是「一个用户复用同一个 session」（多用户隔离的进阶话题），
 * 本教程不再展开，可参考 SDK 官方文档。
 */
import express from "express";
import { createAgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";

const app = express();
app.use(express.json());

// 启动时一次性加载 ModelRuntime（全局共享）
const modelRuntime = await ModelRuntime.create();
// .find(...) 在数组里找第一个满足条件的元素；找不到返回 undefined
const model = (await modelRuntime.getAvailable()).find(
  (m) => m.provider === "zhipu",
);
if (!model) throw new Error("没有可用模型，请检查 ~/.pi/agent/models.json");

app.post("/ask", async (req, res) => {
  // as { question?: string } 是 TS「类型断言」：告诉编辑器 req.body 长这样；
  // question 后面的 ? 表示「这个字段可能不存在」（用户可能没传）
  const { question } = req.body as { question?: string };
  if (!question) {
    res.status(400).json({ error: "缺少 question 参数" });
    return;
  }

  // ⚠️ 每个请求都新建一个 session——只是演示用，生产环境绝对不能这么做
  const { session } = await createAgentSession({ model, modelRuntime });

  try {
    let answer = "";
    session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        answer += event.assistantMessageEvent.delta; // 把文字增量拼成完整回答
      }
    });

    await session.prompt(question); // 发问，等 Agent 答完
    res.json({ answer });
  } finally {
    session.dispose(); // 释放资源
  }
});

app.listen(3000, () => {
  console.log("✅ Agent 服务启动：http://localhost:3000/ask");
});
