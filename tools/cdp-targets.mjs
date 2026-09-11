#!/usr/bin/env node
/** List CDP targets via the browser endpoint (works when /json/list is empty). */
const endpoint = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";

const version = await (await fetch(`${endpoint}/json/version`)).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {resolve, reject});
    socket.send(JSON.stringify({id, method, params: params || {}}));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }
    }, 8000);
  });
}

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
  socket.addEventListener("error", reject);
});

const result = await send("Target.getTargets");
for (const target of result.targetInfos) {
  console.log(`${target.type}\t${target.attached !== false ? "" : "[detached]"}\t${target.url}\t${target.targetId}`);
}
socket.close();
