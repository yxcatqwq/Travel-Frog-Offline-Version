#!/usr/bin/env node
/**
 * Evaluate JavaScript inside the running game WebView (Chrome DevTools Protocol).
 *
 * 准备：
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   （<pid> 来自 adb shell "cat /proc/net/unix | grep webview_devtools"）
 *
 * 用法：
 *   node tools/cdp-eval.mjs "JSON.stringify(window.LocalFrog && LocalFrog.status())"
 *   node tools/cdp-eval.mjs --file expr.js
 *   node tools/cdp-eval.mjs --list
 */
const endpoint = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {expression: null, file: null, list: false, timeout: 15000, target: "index.html"};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--list") options.list = true;
    else if (arg === "--file") options.file = args[++index];
    else if (arg === "--target") options.target = args[++index];
    else if (arg === "--timeout") options.timeout = Number(args[++index]);
    else options.expression = arg;
  }
  return options;
}

async function listTargets() {
  const response = await fetch(`${endpoint}/json/list`);
  return response.json();
}

function pickTarget(targets, hint) {
  const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (pages.length === 0) return null;
  return pages.find((page) => (page.url || "").includes(hint)) || pages[0];
}

async function evaluate(target, expression, timeout) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, {resolve, reject});
      socket.send(JSON.stringify({id, method, params}));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, timeout);
    });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const {resolve, reject} = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(JSON.stringify(payload.error)));
      else resolve(payload.result);
    }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", (error) => reject(new Error(`websocket error: ${error.message || error}`)));
  });

  await send("Runtime.enable", {});
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  socket.close();
  return result;
}

const options = parseArgs();
if (options.list || !options.expression && !options.file) {
  const targets = await listTargets();
  for (const target of targets) {
    console.log(`${target.type}\t${target.title}\t${target.url}\t${target.webSocketDebuggerUrl || ""}`);
  }
  process.exit(0);
}

const expression = options.file ? (await import("node:fs")).readFileSync(options.file, "utf8") : options.expression;
const targets = await listTargets();
const target = pickTarget(targets, options.target);
if (!target) {
  console.error("no page target found");
  process.exit(2);
}
try {
  const result = await evaluate(target, expression, options.timeout);
  const value = result && result.result ? result.result.value : undefined;
  if (value === undefined) {
    console.log(JSON.stringify(result, null, 2));
  } else if (typeof value === "string") {
    console.log(value);
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
} catch (error) {
  console.error(String(error.message || error));
  process.exit(3);
}
