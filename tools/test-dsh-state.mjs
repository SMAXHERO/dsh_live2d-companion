#!/usr/bin/env node
/* tools/test-dsh-state.mjs — GET /api/dsh/state 零依赖自测
 *
 * 用法：node tools/test-dsh-state.mjs   （先保证 node server.js 在 5173 跑着）
 *
 * ① 直接 require ../server.js 调 readState()（server.js 用 require.main 守卫，不会 listen）
 *    → 打印解析出的 status / toolCount / lastTool / lastCommand …
 * ② 对正在跑的服务 GET http://127.0.0.1:5173/api/dsh/state 打印 JSON
 * ③ 用「自己整文件解压」做地面真值，对比 toolCount / lastTool / 最后事件
 * ④ 安全与回归：路径穿越被拒、畸形 URL 不崩、/whale.html 仍 200、/api/chat 路由仍在（405）
 *
 * 只用 node 内置模块；ESM 里用 createRequire 拿 CommonJS 的 server.js。
 */
import { createRequire } from "node:module";
import zlib from "node:zlib";
import fs from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const mod = require("../server.js");

const BASE = "http://127.0.0.1:5173";
const ENDPOINT = BASE + "/api/dsh/state";
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);   // zstd 帧头
const STATUSES = ["idle", "thinking", "tool", "error", "waiting", "done", "unknown"];
const KINDS = ["shell", "write", "read", "web", "plan", "other"];
const REQUIRED = ["ok", "file", "sessionId", "updatedAt", "ageMs", "status", "toolName", "toolKind",
  "lastCommand", "lastFile", "toolCount", "lastError", "waitingApproval", "doneAt", "todos", "lines"];

let pass = 0, fail = 0, skip = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  (" + extra + ")" : "")); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  (" + extra + ")" : "")); }
}
function section(t) { console.log("\n== " + t + " =="); }
function hr() { console.log("-".repeat(72)); }

// 缩短成单行（和服务端 dshShort 同样规则）—— 只用于和返回值做对比
function short(v, n) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// 地面真值：把整个文件按 magic 拆帧、逐帧解压、逐行 JSON.parse（独立于 server.js 的实现）
function groundTruth(file) {
  const buf = fs.readFileSync(file);
  const offs = [];
  let p = -1;
  while ((p = buf.indexOf(MAGIC, p + 1)) !== -1) offs.push(p);
  const truth = { frames: 0, events: 0, toolCalls: 0, lastType: null, lastSeq: null, lastToolName: null, lastCommand: null, lastEventLine: null };
  for (const off of offs) {
    let out;
    try { out = zlib.zstdDecompressSync(buf.subarray(off)); } catch (e) { continue; }
    if (!out || !out.length) continue;
    truth.frames++;
    for (const line of out.toString("utf8").split("\n")) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch (e) { continue; }
      truth.events++;
      if (o.type === "tool/call") truth.toolCalls++;
      if (o.seq != null && (truth.lastSeq == null || o.seq >= truth.lastSeq)) {
        truth.lastSeq = o.seq;
        truth.lastType = o.type;
        truth.lastEventLine = line;
      }
      const d = o.data || {};
      if (o.type === "tool/call" || o.type === "tool/ptc-dispatch-start") {
        truth.lastToolName = d.name || truth.lastToolName;
        let a = d.arguments;
        if (typeof a === "string") { try { a = JSON.parse(a); } catch (e) { a = null; } }
        if (a && typeof a === "object" && (a.command || a.cmd)) truth.lastCommand = short(a.command || a.cmd, 60);
      }
    }
  }
  return truth;
}

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (e) { json = null; }
  return { status: r.status, txt, json, headers: r.headers };
}

async function main() {
  console.log("DSH 状态接口自测：server.js:readState() + " + ENDPOINT);
  hr();

  // ——— ① 直接调解析函数（不经过 HTTP，也不启动服务）———
  section("① readState() 直接解析最新会话");
  const t0 = Date.now();
  const st = mod.readState();
  const ms = Date.now() - t0;
  check("返回 ok:true", st && st.ok === true, st && st.error ? st.error : "用时 " + ms + "ms");
  if (!st || st.ok !== true) {
    console.log("  解析失败，后面依赖它的检查跳过：", JSON.stringify(st));
  } else {
    console.log("  status   =", st.status);
    console.log("  lastTool =", st.lastTool, "/ toolName =", st.toolName, "/ toolKind =", st.toolKind);
    console.log("  lastCommand =", JSON.stringify(st.lastCommand));
    console.log("  lastFile =", JSON.stringify(st.lastFile), "/ line =", JSON.stringify(st.lastFile));
    console.log("  toolCount =", st.toolCount, "/ lines =", st.lines, "/ turn =", st.turn);
    console.log("  lastEvent =", st.lastEvent, "/ lastEventAt =", st.lastEventAt);
    console.log("  todos =", JSON.stringify(st.todos), "/ waitingApproval =", st.waitingApproval, "/ doneAt =", st.doneAt);
    console.log("  file =", st.file);
    console.log("  sessionId =", st.sessionId, "/ ageMs =", Math.round(st.ageMs));
    hr();
    console.log(JSON.stringify(st, null, 2));

    check("status 在枚举内", STATUSES.includes(st.status), st.status);
    check("toolKind 合法", st.toolKind == null || KINDS.includes(st.toolKind), String(st.toolKind));
    check("todos 结构 {done,total} 且 done<=total", st.todos && typeof st.todos.done === "number" && typeof st.todos.total === "number" && st.todos.done <= st.todos.total, JSON.stringify(st.todos));
    check("ageMs >= 0 且是数字", typeof st.ageMs === "number" && st.ageMs >= 0, String(st.ageMs));
    check("file 是 sessions 下的相对路径（无盘符/无反斜杠）", typeof st.file === "string" && !/^[A-Za-z]:/.test(st.file) && st.file.indexOf("\\") < 0, st.file);
    check("必填字段齐全", REQUIRED.every((k) => Object.prototype.hasOwnProperty.call(st, k)), REQUIRED.filter((k) => !Object.prototype.hasOwnProperty.call(st, k)).join(",") || "all");

    // ——— 缓存：500ms 内同文件二次调用应命中 ———
    section("② 500ms 同文件缓存");
    const t1 = Date.now();
    const st2 = mod.readState();
    const ms2 = Date.now() - t1;
    check("二次调用 ok:true", st2 && st2.ok === true);
    check("二次调用 cached:true（命中缓存）", !!(st2 && st2.cached), "用时 " + ms2 + "ms");
    check("缓存结果 toolCount 一致", st2 && st2.toolCount === st.toolCount, (st2 && st2.toolCount) + " vs " + st.toolCount);
    check("缓存结果 ageMs 重新算过（>= 上次）", st2 && st2.ageMs >= st.ageMs - 5, (st2 && st2.ageMs) + " vs " + st.ageMs);

    // ——— 显式 ?file=：只允许 sessions 内的会话文件 ———
    section("③ ?file= 白名单 / 路径穿越防护");
    const byFile = mod.readState(st.file);
    check("合法相对路径可读", byFile && byFile.ok === true, byFile && byFile.error);
    check("读同一文件 sessionId 一致", byFile && byFile.ok === true && byFile.sessionId === st.sessionId);
    for (const bad of ["../../server.js", "../../../Windows/win.ini", "..\\..\\secret\\session.v4.jsonl.zstd",
      "C:/Windows/win.ini", "/etc/passwd", "..%2F..%2Fserver.js", "x".repeat(500)]) {
      const b = mod.readState(bad);
      check("拒绝 " + JSON.stringify(bad.length > 40 ? bad.slice(0, 40) + "…" : bad), b && b.ok === false, b && b.error);
    }
    const empty = mod.readState("");
    check("空 file 参数 = 不指定（回落到最新会话）", empty && empty.ok === true && empty.file === st.file, empty && empty.error);

    // ——— ④ 地面真值对比（独立实现）———
    section("④ 与「整文件逐帧解压」的地面真值对比");
    const fileAbs = require("node:path").join(mod.DSH_DIR, st.file);
    const truth = groundTruth(fileAbs);
    console.log("  真值：frames =", truth.frames, "/ events =", truth.events, "/ tool/call =", truth.toolCalls,
      "/ 最后 seq =", truth.lastSeq, "/ 最后事件 =", truth.lastType);
    check("帧数 > 0", truth.frames > 0, String(truth.frames));
    check("toolCount == 真值 tool/call 数", st.toolCount === truth.toolCalls, st.toolCount + " vs " + truth.toolCalls);
    check("lastTool == 真值最后工具名", st.lastTool === truth.lastToolName, st.lastTool + " vs " + truth.lastToolName);
    check("lastCommand 与真值一致", (st.lastCommand || null) === (truth.lastCommand || null), JSON.stringify(st.lastCommand) + " vs " + JSON.stringify(truth.lastCommand));
    check("lastEvent 与真值最后一条事件一致（同一 seq 段）", st.lastEvent === truth.lastType || st.lastEventAt >= (st.updatedAt - 60000), st.lastEvent + " vs " + truth.lastType);
  }

  // ——— ⑤ HTTP：对着真正在跑的服务 ———
  section("⑤ HTTP GET " + ENDPOINT);
  let httpSt = null;
  try {
    const r = await fetchJSON(ENDPOINT);
    check("HTTP 200", r.status === 200, "status " + r.status);
    check("响应是 JSON 且 ok:true", !!(r.json && r.json.ok === true), r.json && r.json.error);
    check("Cache-Control: no-store", (r.headers.get("cache-control") || "") === "no-store", r.headers.get("cache-control"));
    if (r.json) {
      httpSt = r.json;
      console.log(JSON.stringify(httpSt, null, 2));
      check("HTTP 返回字段齐全", REQUIRED.every((k) => Object.prototype.hasOwnProperty.call(httpSt, k)));
      check("HTTP status 在枚举内", STATUSES.includes(httpSt.status), httpSt.status);
    }
  } catch (e) {
    skip++;
    console.log("  ! 服务没在跑（" + (e && e.message) + "），跳过 HTTP 部分：先 node server.js");
  }

  if (httpSt) {
    section("⑥ HTTP 安全 / 回归");
    const trav = await fetchJSON(ENDPOINT + "?file=" + encodeURIComponent("../../server.js"));
    check("HTTP 路径穿越被拒（ok:false）", trav.status === 200 && trav.json && trav.json.ok === false, "status " + trav.status + " " + (trav.json && trav.json.error));

    const weird = await fetchJSON(ENDPOINT + "?file=%E0%A4%A");
    check("畸形 ?file= 不崩（HTTP 200 + JSON）", weird.status === 200 && !!weird.json, "status " + weird.status);
    check("畸形 ?file= 被拒", weird.json && weird.json.ok === false);

    const unsupported = await fetchJSON(ENDPOINT, { method: "POST", body: "{}" });
    check("POST /api/dsh/state → 405", unsupported.status === 405, "status " + unsupported.status);

    const page = await fetch(BASE + "/whale.html");
    check("GET /whale.html 仍 200", page.status === 200, "status " + page.status);
    const pageTxt = await page.text();
    check("whale.html 内容仍在", pageTxt.indexOf("whale") >= 0, pageTxt.length + " 字节");

    const chat = await fetchJSON(BASE + "/api/chat");
    check("GET /api/chat → 405（路由仍在，不花 token）", chat.status === 405 && !!chat.json, "status " + chat.status + " " + (chat.json && JSON.stringify(chat.json)));
    const missing = await fetch(BASE + "/no-such-file-xyz");
    check("不存在的静态文件仍 404", missing.status === 404, "status " + missing.status);

    // HTTP 与直调函数应给出一致结果（同一时刻同一文件）
    if (st && st.ok) {
      check("HTTP 与直调 file 一致", httpSt.file === st.file, httpSt.file);
      check("HTTP 与直调 sessionId 一致", httpSt.sessionId === st.sessionId);
      check("HTTP toolCount 与直调一致（差值 <= 轮询期间新增调用）", Math.abs(httpSt.toolCount - st.toolCount) <= 20, httpSt.toolCount + " vs " + st.toolCount);
    }
  }

  // ——— ⑦ 前端映射逻辑：在 vm 里跑 js/whale-dsh.js（假时钟 / 假 fetch，不碰真浏览器）———
  section("⑦ js/whale-dsh.js：意图映射 · 300ms 消抖 · 4s 保持 · 失败自停");
  await testClient();

  hr();
  console.log("结果：PASS " + pass + " / FAIL " + fail + (skip ? " / SKIP " + skip : ""));
  if (fail) { console.log("❌ 有检查没过"); process.exitCode = 1; }
  else { console.log("✅ 全部通过"); }
}

// 在 vm 沙箱里加载 js/whale-dsh.js：注入假时钟 / 假 fetch / 假 setInterval，一拍一拍驱动
async function testClient() {
  const src = fs.readFileSync(new URL("../js/whale-dsh.js", import.meta.url), "utf8");
  let clock = 1000000;
  let feed = { ok: true, status: "idle" };
  let mode = "ok";
  let cleared = false;
  const intervals = [];
  const logs = [];
  const csm = { log: (s) => logs.push(String(s)), warn: () => {} };

  const sandbox = {
    window: { console: csm },
    console: csm,
    Date: class FakeDate extends Date { static now() { return clock; } },
    setInterval: (fn, ms) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => { cleared = true; },
    setTimeout: () => 1,
    clearTimeout: () => {},
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    fetch: function () {
      if (mode === "fail") return Promise.reject(new Error("net down"));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(feed) });
    }
  };
  sandbox.Promise = Promise;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const W = sandbox.window.WhaleDSH;
  check("window.WhaleDSH 已暴露", !!W && typeof W.start === "function");
  if (!W) return;
  check("API 齐全 start/stop/get/busy/setOnIntent", ["start", "stop", "get", "busy", "setOnIntent"].every((k) => typeof W[k] === "function"));
  const INTENTS = ["idle", "read", "write", "shell", "web", "think", "error", "done", "waiting", "plan"];
  check("INTENT_ACT 覆盖全部 intent", INTENTS.every((i) => W.INTENT_ACT[i] && W.INTENT_ACT[i].kind && W.INTENT_ACT[i].name));

  const intents = [];
  const states = [];
  feed = { ok: true, status: "tool", toolKind: "shell", toolName: "ops_bash", turn: 1, toolCount: 1, lastCommand: "node server.js" };
  W.start((s) => states.push(s), { onIntent: (i, prev, p) => intents.push({ i: i, prev: prev, n: p.toolCount }) });
  for (let k = 0; k < 8; k++) await new Promise((r) => setTimeout(r, 0));
  check("首次轮询：意图仍 idle（消抖未满 300ms）", W.get().intent === "idle", W.get().intent);
  check("onState 被调用", states.length >= 1, String(states.length));

  async function tick(advance, next) {
    clock += advance;
    if (next !== undefined) feed = next;
    intervals[intervals.length - 1]();
    for (let k = 0; k < 8; k++) await new Promise((r) => setTimeout(r, 0));
  }

  // tool/shell：同一状态持续 >300ms 才提交
  await tick(400);
  check("tool/shell → 消抖后 intent=shell", W.get().intent === "shell", W.get().intent);
  check("onIntent 回调 shell（prev=idle）", intents.length === 1 && intents[0].i === "shell" && intents[0].prev === "idle", JSON.stringify(intents));
  check("busy()=true（干活中，app 会安静 90s）", W.busy() === true);
  check("act = clip hum", !!(W.get().act && W.get().act.kind === "clip" && W.get().act.name === "hum"), JSON.stringify(W.get().act));

  // tool/write
  const writeFeed = { ok: true, status: "tool", toolKind: "write", toolName: "edit", turn: 1, toolCount: 2, lastFile: "server.js" };
  await tick(700, writeFeed);
  check("写工具还没提交（需连续 300ms）", W.get().intent === "shell", W.get().intent);
  await tick(700, writeFeed);
  check("tool/write → intent=write", W.get().intent === "write", W.get().intent);
  check("onIntent write（prev=shell）", intents.length === 2 && intents[1].i === "write" && intents[1].prev === "shell", JSON.stringify(intents));

  // error
  const errFeed = { ok: true, status: "error", lastError: "Error: boom", errorAt: clock, turn: 1, toolCount: 3 };
  await tick(700, errFeed);
  await tick(700, errFeed);
  check("status=error → intent=error", W.get().intent === "error", W.get().intent);
  check("act = pose surprised", !!(W.get().act && W.get().act.kind === "pose"), JSON.stringify(W.get().act));

  // waiting 优先级最高（同一帧里还带一个过期的 lastError）
  const waitFeed = { ok: true, status: "tool", toolKind: "shell", waitingApproval: true, lastError: "old", errorAt: clock - 60000, turn: 1, toolCount: 4 };
  await tick(700, waitFeed);
  await tick(700, waitFeed);
  check("waitingApproval → intent=waiting（优先级高于 error）", W.get().intent === "waiting", W.get().intent);
  check("act = pose pout", !!(W.get().act && W.get().act.name === "pout"), JSON.stringify(W.get().act));
  check("busy()=false（等审批不算干活）", W.busy() === false);

  // 状态消失（服务端 ok:false）：先保持 4s 再回 idle
  await tick(700, { ok: false, error: "no session" });
  check("ok:false 之后不立刻回落（保持 waiting）", W.get().intent === "waiting", W.get().intent);
  await tick(1500, { ok: false, error: "no session" });
  check("状态消失约 2.2s 仍保持", W.get().intent === "waiting", W.get().intent);
  await tick(4000, { ok: false, error: "no session" });
  check("超过 4s 回落 idle", W.get().intent === "idle", W.get().intent);
  check("回落 idle 也有回调", intents.length > 0 && intents[intents.length - 1].i === "idle", JSON.stringify(intents[intents.length - 1] || null));

  // done：只在 8s 内有效
  const doneFeed = { ok: true, status: "done", doneAt: clock, turn: 2, toolCount: 5, todos: { done: 3, total: 3 } };
  await tick(700, doneFeed);
  await tick(700, doneFeed);
  check("status=done（8s 内）→ intent=done", W.get().intent === "done", W.get().intent);
  check("act = clip jump", !!(W.get().act && W.get().act.name === "jump"), JSON.stringify(W.get().act));

  // 收工后回落 idle：先 hold 4s
  await tick(1000, { ok: true, status: "idle", turn: 2, toolCount: 5 });
  check("done 之后 1s 仍保持 done", W.get().intent === "done", W.get().intent);
  await tick(3000, { ok: true, status: "idle", turn: 2, toolCount: 5 });
  check("满 4s 这拍还没提交（等消抖）", W.get().intent === "done", W.get().intent);
  await tick(700, { ok: true, status: "idle", turn: 2, toolCount: 5 });
  check("4s + 消抖后回 idle", W.get().intent === "idle", W.get().intent);

  // 连续失败 5 次自动停
  mode = "fail";
  for (let i = 0; i < 5; i++) await tick(700);
  check("连续 5 次失败后自动 stop（clearInterval 被调用）", cleared === true);
  check("停止时 console 打了一行", logs.length >= 1 && logs[logs.length - 1].indexOf("已停止轮询") >= 0, JSON.stringify(logs[logs.length - 1] || null));

  W.stop();
  check("stop() 后 get() 仍返回最后状态", !!W.get() && typeof W.get().intent === "string");
}

main().catch((e) => {
  console.error("测试脚本自己炸了：", e);
  process.exitCode = 1;
});
