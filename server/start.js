import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };
const proxy = String(env.YTDLP_PROXY || env.HTTPS_PROXY || env.HTTP_PROXY || "").trim();

if (proxy) {
  // Node 必须在进程启动时读取这些变量，运行中再设置对 fetch 不生效。
  env.HTTP_PROXY = env.HTTP_PROXY || proxy;
  env.HTTPS_PROXY = env.HTTPS_PROXY || proxy;
  env.NODE_USE_ENV_PROXY = "1";
}

const child = spawn(process.execPath, [join(serverDir, "server.js")], {
  cwd: serverDir,
  env,
  stdio: "inherit",
  windowsHide: true,
});

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));
child.once("error", (error) => {
  console.error("failed to start server:", error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = Number.isInteger(code) ? code : signal ? 1 : 0;
});
