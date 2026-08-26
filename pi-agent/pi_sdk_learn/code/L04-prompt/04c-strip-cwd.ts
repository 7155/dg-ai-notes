/**
 * 04c —— 去掉 SDK 固定追加的 "Current working directory" 行
 *
 * 问题：buildSystemPrompt() 末尾会无条件追加一行
 *   `\nCurrent working directory: /your/cwd`
 * SDK 没给关闭开关。本例用扩展的 before_agent_start 钩子，
 * 在系统提示词发给 LLM 之前把它删掉。
 *
 * 原理（0.83 源码）：扩展的 before_agent_start handler 返回 { systemPrompt }
 * 就能替换本轮系统提示词；多扩展时链式传递。
 *   - 注册：extensions/types.ts:1214   pi.on("before_agent_start", handler)
 *   - 生效：agent-session.ts:1247      _systemPromptOverride = result.systemPrompt
 *   - 复位：agent-session.ts:1069      finally 逐轮 reset _systemPromptOverride = undefined
 *
 * 适用：不碰文件的垂直智能体（客服/翻译/分析师），模型不需要知道工作目录。
 * 慎用：依赖模型生成相对路径的 coding 类 agent（详见 docs 第4章 §3 ⑤）。
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();
const model = (await modelRuntime.getAvailable())[0];
if (!model) throw new Error("没有可用模型，请检查 ~/.pi/agent/models.json");

// ★ 一个扩展工厂：ExtensionFactory 的类型就是 (pi) => void，
//   函数体里用 pi.on 注册事件。
const stripCwd: ExtensionFactory = (pi) => {
  pi.on("before_agent_start", (event) => {
    // event.systemPrompt 是「完整组装好」的系统提示词，末尾含
    //   "\nCurrent working directory: D:/xxx"
    const before = event.systemPrompt;
    const cleaned = before.replace(/\nCurrent working directory: .*$/, "");

    // 打印末尾 60 字符，肉眼验证那一行确实没了（\n 显示成字面量方便看）
    const tail = (s: string) => s.slice(-60).replace(/\n/g, "\\n");
    console.log("[strip-cwd] 替换前末尾:", tail(before));
    console.log("[strip-cwd] 替换后末尾:", tail(cleaned));

    // 返回 { systemPrompt } 即替换本轮系统提示词
    return { systemPrompt: cleaned };
  });
};

const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  extensionFactories: [stripCwd], // ★ 扩展工厂塞进 loader
  systemPromptOverride: () =>
    `你是一个企业数据分析助手，帮业务方分析销售数据、定位问题、给出建议。`,
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
