/* whale-dsh.js — 让大肥鱼「看见」你在 DSH（DeepSeek Harness）里在干什么
 * ---------------------------------------------------------------------
 * 数据：GET /api/dsh/state（server.js 读 ~/.dsh/sessions 里最新会话的尾部）
 * 对外：window.WhaleDSH
 *   .start(onState, opts)   开始 700ms 轮询；onState(state) 每次成功都回调
 *   .stop()                 停止轮询（可再 start）
 *   .get()                  最近一次状态（含 intent / act / say）
 *   .busy()                 她是不是在干活（app 拿它把待机闲话拉长到 90s）
 *   .onIntent = fn          等价于 .setOnIntent(fn)
 *
 * intent：idle | read | write | shell | web | think | error | done | waiting | plan
 *   映射优先级（高→低）：waiting > error > done > tool_* > thinking > idle
 *   · waitingApproval / status=waiting        → waiting
 *   · status=error 或 8s 内的 lastError       → error
 *   · status=done 且 doneAt 在 8s 内          → done
 *   · status=tool → 按 toolKind → read/write/shell/web/plan（other 归到 think）
 *   · status=thinking                         → think
 *   · 其余                                    → idle
 * 消抖：同一状态持续 300ms 才算真变化；状态「消失」先保持 4s 再回 idle
 * 去重：同一个 turn 内同一个 intent 只回调一次（turn 变了重新算；idle 不算）
 * 容错：请求失败静默；连续 5 次失败自动 stop，并 console.log 一行
 * ---------------------------------------------------------------------
 * 用法（app 里）：
 *   WhaleDSH.onIntent = function (intent, prev, p) { if (intent === "shell") rig.play("hum"); };
 *   WhaleDSH.start(function (st) { tip.textContent = st.toolName || ""; });
 */
(function (global) {
  "use strict";

  var ENDPOINT = "/api/dsh/state";
  var POLL_MS = 700;        // 轮询间隔（服务端对同一文件有 500ms 缓存，不会重复解压）
  var DEBOUNCE_MS = 300;    // 同一状态持续 300ms 才认作真状态
  var HOLD_MS = 4000;       // 状态消失后先保持 4s，再回 idle
  var DONE_MS = 8000;       // done 只在 8s 内有效
  var FAIL_LIMIT = 5;       // 连续失败 5 次自动停
  var REQ_TIMEOUT_MS = 2500;

  // intent → 建议动作（都是 whale-render.js 里真实存在的 clip / pose；app 也可以无视它自己按 intent 演）
  var INTENT_ACT = {
    idle: { kind: "clip", name: "idle" },
    read: { kind: "clip", name: "think" },
    write: { kind: "clip", name: "hum" },
    shell: { kind: "clip", name: "hum" },
    web: { kind: "clip", name: "think" },
    think: { kind: "clip", name: "think" },
    error: { kind: "pose", name: "surprised" },
    done: { kind: "clip", name: "jump" },
    waiting: { kind: "pose", name: "pout" },
    plan: { kind: "pose", name: "content" }
  };

  var S = {
    timer: null, inFlight: false, fails: 0,
    state: null, intent: "idle", prev: "idle",
    cand: null, lastActiveAt: 0,
    turns: {}, turnOrder: [],
    onState: null, onIntent: null
  };

  function nowMs() { return Date.now(); }

  function safeCall(fn, a, b, c) {
    try { return fn(a, b, c); }
    catch (e) { if (global.console) console.warn("[WhaleDSH] 回调出错：", e); }
  }

  // toolKind → intent（other 在意图枚举里没有对应项，归到 think）
  function kindIntent(kind) {
    if (kind === "shell" || kind === "write" || kind === "read" || kind === "web" || kind === "plan") return kind;
    return "think";
  }

  // 服务端状态 → 原始意图（还没消抖）
  function intentOf(st) {
    if (!st || st.ok !== true) return null;
    var t = nowMs();
    if (st.waitingApproval || st.status === "waiting") return "waiting";
    if (st.status === "error") return "error";
    if (st.lastError && (!st.errorAt || t - st.errorAt <= DONE_MS)) return "error";
    if (st.status === "done" && st.doneAt && t - st.doneAt <= DONE_MS) return "done";
    if (st.status === "tool") return kindIntent(st.toolKind);
    if (st.status === "thinking") return "think";
    return "idle";
  }

  // 消抖 + 「消失后保持 4s」：返回本次是否真的换了意图
  function consider(raw, now) {
    if (raw == null) return { changed: false };
    if (raw !== "idle") S.lastActiveAt = now;
    // 状态消失（idle）时先按住上一个意图 4s，别一断就滑回待机
    if (raw === "idle" && S.intent !== "idle" && now - S.lastActiveAt < HOLD_MS) raw = S.intent;
    if (raw === S.intent) { S.cand = null; return { changed: false }; }
    if (!S.cand || S.cand.intent !== raw) { S.cand = { intent: raw, at: now }; return { changed: false }; }
    if (now - S.cand.at < DEBOUNCE_MS) return { changed: false };
    var from = S.intent;
    S.intent = raw;
    S.prev = from;
    S.cand = null;
    return { changed: true, from: from, to: raw };
  }

  function makeState(st, rawIntent, now) {
    return {
      ok: !!(st && st.ok === true),
      status: st ? st.status : "unknown",
      intent: S.intent,
      prev: S.prev,
      act: INTENT_ACT[S.intent] || null,
      say: null,
      rawIntent: rawIntent,
      toolName: st ? st.toolName : null,
      toolKind: st ? st.toolKind : null,
      lastCommand: st ? st.lastCommand : null,
      lastFile: st ? st.lastFile : null,
      toolCount: st && typeof st.toolCount === "number" ? st.toolCount : 0,
      todos: (st && st.todos) || { done: 0, total: 0 },
      waitingApproval: !!(st && st.waitingApproval),
      doneAt: st ? st.doneAt : null,
      lastError: st ? st.lastError : null,
      sessionId: st ? st.sessionId : null,
      turn: st ? st.turn : null,
      updatedAt: st ? st.updatedAt : 0,
      ageMs: st ? st.ageMs : null,
      at: now
    };
  }

  // 同一个 turn 内同一个 intent 只回调一次；idle 是回落，不参与去重
  function turnDedup(turn, intent) {
    if (turn == null || intent === "idle") return false;
    var key = String(turn);
    var m = S.turns[key];
    if (!m) {
      m = S.turns[key] = {};
      S.turnOrder.push(key);
      if (S.turnOrder.length > 6) delete S.turns[S.turnOrder.shift()];
    }
    if (m[intent]) return true;
    m[intent] = 1;
    return false;
  }

  function emitIntent(from, to, st) {
    if (turnDedup(st.turn, to)) return;
    if (typeof S.onIntent !== "function") return;
    var payload = {
      intent: to, prev: from, status: st.status,
      toolName: st.toolName, toolKind: st.toolKind,
      lastCommand: st.lastCommand, lastFile: st.lastFile,
      toolCount: st.toolCount, todos: st.todos, turn: st.turn,
      doneAt: st.doneAt, sessionId: st.sessionId,
      updatedAt: st.updatedAt, ageMs: st.ageMs, act: st.act
    };
    safeCall(S.onIntent, to, from, payload);
  }

  function publish(st) {
    S.state = st;
    if (typeof S.onState === "function") safeCall(S.onState, st);
  }

  // 服务端明确回 ok:false（比如没有会话文件）：不算请求失败，先保持，超过 4s 才回 idle
  function onHold(now) {
    if (S.intent === "idle" || now - S.lastActiveAt < HOLD_MS) return;
    var from = S.intent;
    S.intent = "idle";
    S.prev = from;
    S.cand = null;
    var st = makeState(null, "idle", now);
    publish(st);
    emitIntent(from, "idle", st);
  }

  function onData(d) {
    if (!S.timer) return;                 // 已经 stop：迟到的响应丢掉
    var now = nowMs();
    if (!d || d.ok !== true) { onHold(now); return; }
    S.fails = 0;
    var raw = intentOf(d);
    var info = consider(raw, now);
    var st = makeState(d, raw, now);
    publish(st);
    if (info.changed) emitIntent(info.from, info.to, st);
  }

  function onFail() {
    if (!S.timer) return;
    S.fails++;
    if (S.fails >= FAIL_LIMIT) {
      stop();
      if (global.console) {
        console.log("[WhaleDSH] 连续 " + FAIL_LIMIT + " 次读取 " + ENDPOINT + " 失败，已停止轮询（检查 server.js 是否重启、5173 是否在跑）");
      }
      return;
    }
    onHold(nowMs());
  }

  function poll() {
    if (S.inFlight) return;
    S.inFlight = true;
    var ac = null, timer = null;
    try { ac = new AbortController(); } catch (e) { ac = null; }
    if (ac) timer = setTimeout(function () { try { ac.abort(); } catch (e) {} }, REQ_TIMEOUT_MS);
    function finish() { S.inFlight = false; if (timer) clearTimeout(timer); }
    try {
      fetch(ENDPOINT, { cache: "no-store", signal: ac ? ac.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .then(function (d) { finish(); onData(d); })
        .catch(function () { finish(); onFail(); });
    } catch (e) { finish(); onFail(); }
  }

  function start(onState, opts) {
    if (typeof onState === "function") S.onState = onState;
    if (opts && typeof opts === "object") {
      if (typeof opts.onState === "function") S.onState = opts.onState;
      if (typeof opts.onIntent === "function") S.onIntent = opts.onIntent;
    }
    if (S.timer) return api;              // 已经在跑
    S.fails = 0;
    S.cand = null;
    S.lastActiveAt = nowMs();
    poll();
    S.timer = setInterval(poll, POLL_MS);
    return api;
  }

  function stop() {
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
    S.inFlight = false;
    S.cand = null;
    return api;
  }

  function get() { return S.state; }

  // 她是不是在干活：app 用它决定待机闲话要不要安静 90s
  function busy() {
    var i = S.intent;
    return i === "shell" || i === "write" || i === "read" || i === "web" || i === "think" || i === "plan";
  }

  function setOnIntent(fn) { S.onIntent = (typeof fn === "function") ? fn : null; return api; }

  var api = {
    start: start,
    stop: stop,
    get: get,
    busy: busy,
    setOnIntent: setOnIntent,
    INTENT_ACT: INTENT_ACT,
    POLL_MS: POLL_MS
  };
  Object.defineProperty(api, "onIntent", {
    get: function () { return S.onIntent; },
    set: function (fn) { S.onIntent = (typeof fn === "function") ? fn : null; },
    configurable: true
  });
  Object.defineProperty(api, "intent", {
    get: function () { return S.intent; },
    configurable: true
  });

  global.WhaleDSH = api;
})(window);
