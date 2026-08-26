// P08 · 真正的 Runtime：观察 AgentSession replacement 生命周期
// 运行：npm run 08
//
// 这个示例故意不做完整 Web 多用户服务器：conversationId / auth / DB / lease
// 属于你的 Serving Layer。这里专门验证 Pi SDK 自己负责的边界：
// AgentSessionRuntime 如何创建、替换 AgentSession，以及为什么替换后要重新订阅。

import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const cwd = process.cwd();

// 1) Runtime Factory：每当目标 Session/cwd 改变时，用目标 cwd 重建 services，
// 再用这些 services 创建新的 AgentSession。
const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd });

  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

// 2) 初始 Runtime。SessionManager.create() 是持久化 Session；
// 与 P07 的 SessionManager.inMemory() 不同，进程退出后可以再打开历史 Session。
const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd,
  agentDir: getAgentDir(),
  sessionManager: SessionManager.create(cwd),
});

function bindSessionEvents(label: string) {
  const boundSession = runtime.session;
  console.log(`[${label}] sessionId =`, boundSession.sessionId);

  return boundSession.subscribe((event) => {
    if (event.type === "agent_start") {
      console.log(`[${label}] agent_start`);
    }
    if (event.type === "agent_end") {
      console.log(`[${label}] agent_end`);
    }
  });
}

let off = bindSessionEvents("session-A");

try {
  // 3) 当前 Session 正常工作。
  await runtime.session.prompt("用一句话说明：Session 和 Agent 的生命周期有什么区别？");

  const oldSession = runtime.session;

  // 4) replacement：不是清空 messages，而是安全关闭旧 Session，
  // 创建一个新的 Session + cwd-bound runtime state。
  await runtime.newSession();

  // 旧 listener 绑定的是旧 AgentSession；replacement 后必须重新绑定。
  off();
  console.log("AgentSession 被替换：", oldSession !== runtime.session);

  off = bindSessionEvents("session-B");
  await runtime.session.prompt("这是一个新的会话。只回答：new session ready");

  // 还可以使用：
  // await runtime.switchSession(sessionPath);
  // await runtime.fork(entryId);
  // await runtime.importFromJsonl(filePath);
} finally {
  off();
  await runtime.dispose();
}
