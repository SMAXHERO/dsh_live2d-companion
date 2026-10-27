// 极简静态服务器 + LLM 代理（只为让浏览器能加载本地模型；file:// 会因为跨域失败）
// 代理存在的意义：API key 留在服务端，不进入网页源码；顺便绕开浏览器跨域。
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5173);
const LOCAL_CONF = path.join(ROOT, "config.local.json");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".moc3": "application/octet-stream",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon"
};

// config.local.json 每次请求都重新读 —— 改完配置不用重启服务
function localConfig() {
  try { return JSON.parse(fs.readFileSync(LOCAL_CONF, "utf8")); } catch (e) { return {}; }
}

// key 打码：日志/screenshot 里只出现 sk-…5748，不出现完整 key
function maskKey(k) {
  k = String(k || "");
  return k ? k.slice(0, 3) + "…" + k.slice(-4) : "";
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > limit) { reject(new Error("body too large")); req.destroy(); }
    });
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

function sendJSON(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(s);
}

// 从 SSE 尾巴里挑最后一次 usage（前端拿到的也是同一份；这里只用来打日志）
function lastUsage(txt) {
  const re = /"usage"\s*:\s*\{"prompt_tokens":(\d+),"completion_tokens":(\d+)/g;
  let m, out = null;
  while ((m = re.exec(txt))) out = { in: +m[1], out: +m[2] };
  return out;
}

// ——— LLM 代理：浏览器 -> 这里 -> OpenAI 兼容接口 ———
async function handleChat(req, res) {
  const cfg = localConfig();
  const apiKey = cfg.apiKey || process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) return sendJSON(res, 500, { error: "config.local.json 里没有 apiKey" });

  let payload;
  try { payload = JSON.parse(await readBody(req, 256 * 1024)); }
  catch (e) { return sendJSON(res, 400, { error: "bad json" }); }

  const base = String(cfg.baseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const body = {
    model: cfg.model || payload.model || "deepseek-flash",
    messages: payload.messages || [],
    temperature: payload.temperature == null ? 1.0 : payload.temperature,
    max_tokens: payload.max_tokens || cfg.maxTokens || 400,
    stream: false
  };
  // 陪伴对话要快：默认关掉思考链（模型支持时），并且要 JSON 就一并要求 JSON
  if (cfg.thinking !== "on") body.thinking = { type: "disabled" };
  if (cfg.json !== false) body.response_format = { type: "json_object" };

  const t0 = Date.now();

  async function upstream(b) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs || 15000);
    try {
      const r = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify(b || body),
        signal: ac.signal
      });
      const txt = await r.text();
      return { status: r.status, txt };
    } finally {
      clearTimeout(timer);
    }
  }

  function contentOf(txt) {
    try {
      const j = JSON.parse(txt);
      const m = j && j.choices && j.choices[0] && j.choices[0].message;
      return (m && typeof m.content === "string") ? m.content.trim() : "";
    } catch (e) { return ""; }
  }

  // ——— 流式：把上游 SSE 原样透传给浏览器，首字几百毫秒就显示 ———
  if (payload.stream === true) {
    body.stream = true;
    // 让上游在最后一块把 usage 带回来（前端据此显示真实 token 与花费）
    if (cfg.streamUsage !== false) body.stream_options = { include_usage: true };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs || 20000);

    // 上游 SSE -> 浏览器（边收边转，不攒完整包）
    async function pipe(r) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      let first = 0, bytes = 0, tail = "";
      const reader = r.body.getReader();
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        if (!first) first = Date.now() - t0;
        bytes += step.value.length;
        tail = (tail + Buffer.from(step.value).toString("utf8")).slice(-20000);   // 只留尾巴，末尾那块 usage 别丢
        res.write(Buffer.from(step.value));
      }
      const u = lastUsage(tail);
      console.log("[llm] stream " + body.model + " 首字节 " + first + "ms, 共 " + bytes + "B, " + (Date.now() - t0) + "ms" +
        (u ? ", token in=" + u.in + " out=" + u.out : ", token 未知（上游没回 usage）"));
      res.end();
    }

    async function open(b) {
      const r = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey, Accept: "text/event-stream" },
        body: JSON.stringify(b),
        signal: ac.signal
      });
      return { r: r, ct: r.headers.get("content-type") || "" };
    }

    try {
      let { r, ct } = await open(body);
      if (!r.ok || ct.indexOf("text/event-stream") < 0) {
        const bad = await r.text();
        // 典型原因：①response_format 要求提示词里出现 "json" 字样，没出现就 400；
        // ②上游不认 stream_options（那就没有 usage 了，前端会显示 ≈）。
        // 去掉出问题的参数再要一次流；再要不到才退回普通 JSON（前端能认）。
        const drop = {};
        if (r.status === 400 && /json/i.test(bad)) drop.response_format = 1;   // 提示词里没有 "json" 字样
        if (r.status === 400 && /stream_options/i.test(bad)) drop.stream_options = 1;  // 上游不认这个参数
        if (Object.keys(drop).length) {
          const b2 = Object.assign({}, body);
          Object.keys(drop).forEach(function (k) { delete b2[k]; });
          const again = await open(b2);
          if (again.r.ok && again.ct.indexOf("text/event-stream") >= 0) {
            console.log("[llm] stream 去掉 " + Object.keys(drop).join("+") + " 后重试成功");
            return await pipe(again.r);
          }
          const t2 = await again.r.text();
          console.log("[llm] stream 降级 " + again.r.status + " " + (Date.now() - t0) + "ms");
          res.writeHead(again.r.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          return res.end(t2);
        }
        // 上游直接回非流式 200（少见）：原样转给前端，前端按普通 JSON 处理
        console.log("[llm] stream 降级 " + r.status + " ct=" + ct.split(";")[0] + " " + (Date.now() - t0) + "ms");
        res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(bad);
      }
      return await pipe(r);
    } catch (e) {
      const msg = e && e.name === "AbortError" ? "上游超时" : String((e && e.message) || e);
      console.warn("[llm] stream 失败：", msg);
      if (!res.headersSent) sendJSON(res, 502, { error: msg }); else try { res.end(); } catch (_) {}
    } finally {
      clearTimeout(timer);
    }
    return;
  }

  try {
    let out = await upstream();
    let len = contentOf(out.txt).length;
    // 上游嫌 json_object 却找不到 "json" 字样时的兜底：去掉约束重来一次
    if (out.status === 400 && /json_object/i.test(out.txt)) {
      const b2 = Object.assign({}, body); delete b2.response_format;
      out = await upstream(b2); len = contentOf(out.txt).length;
    }
    // 偶发空回复（实测模型偶尔只吐一串空格）：换一种问法重试一次，别让前端白等
    if (out.status === 200 && !len) {
      console.warn("[llm] 空回复，换问法重试");
      const retryBody = Object.assign({}, body);
      delete retryBody.response_format;              // 去掉 JSON 约束，先让它肯开口
      retryBody.messages = body.messages.concat([
        { role: "system", content: "上一条回复是空的。现在必须说点什么，并严格按这个结构输出一个 JSON 对象，say 不能为空：{\"say\":\"…\",\"mood\":{\"label\":\"…\",\"intensity\":2,\"valence\":0,\"arousal\":0.3,\"cause\":\"…\"}}" }
      ]);
      out = await upstream(retryBody);
      len = contentOf(out.txt).length;
    }
    const nu = lastUsage(out.txt) || (function () {
      try {
        const j = JSON.parse(out.txt), uu = j && j.usage;
        return uu ? { in: uu.prompt_tokens, out: uu.completion_tokens } : null;
      } catch (e) { return null; }
    })();
    console.log("[llm] " + body.model + " " + out.status + " " + (Date.now() - t0) + "ms content=" + len + "字" +
      (nu ? ", token in=" + nu.in + " out=" + nu.out : ""));
    res.writeHead(out.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(out.txt);
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "上游超时" : String((e && e.message) || e);
    console.warn("[llm] 失败：", msg);
    sendJSON(res, 502, { error: msg });
  }
}

// ——— DSH（DeepSeek Harness）会话状态：让大肥鱼「看见」你在终端里在干什么 ———
// 数据源：%USERPROFILE%\.dsh\sessions\<工作目录编码>\<sessionId>\session.v4.jsonl.zstd
// · 文件是「多帧 zstd 拼接」：一帧 = 一小批 JSONL 行，一行 = 一个事件
// · node 的 zlib.zstdDecompressSync(buf) 只解「缓冲区开头的第一帧」，后面的整段忽略；
//   帧没写完会解出空/抛错 —— 所以逐帧解，半帧跳过，offset 只推进到「最后一个能完整解出的帧」起点
// · 只从文件尾部读（≤8MB）+ 增量续读，不整文件进内存
// 真实事件（抓包）长这样：
//   {"type":"tool/call","seq":69,"time":1793088155486,"data":{"turn":1,"step":7,"callId":"call_...","name":"run_code","arguments":"{\"code\":\"...\"}"}}
//   {"type":"tool/ptc-dispatch-start","seq":70,...,"data":{"subCallId":"call_...:ptc:1","name":"ops_bash","arguments":{"command":"ls -R ~/.dsh/sessions"}}}   ← PTC 里的子工具
//   {"type":"tool/result","seq":83,...,"data":{"message":{"toolCallId":"call_...","isError":false,"content":[{"type":"text","text":"..."}]}}}
//   {"type":"turn/end","data":{"turn":1,"reason":{"kind":"completed"}}}   // completed|error|aborted|interrupted
//   {"type":"approval/asked","data":{"id":"...","toolName":"ops_bash","callId":"call_...","reason":"..."}} + approval/decided {id,outcome}
//   {"type":"todo/write","data":{"todos":[{"content":"...","status":"pending|in_progress|completed"}]}}
const DSH_DIR = path.join(os.homedir(), ".dsh", "sessions");
const DSH_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);   // zstd 帧头 magic
const DSH_TAIL_MAX = 8 * 1024 * 1024;   // 单次最多读 8MB（上限保护）
const DSH_KEEP = 600;                   // 内存里最多留 600 条事件
const DSH_WINDOW = 400;                 // 推导状态只看最后 400 条
const DSH_CACHE_MS = 500;               // 同文件 + 同 mtime，500ms 内直接复用（前端 700ms 轮一次）
const DSH_ERROR_TTL = 8000;             // 报错只「炸毛」8 秒
const DSH_THINK_STALE = 120000;         // 一直 thinking 却没有新事件 → 当 idle
const DSH_TOOL_STALE = 900000;          // 工具调用挂了 15 分钟 → 当 idle

// 工具名 → 大类（前端据此决定动作）
const DSH_KINDS = {
  pwsh: "shell", bash: "shell", ops_bash: "shell", command: "shell",
  edit: "write", write: "write", ops_replace: "write", ops_write_file: "write",
  read: "read", glob: "read", grep: "read", read_image: "read", ops_read_files: "read",
  ops_inspect_local_file: "read", ops_glob: "read", ops_grep: "read", read_table: "read",
  web_search: "web", web_fetch: "web",
  todo_write: "plan", spawn_teammate: "plan", wait_agent: "plan", send_message: "plan",
  team_task_create: "plan", team_task_get: "plan", team_task_update: "plan", team_task_list: "plan"
};

function dshKind(name) {
  const n = String(name || "");
  if (DSH_KINDS[n]) return DSH_KINDS[n];
  if (/^web[_-]/i.test(n)) return "web";
  if (/^(task|todo|team|plan|goal)/i.test(n)) return "plan";
  if (/^(read|glob|grep|list|get_|search_context|decompress|acp_|inspect)/i.test(n)) return "read";
  if (/^(edit|write|ops_(replace|write)|copy|move|remove|apply)/i.test(n)) return "write";
  if (/^(pwsh|bash|shell|command)/i.test(n)) return "shell";
  return "other";
}

// 一行文本 → 压成单行 + 截断（命令/错误给前端显示用）
function dshShort(v, n) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// 工具结果里的错误文本
function dshErrText(m) {
  let txt = "";
  if (m && Array.isArray(m.content)) {
    for (let i = 0; i < m.content.length; i++) {
      const c = m.content[i];
      if (c && c.type === "text" && c.text) { txt = c.text; break; }
    }
  }
  if (!txt && m && m.error) txt = m.error.message || m.error.code || "";
  return dshShort(txt, 140);
}

// 从工具入参（可能是 JSON 字符串，也可能已经是对象）里抽 command / file_path
function dshToolArgs(e, args) {
  let a = args;
  if (typeof a === "string") { try { a = JSON.parse(a); } catch (err) { return; } }
  if (!a || typeof a !== "object") return;
  const cmd = a.command || a.cmd || a.script;
  if (cmd) e.cmd = dshShort(cmd, 60);
  let f = a.file_path || a.path || "";
  if (!f && Array.isArray(a.files) && a.files[0]) {
    const x = a.files[0];
    f = (x && (x.path || x.file_path)) || "";
  }
  if (f) e.file = path.basename(String(f).replace(/[\\/]+$/, ""));
  if (Array.isArray(a.todos)) e.todos = a.todos.map((x) => ({ status: x && x.status }));
}

// 大事件 → 小事件：只留推导状态要用的字段，assistant/message 正文一律丢掉
function dshCompact(o) {
  const t = o && o.type;
  if (!t) return null;
  const d = o.data || {};
  const e = { t: t, time: o.time || 0 };
  if (o.seq != null) e.seq = o.seq;
  if (t === "session") {
    e.id = d.id; e.cwd = d.cwd;
  } else if (t === "turn/start") {
    e.turn = d.turn;
  } else if (t === "turn/end") {
    e.turn = d.turn;
    e.kind = (d.reason && d.reason.kind) || "unknown";
    if (d.reason && d.reason.error) e.error = dshShort(d.reason.error.message, 140);
  } else if (t === "step/start" || t === "step/end") {
    e.turn = d.turn; e.step = d.step;
  } else if (t === "tool/call") {
    e.name = d.name; e.callId = d.callId; e.turn = d.turn;
    dshToolArgs(e, d.arguments);
  } else if (t === "tool/ptc-dispatch-start") {
    e.name = d.name; e.subCallId = d.subCallId; e.turn = d.turn;
    dshToolArgs(e, d.arguments);
  } else if (t === "tool/ptc-dispatch") {
    e.name = d.name; e.subCallId = d.subCallId;
    if (d.isError) { e.isError = true; e.error = dshErrText(d); }
  } else if (t === "tool/result") {
    const m = d.message || {};
    e.callId = m.toolCallId || (m.source && m.source.callId) || d.callId;
    if (d.turn != null) e.turn = d.turn;
    if (m.isError) { e.isError = true; e.error = dshErrText(m); }
  } else if (t === "approval/asked") {
    e.id = d.id; e.toolName = d.toolName;
  } else if (t === "approval/decided") {
    e.id = d.id; e.outcome = d.outcome;
  } else if (t === "todo/write") {
    if (Array.isArray(d.todos)) e.todos = d.todos.map((x) => ({ status: x && x.status }));
  } else if (t === "job/registered") {
    e.jobId = d.jobId; e.kind = d.kind; e.label = dshShort(d.label, 120);
  } else if (t === "job/settled") {
    e.jobId = d.jobId;
  }
  return e;
}

// 解析缓存（单会话）：只在内存里，不落盘
const dshCache = {
  file: "", mtimeMs: 0, size: 0, offset: 0, lastSeq: -1,
  toolCount: 0, events: [], sessionId: "", cwd: "", at: 0
};
let dshLast = null;                       // 上一次返回结果（500ms 内复用）
let dshScanAt = 0, dshScanBest = null;    // 扫描结果也缓存 400ms

// 最新更新的 session 文件：sessions/<cwd 编码>/<sessionId>/session.v4.jsonl.zstd
function dshNewest(now) {
  if (now - dshScanAt < 400) return dshScanBest;
  let dirs;
  try { dirs = fs.readdirSync(DSH_DIR, { withFileTypes: true }); } catch (e) { return null; }
  let best = null;
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let subs;
    try { subs = fs.readdirSync(path.join(DSH_DIR, d.name), { withFileTypes: true }); } catch (e) { continue; }
    for (const s of subs) {
      if (!s.isDirectory()) continue;
      const dir2 = path.join(DSH_DIR, d.name, s.name);
      let files;
      try { files = fs.readdirSync(dir2, { withFileTypes: true }); } catch (e) { continue; }
      for (const f of files) {
        if (!f.isFile() || !/\.jsonl\.zstd$/i.test(f.name)) continue;
        const fp = path.join(dir2, f.name);
        let st;
        try { st = fs.statSync(fp); } catch (e) { continue; }
        if (st.size <= 0) continue;
        if (!best || st.mtimeMs > best.mtimeMs) best = { file: fp, mtimeMs: st.mtimeMs, size: st.size };
      }
    }
  }
  dshScanAt = now;
  dshScanBest = best;
  return best;
}

// ?file= 只允许 sessions 目录里的会话文件；穿越 / 绝对路径 / 别的后缀一律拒绝
function dshResolveFile(raw) {
  const s = String(raw || "").trim().replace(/\\/g, "/");
  if (!s || s.length > 400) return null;
  const abs = path.resolve(DSH_DIR, s);
  const rel = path.relative(DSH_DIR, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (!/\.jsonl\.zstd$/i.test(abs)) return null;
  return abs;
}

// 读文件的一段：按 magic 找帧，逐帧解 → 事件数组 + 最后一个完整帧的起点
function dshRead(file, start, end) {
  const len = Math.max(0, end - start);
  if (!len) return { events: [], lastFrameAt: -1 };
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, "r");
  try { fs.readSync(fd, buf, 0, len, start); } finally { try { fs.closeSync(fd); } catch (e) {} }
  const offs = [];
  let p = -1;
  while ((p = buf.indexOf(DSH_MAGIC, p + 1)) !== -1) offs.push(p);
  const events = [];
  let lastFrameAt = -1;
  for (let i = 0; i < offs.length; i++) {
    const off = offs[i];
    let out;
    try { out = zlib.zstdDecompressSync(buf.subarray(off)); } catch (e) { continue; }
    if (!out || !out.length) continue;
    const lines = out.toString("utf8").split("\n");
    lines.pop();   // 末尾：完整帧是空串，半帧是写了一半的行 —— 都丢掉；半帧下次重解
    if (!lines.length) continue;
    for (let j = 0; j < lines.length; j++) {
      if (!lines[j]) continue;
      let obj;
      try { obj = JSON.parse(lines[j]); } catch (e) { continue; }
      events.push(obj);
    }
    lastFrameAt = start + off;
  }
  return { events: events, lastFrameAt: lastFrameAt };
}

// 收事件：seq 去重（重解上一个帧会重复读到旧事件）；无 seq 的只留 session（流式 chunk 没用）
function dshAccept(events) {
  for (let i = 0; i < events.length; i++) {
    const o = events[i];
    if (o.seq == null) {
      if (o.type !== "session") continue;
    } else {
      if (o.seq <= dshCache.lastSeq) continue;
      dshCache.lastSeq = o.seq;
    }
    const e = dshCompact(o);
    if (!e) continue;
    dshCache.events.push(e);
    if (dshCache.events.length > DSH_KEEP) dshCache.events.shift();
    if (e.t === "tool/call") dshCache.toolCount++;
    if (e.t === "session") {
      if (e.id) dshCache.sessionId = e.id;
      if (e.cwd) dshCache.cwd = e.cwd;
    }
  }
}

// 整段重读（换文件 / 文件被截断 / 一步跨过 8MB）
function dshLoadFull(file, st) {
  dshCache.file = file;
  dshCache.lastSeq = -1;
  dshCache.toolCount = 0;
  dshCache.events = [];
  dshCache.sessionId = path.basename(path.dirname(file));
  dshCache.cwd = "";
  const start = Math.max(0, st.size - DSH_TAIL_MAX);
  const got = dshRead(file, start, st.size);
  dshAccept(got.events);
  dshCache.offset = got.lastFrameAt >= 0 ? got.lastFrameAt : st.size;
  dshCache.mtimeMs = st.mtimeMs;
  dshCache.size = st.size;
}

// 增量续读：从上次的帧起点开始（顺带重解那一个帧，靠 seq 去重）
function dshLoadInc(file, st) {
  const got = dshRead(file, dshCache.offset, st.size);
  dshAccept(got.events);
  if (got.lastFrameAt >= 0) dshCache.offset = got.lastFrameAt;
  dshCache.mtimeMs = st.mtimeMs;
  dshCache.size = st.size;
}

function dshRel(file) {
  try { return path.relative(DSH_DIR, file).replace(/\\/g, "/"); } catch (e) { return String(file || ""); }
}

// 最后一条事件 → 状态
function dshStatusOf(last) {
  switch (last.t) {
    case "turn/end":
      if (last.kind === "completed") return "done";
      if (last.kind === "error") return "error";
      return "idle";                       // aborted / interrupted
    case "session/end-seed":
    case "command/done":
      return "idle";
    case "user/message":
    case "agent/inbox/spliced":
    case "turn/start":
    case "step/start":
    case "step/end":
    case "tool/result":
    case "assistant/message":
    case "assistant/chunk":
    case "assistant/attempt":
    case "request/header":
    case "request/context":
    case "llm/retry":
    case "llm/retry-started":
    case "session/title":
    case "session/title-llm-request":
    case "web/deepseek-search-llm-request":
    case "todo/write":
    case "workspace/changes":
    case "deliverables/presented":
    case "team/task":
    case "job/registered":
    case "job/settled":
      return "thinking";
    default:
      return "unknown";
  }
}

// 缓存命中时也重算 ageMs
function dshAge(state, now) {
  const out = Object.assign({}, state);
  out.ageMs = Math.max(0, now - (state.updatedAt || now));
  out.cached = true;
  return out;
}

// 把尾窗事件推导成前端要的扁平状态
function dshDerive(now) {
  const evs = dshCache.events;
  const tail = evs.length > DSH_WINDOW ? evs.slice(evs.length - DSH_WINDOW) : evs;
  const approvals = new Map();
  const calls = new Map();
  const subs = new Map();
  let lastTurnEnd = null, lastToolEvent = null, lastTodo = null, lastTurn = null;
  let lastError = "", errorAt = 0, doneAt = 0;
  for (let i = 0; i < tail.length; i++) {
    const e = tail[i];
    if (e.turn != null && (lastTurn == null || e.turn > lastTurn)) lastTurn = e.turn;
    switch (e.t) {
      case "approval/asked":
        approvals.set(e.id, e);
        break;
      case "approval/decided":
        approvals.delete(e.id);
        break;
      case "tool/call":
        calls.set(e.callId, e);
        lastToolEvent = e;
        if (e.name === "todo_write" && e.todos) lastTodo = e;
        break;
      case "tool/result":
        calls.delete(e.callId);
        break;
      case "tool/ptc-dispatch-start":
        subs.set(e.subCallId, e);
        lastToolEvent = e;
        break;
      case "tool/ptc-dispatch":
        subs.delete(e.subCallId);
        if (e.isError) { lastError = e.error || "tool error"; errorAt = e.time; }
        break;
      case "turn/end":
        lastTurnEnd = e;
        if (e.kind === "completed") doneAt = e.time;
        else if (e.kind === "error") { lastError = e.error || "turn error"; errorAt = e.time; }
        break;
      case "todo/write":
        if (e.todos) lastTodo = e;
        break;
      default:
        break;
    }
    if (e.t === "tool/result" && e.isError) { lastError = e.error || "tool error"; errorAt = e.time; }
  }

  const fresh = (e) => !lastTurnEnd || e.time >= lastTurnEnd.time;
  let approvalTool = "";
  approvals.forEach((e) => { if (fresh(e)) approvalTool = e.toolName || "?"; });
  let active = null;
  subs.forEach((e) => { if (fresh(e) && (!active || e.time >= active.time)) active = e; });
  calls.forEach((e) => { if (fresh(e) && (!active || e.time >= active.time)) active = e; });
  const asking = !!(active && active.name === "ask_user_question");
  const waiting = !!approvalTool || asking;

  const last = tail.length ? tail[tail.length - 1] : null;
  const lastAt = last ? last.time : 0;
  let status = "unknown";
  if (waiting) status = "waiting";
  else if (active) status = "tool";
  else if (last) status = dshStatusOf(last);

  if (status === "thinking" && now - lastAt > DSH_THINK_STALE) status = "idle";
  if (status === "tool" && active && now - active.time > DSH_TOOL_STALE) { status = "idle"; active = null; }
  if (now - errorAt > DSH_ERROR_TTL) lastError = "";
  if (status === "error" && !lastError) status = "idle";

  let toolName = null;
  if (approvalTool) toolName = approvalTool;
  else if (active) toolName = active.name;
  else if (lastToolEvent) toolName = lastToolEvent.name;

  let lastCommand = "", lastFile = "";
  for (let i = tail.length - 1; i >= 0; i--) {
    const e = tail[i];
    if (!lastCommand && e.cmd) lastCommand = e.cmd;
    if (!lastCommand && e.t === "job/registered" && e.label) lastCommand = e.label;
    if (!lastFile && e.file) lastFile = e.file;
    if (lastCommand && lastFile) break;
  }

  const todos = { done: 0, total: 0 };
  if (lastTodo && Array.isArray(lastTodo.todos)) {
    todos.total = lastTodo.todos.length;
    for (let i = 0; i < lastTodo.todos.length; i++) {
      if (lastTodo.todos[i] && lastTodo.todos[i].status === "completed") todos.done++;
    }
  }

  return {
    ok: true,
    file: dshRel(dshCache.file),
    sessionId: dshCache.sessionId || path.basename(path.dirname(dshCache.file || "")),
    cwd: dshCache.cwd || "",
    updatedAt: Math.round(dshCache.mtimeMs),
    ageMs: Math.round(Math.max(0, now - dshCache.mtimeMs)),
    status: status,
    toolName: toolName,
    toolKind: toolName ? dshKind(toolName) : null,
    lastCommand: dshShort(lastCommand, 60) || null,
    lastFile: lastFile || null,
    toolCount: dshCache.toolCount,
    lastError: lastError || null,
    errorAt: lastError ? errorAt : null,
    waitingApproval: waiting,
    doneAt: doneAt || null,
    todos: todos,
    lines: tail.length,
    turn: lastTurn,
    lastTool: lastToolEvent ? lastToolEvent.name : null,
    lastEvent: last ? last.t : null,
    lastEventAt: lastAt || null,
    cached: false
  };
}

// GET /api/dsh/state 的实现：找最新会话 → 增量读 → 推导扁平状态（任何异常都吞成 {ok:false}）
function readState(fileArg) {
  const now = Date.now();
  try {
    let file = "";
    if (fileArg) {
      file = dshResolveFile(fileArg);
      if (!file) return { ok: false, error: "bad file param" };
    } else {
      const best = dshNewest(now);
      if (!best) return { ok: false, error: "no dsh session file" };
      file = best.file;
    }
    // 500ms 缓存：同一个文件才复用（只重算 ageMs）
    if (dshLast && now - dshCache.at < DSH_CACHE_MS && file === dshCache.file) {
      return dshAge(dshLast, now);
    }
    const st = fs.statSync(file);
    if (!st.isFile()) return { ok: false, error: "not a file" };
    if (dshCache.file !== file) dshLoadFull(file, st);
    else if (st.size === dshCache.size && st.mtimeMs === dshCache.mtimeMs) { /* 没有新数据 */ }
    else if (st.size > dshCache.size && dshCache.offset > 0 && st.size - dshCache.offset <= DSH_TAIL_MAX) dshLoadInc(file, st);
    else dshLoadFull(file, st);
    dshCache.at = now;
    dshLast = dshDerive(now);
    return dshLast;
  } catch (e) {
    const code = (e && e.code) || "";
    const msg = code === "ENOENT" ? "session file not found"
      : code === "EACCES" || code === "EPERM" ? "session file unreadable"
      : dshShort((e && e.message) || e, 120);
    return { ok: false, error: msg || "dsh read failed" };
  }
}

// 路由入口（抽成函数是为了能用 require('./server.js') 拿 readState() 而不 listen）
function handleRequest(req, res) {
  // 非 ASCII / 畸形百分号编码不能把整个服务打挂（之前就崩过一次）
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split("?")[0]); }
  catch (e) { res.writeHead(400); return res.end("400 bad url"); }

  if (urlPath === "/api/chat" && req.method === "POST") return handleChat(req, res);
  if (urlPath === "/api/chat") return sendJSON(res, 405, { error: "POST only" });

  // DSH 会话状态：只读本地 ~/.dsh/sessions，失败也只回 {ok:false}，不影响服务
  if (urlPath === "/api/dsh/state") {
    if (req.method !== "GET") return sendJSON(res, 405, { ok: false, error: "GET only" });
    let fileArg = "";
    try { fileArg = new URLSearchParams(String(req.url.split("?")[1] || "")).get("file") || ""; } catch (e) { fileArg = ""; }
    let out;
    try { out = readState(fileArg); } catch (e) { out = { ok: false, error: dshShort((e && e.message) || e, 120) }; }
    return sendJSON(res, 200, out);
  }

  let p = urlPath;
  if (p === "/") p = "/whale.html";
  // 私密/内部文件不外发：本地配置、.env、命令行工具目录、批处理脚本
  if ((/\.local\.json$/i.test(p) && !/\.example\.json$/i.test(p)) ||
      /^\/(config\.private|\.env|tools\/)/i.test(p) || /\.bat$/i.test(p)) {
    res.writeHead(404); return res.end("404");
  }
  const safe = path.normalize(p).replace(/^(\.\.[\/\\])+/, "");
  const file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("403"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("404 " + p); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}

const server = http.createServer(handleRequest);

// 单测可以 require 本文件拿 readState()，不会 listen
if (require.main === module) {
  server.listen(PORT, () => {
    const cfg = localConfig();
    const key = cfg.apiKey || process.env.DEEPSEEK_API_KEY || "";
    const fromEnv = !cfg.apiKey && !!process.env.DEEPSEEK_API_KEY;
    const llmState = key
      ? ("已接入 " + (cfg.model || "deepseek-flash") + "（key " + maskKey(key) + (fromEnv ? "，来自环境变量 DEEPSEEK_API_KEY" : "") + "）")
      : "未接入（没有 apiKey：双击 换key.bat 写入，或设环境变量 DEEPSEEK_API_KEY）";
    console.log("大肥鱼 已启动 -> http://127.0.0.1:" + PORT + "/whale.html");
    console.log("LLM: " + llmState);
  });
}

module.exports = {
  readState: readState,
  DSH_DIR: DSH_DIR
};
