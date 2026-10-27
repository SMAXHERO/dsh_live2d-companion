/* ============================================================
 * whale-app.js — 大肥鱼 陪伴页逻辑
 * 情绪状态机 → 动作编排 → 台词 → 面板；可选 LLM / TTS / ASR
 * ============================================================ */
(function () {
  'use strict';

  var A = window.APP_CONFIG || {};
  var WH = A.whale || {};
  var Q = new URLSearchParams(location.search);
  var MANUAL = Q.get('manual') === '1';
  var CHROMELESS = Q.get('chromeless') === '1';
  var DIAG = Q.get('diag') === '1';
  var TEST = Q.get('test') === '1';
  var FREEZE = Q.get('freeze') === '1';
  var HOLD = Q.get('hold') === '1';
  var NAME = WH.name || '大肥鱼';
  // 无头浏览器 + --virtual-time-budget 会把定时器瞬间快进，导致客户端超时先于真实网络返回；
  // 调试时可加 ?notmo=1 关掉请求超时（正常使用不要加）
  var NOTMO = Q.get('notmo') === '1';

  // M1 新配置块：说话长度 / 表情包 / 记忆 / DSH 工作状态
  var R = A.reply || {};
  var SK = A.stickers || {};
  var MEM = A.memory || {};
  var DSHC = A.dsh || {};
  var BAN = R.banlist || [];

  var E = window.WHALE_MOODS;
  var $ = function (s) { return document.querySelector(s); };
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  /* ——— 全局状态 ——— */
  var S = E.createState();
  var rig = null;
  var LINES = { moods: {}, system: {} };
  var PERSONA = null;
  var SYS_PROMPT = '';
  var chat = [];
  var actTimers = [];
  var lastAct = Date.now();
  var recentLines = [];
  var ttsOn = false;
  var micOn = false;
  var asleep = false;
  var busyReply = false;
  var compassTrail = [];
  var manualTimer = null;
  var mic = null;
  var voice = null;

  window.WHALE_VIEW = Object.assign(
    { charH: 0.62, charHMobile: 0.55, cx: 0.52, cxMobile: 0.5, footY: 0.955 },
    WH.view || {}
  );

  /* 取景可用网址参数实时覆盖：?ch=0.9 高度 / ?fx=0.5 水平 / ?fy=0.95 脚底 */
  (function () {
    var map = { ch: 'charH', chm: 'charHMobile', fx: 'cx', fxm: 'cxMobile', fy: 'footY' };
    Object.keys(map).forEach(function (k) {
      var v = parseFloat(Q.get(k));
      if (!isNaN(v)) window.WHALE_VIEW[map[k]] = v;
    });
  })();

  var FENCE = String.fromCharCode(96, 96, 96);

  /* ============ 台词 ============ */
  function pick(arr) {
    if (!arr || !arr.length) return '';
    var pool = arr.filter(function (x) { return recentLines.indexOf(x) < 0; });
    if (!pool.length) pool = arr;
    var v = pool[Math.floor(Math.random() * pool.length)];
    recentLines.push(v);
    if (recentLines.length > 14) recentLines.shift();
    return v;
  }
  function lineFrom(key) { return pick((LINES.moods || {})[key]); }
  function sysLine(key) { return pick((LINES.system || {})[key]); }

  /* ============ 气泡：渲染器 + 队列调度（P1-3） ============
   * 优先级：对话回复 30 > 互动反应 20 > 待机闲话 10
   * 规则：队列上限 6、最近 5 条去重、闲话受「冷却窗 / 夜间静默」限制
   */
  var bubble = null, bubbleTimer = null, typeTimer = null;
  var bubbleQ = [], bubbleActive = false, recentBubble = [];
  var lastReplyAt = 0, lastAmbientAt = 0;

  function nightQuiet() {
    if (!DSHC.nightQuiet) return false;
    var h = new Date().getHours();
    return h >= 23 || h < 6;
  }
  /* 闲话能不能说：夜间静默 + 刚说完话的冷却窗（工作态更久） */
  function ambientSpeechAllowed() {
    if (nightQuiet()) return false;
    var now = Date.now();
    var gap = 15000;                                  // 默认 15s
    if (window.WhaleDSH && window.WhaleDSH.busy && window.WhaleDSH.busy()) gap = 90000;  // 她在干活：安静 90s
    if (now - lastReplyAt < gap) return false;
    if (now - lastAmbientAt < 18000) return false;
    return true;
  }

  /* 底层渲染器：打字机 + 可选贴纸图 */
  function _renderBubble(text, opt) {
    opt = opt || {};
    if (!bubble) bubble = $('#bubble');
    if (!bubble) { if (opt.onDone) opt.onDone(); return; }
    clearTimeout(bubbleTimer); clearInterval(typeTimer);
    bubble.classList.add('on');
    bubble.textContent = '';
    bubble.classList.toggle('has-img', !!opt.img);
    var style = E.speechStyle(S);
    var speed = opt.speed || style.typing;
    var plain = String(text || '');
    var img = null;
    if (opt.img) {
      img = document.createElement('img');
      img.className = 'bubble-img';
      img.src = opt.img;
      img.alt = opt.alt || '表情';
      bubble.appendChild(img);
    }
    var span = document.createElement('span');
    span.className = 'bubble-text';
    bubble.appendChild(span);
    var i = 0;
    if (rig) rig.speaking = true;
    function finish() {
      clearInterval(typeTimer);
      if (rig) rig.speaking = false;
      lastReplyAt = Date.now();
      if (opt.persist) { if (opt.onDone) opt.onDone(); return; }
      bubbleTimer = setTimeout(function () {
        bubble.classList.remove('on');
        if (opt.onDone) opt.onDone();
      }, opt.hold || 5200);
    }
    if (!plain.length) { finish(); return; }
    typeTimer = setInterval(function () {
      i++;
      span.textContent = plain.slice(0, i);
      if (i >= plain.length) finish();
    }, speed);
  }

  /* 队列入口：所有台词都走这里（同名旧接口，调用处不用改） */
  function showBubble(text, opt) {
    opt = opt || {};
    var pri = opt.pri == null ? 20 : opt.pri;
    if (!text && !opt.img) return false;
    if (pri <= 10 && !ambientSpeechAllowed()) return false;
    if (text && recentBubble.indexOf(text) >= 0 && pri < 30) return false;
    if (text) { recentBubble.push(text); if (recentBubble.length > 5) recentBubble.shift(); }
    if (bubbleActive && pri >= 30) { bubbleQ.length = 0; bubbleActive = false; }  // 用户说话了，清掉闲话
    if (bubbleQ.length >= 6) return false;
    bubbleQ.push({ text: text, opt: opt, pri: pri });
    bubbleQ.sort(function (a, b) { return b.pri - a.pri; });
    pumpBubble();
    return true;
  }
  function pumpBubble() {
    if (bubbleActive || !bubbleQ.length) return;
    var it = bubbleQ.shift();
    bubbleActive = true;
    if (it.pri <= 10) lastAmbientAt = Date.now();
    _renderBubble(it.text, Object.assign({}, it.opt, {
      onDone: function () { bubbleActive = false; pumpBubble(); }
    }));
  }
  function bubbleClearQueue() { bubbleQ.length = 0; }

  /* ============ 情绪 → 动作（三层：base / override / props） ============
   * 旧实现是「播动作 → 等一会儿 → 回 idle」，临时表情结束后会丢掉当前情绪的姿势；
   * 新实现：base 只在情绪变时换，override 是带 TTL 的一次性动作，到期自动回 base。
   * 参考 Andersen216/dsh-whale-girl-live2d 的 base/override/props/gaze 三层状态。
   */
  function clearActTimers() { actTimers.forEach(function (t) { clearTimeout(t); }); actTimers = []; }
  function later(fn, ms) { var id = setTimeout(fn, ms); actTimers.push(id); return id; }
  function clipDur() {
    if (!rig || !rig.clip) return 1400;
    return rig.clip.total || 1400;
  }

  var MOOD_PROP = {
    happy: ['✨', 1400], excited: ['🌟', 1600], shy: ['💗', 1500],
    surprised: ['❗', 1200], sad: ['🌧', 1800], hurt: ['💧', 1700],
    annoyed: ['💢', 1400], angry: ['💢', 1600], bored: ['💤', 2000]
  };

  function applyAct(mood, opts) {
    opts = opts || {};
    if (!rig || asleep) return;
    lastAct = Date.now();
    var m = E.MOODS[mood] || E.MOODS.calm;
    var act = m.act || {};

    /* ① 常驻层：情绪姿势。情绪不变就一直保持（不再两秒弹回平静） */
    rig.setBase(act.pose || 'calm', { priority: 5 });

    /* ② 临时层：进入情绪时播一次动作，TTL 到点自己回 base */
    if (act.clip && opts.clip !== false) {
      var dur = 1600;
      var c = window.WhaleRig.CLIPS[act.clip];
      if (c) { dur = 0; c.times.forEach(function (t) { dur += t; }); }
      rig.act(act.clip, { kind: 'clip', priority: 22, ttl: dur + 200 });
    }

    /* ③ 道具层：情绪够强就在头顶冒个小 emoji */
    if (opts.prop !== false && S.intensity >= 2.2) {
      var pc = MOOD_PROP[mood];
      if (pc && pc[0]) rig.prop(pc[0], { ttl: pc[1] });
    }
  }

  function setMood(label, opt) {
    opt = opt || {};
    E.setMood(S, label, opt);
    paintMood();
    if (opt.act !== false) applyAct(label, opt);
  }

  function paintMood() {
    var m = E.MOODS[S.mood] || E.MOODS.calm;
    document.documentElement.style.setProperty('--c', m.color);
    document.body.dataset.mood = S.mood;
    var ml = $('#moodLabel');
    if (ml) ml.textContent = asleep ? '睡着了' : m.label;
    var me = $('#moodEmoji');
    if (me) me.textContent = m.emoji;
  }

  /* ============ 聊天 ============ */
  var LOG_MAX = 10;
  function pushLog(role, text) {
    var log = $('#log');
    if (!log || !text) return;
    var d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'me' : 'her');
    d.textContent = text;
    log.appendChild(d);
    while (log.children.length > LOG_MAX) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function pushChat(role, content) {
    chat.push({ role: role, content: content });
    if (chat.length > 16) chat.shift();
  }

  function replyLocal(userText, cls) {
    // 内容层：认意图、回答"用户说的那件事"（js/whale-talk.js）
    if (window.WhaleTalk) {
      var t = window.WhaleTalk.reply(userText, { S: S, name: NAME });
      if (t && t.say) return t.say;
    }
    if (cls.key === 'user_sad') return lineFrom('hurt') || sysLine('busy');
    if (cls.key === 'food') return sysLine('eat');
    if (cls.key === 'praise') return sysLine('praise');
    if (cls.key === 'greet') return sysLine('greet');
    if (cls.key === 'question') return pick((LINES.system.thinking || []).concat(LINES.moods.calm || []));
    if (cls.key === 'bored') return lineFrom('bored');
    return lineFrom(cls.mood) || sysLine('error');
  }

  function parseLooseJSON(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    if (s.indexOf(FENCE) === 0) s = s.replace(new RegExp('^' + FENCE + '(json)?'), '').replace(new RegExp(FENCE + '$'), '');
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  }

  var llmState = { ok: 0, fail: 0, lastMs: 0, lastErr: '' };

/* ============ Token 用量 / 花费（右上角那张卡） ============ */
function fmtTok(n) {
  if (n == null || isNaN(n)) return '—';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function paintUsage() {
  var U = window.WhaleUsage;
  if (!U || !$('#usage')) return;
  var st = U.snapshot(), L = st.last, s = st.session, money = U.money;
  function set(id, txt) { var n = $(id); if (n) n.textContent = txt; }
  set('#uModel', (L && L.model) || st.model || '未接模型');
  set('#uCost', L ? (L.live || !L.exact ? '≈' : '') + money(L.cost) : money(0));
  set('#uIn', L ? (L.live || !L.exact ? '≈' : '') + fmtTok(L.inTok) : '—');
  set('#uOut', L ? (L.live || !L.exact ? '≈' : '') + fmtTok(L.outTok) : '—');
  set('#uHit', L ? (L.exact ? fmtTok(L.hit) : '—') : '—');
  set('#uTot', L ? (L.live || !L.exact ? '≈' : '') + fmtTok((L.inTok || 0) + (L.outTok || 0)) : '—');
  var stEl = $('#uState');
  if (stEl) {
    var cls = 'u-state', txt;
    if (!L) txt = '还没说话';
    else if (L.local) txt = '本轮：本地台词，没花 token';
    else if (L.live) { txt = '生成中… 已出 ' + fmtTok(L.outTok) + ' token（估算）'; cls += ' live'; }
    else if (!L.exact) txt = '按字数估算（上游没回 usage）· ' + L.ms + 'ms';
    else txt = '✓ 已记账 · ' + L.ms + 'ms' + (L.hit ? ' · 命中 ' + fmtTok(L.hit) : '');
    stEl.textContent = txt;
    stEl.className = cls;
  }
  set('#uCalls', (s.calls || 0) + ' 次');
  set('#uSessTok', fmtTok((s.inTok || 0) + (s.outTok || 0)));
  set('#uSessCost', money(s.cost));
  var p = st.price || {};
  set('#uPrice', '单价 命中' + st.currency + (p.hit == null ? '?' : p.hit) + ' · 输入' + st.currency + p.input + ' · 输出' + st.currency + p.output + ' / 百万');
}
function toggleUsage(force) {
  var card = $('#usage'), btn = $('#btnUsage');
  if (!card) return;
  var on = (typeof force === 'boolean') ? force : !card.classList.contains('on');
  card.classList.toggle('on', !!on);
  if (btn) btn.classList.toggle('on', !!on);
  try { localStorage.setItem('whale.usage.on', on ? '1' : '0'); } catch (e) {}
}

  // 模型偶尔给出枚举外的情绪名（比如 empathetic）：按效价/唤醒就近归到十种之一
  function normalizeMood(obj) {
    var m = (obj && obj.mood) || {};
    var label = m.label;
    if (label && !E.MOODS[label]) {
      var v = Number(m.valence), a = Number(m.arousal);
      var best = 'calm', bd = Infinity;
      Object.keys(E.MOODS).forEach(function (k) {
        var mm = E.MOODS[k];
        var d = Math.pow((mm.valence || 0) - (isNaN(v) ? 0 : v), 2) + Math.pow((mm.arousal || 0) - (isNaN(a) ? 0.3 : a), 2);
        if (d < bd) { bd = d; best = k; }
      });
      label = best;
    }
    if (label) m.label = label;
    obj.mood = m;
    return obj;
  }

  function askLLM(text) {
    var llm = A.llm || {};
    var useProxy = llm.useProxy !== false;
    if (!llm.enabled) return Promise.resolve(null);
    if (!useProxy && !llm.apiKey) {
      llmState.fail++; llmState.lastErr = '未填 apiKey';
      return Promise.resolve(null);
    }
    // chat 里最后一条就是本次用户输入（send() 已 pushChat），不要再塞一遍
    var cls0 = E.classify(text);
    var msgs = [{ role: 'system', content: buildPrompt(cls0, text) }];
    chat.slice(-8).forEach(function (c) { msgs.push(c); });

    var url = useProxy
      ? (llm.proxyUrl || '/api/chat')
      : String(llm.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
    var headers = { 'Content-Type': 'application/json' };
    if (!useProxy) headers['Authorization'] = 'Bearer ' + llm.apiKey;

    var t0 = Date.now();
    var promptText = msgs.map(function (m) { return m.content || ''; }).join('\n');
    var modelId = llm.model || 'deepseek-flash';
    var lastRaw = '', lastUsageObj = null;
    if (window.WhaleUsage) window.WhaleUsage.begin(promptText, modelId);

    function once() {
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, llm.timeoutMs || 15000);
      return fetch(url, {
        method: 'POST',
        headers: headers,
        signal: ctl ? ctl.signal : undefined,
        body: JSON.stringify({
          model: llm.model || 'deepseek-flash',
          temperature: llm.temperature == null ? 1.0 : llm.temperature,
          messages: msgs
        })
      }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error && (j.error.message || j.error)) || ('HTTP ' + r.status));
          return j;
        });
      }).then(function (j) {
        var raw = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!raw || !String(raw).trim()) { llmState.lastErr = '空回复'; return null; }
        lastRaw = String(raw);
        lastUsageObj = (j && j.usage) || null;
        if (j && j.model) modelId = j.model;
        var obj = parseLooseJSON(raw);
        obj = obj ? normalizeMood(obj) : obj;
        if (DIAG && obj && obj.say) {
          document.body.setAttribute('data-llmraw', String(raw).slice(0, 400));
          document.body.setAttribute('data-llmobj', 'yes');
        }
        return obj && obj.say ? obj : { say: String(raw).trim(), mood: null };
      }).catch(function (e) {
        llmState.lastErr = (e && e.name === 'AbortError') ? '超时' : String((e && e.message) || e);
        return null;
      }).then(function (v) {
        clearTimeout(timer);
        return v;
      });
    }

    // 模型偶尔只回空内容（思考被关掉时的小概率），重试一次再决定要不要回落本地台词
    return once().then(function (v) {
      if (v || llmState.lastErr !== '空回复') return v;
      console.warn('[llm] 空回复，重试一次');
      return once();
    }).then(function (v) {
      var U = window.WhaleUsage;
      if (v) {
        llmState.ok++; llmState.lastErr = ''; llmState.lastMs = Date.now() - t0;
        if (U) {
          if (lastUsageObj) U.record(modelId, lastUsageObj, promptText, lastRaw, llmState.lastMs);
          else U.recordEstimate(modelId, promptText, lastRaw, llmState.lastMs);
        }
      } else {
        llmState.fail++; console.warn('[llm] 失败，回落本地台词：' + llmState.lastErr);
        if (U) U.cancel();
      }
      return v;
    });
  }

  // 流式回复里从半截 JSON 抽出已经到达的 say 文本
  function extractSay(acc) {
    var m = String(acc).match(/"say"\s*:\s*"((?:[^"\\]|\\["\\\/bfnrtu]|\\u[0-9a-fA-F]{0,4})*)/);
    if (!m) return '';
    try { return JSON.parse('"' + m[1] + '"'); }
    catch (e) { return m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'); }
  }

  function askLLMStream(text, onText) {
    var llm = A.llm || {};
    if (!llm.enabled) return Promise.resolve(null);
    var cls0 = E.classify(text);
    var msgs = [{ role: 'system', content: buildPrompt(cls0, text) }];
    chat.slice(-8).forEach(function (c) { msgs.push(c); });   // 最后一条已是本次输入

    var t0 = Date.now(), firstAt = 0, acc = '', lastSay = '', viaFallback = false;
    var promptText = msgs.map(function (m) { return m.content || ''; }).join('\n');
    var modelId = llm.model || 'deepseek-flash';
    var usageObj = null, respModel = '';
    if (window.WhaleUsage) window.WhaleUsage.begin(promptText, modelId);
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = NOTMO ? null : setTimeout(function () { if (ctl) ctl.abort(); }, llm.timeoutMs || 20000);

    return fetch(llm.proxyUrl || '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctl ? ctl.signal : undefined,
      body: JSON.stringify({
        model: llm.model || 'deepseek-flash',
        temperature: llm.temperature == null ? 1.0 : llm.temperature,
        messages: msgs,
        stream: true
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var ct = (r.headers.get('content-type') || '');
      // 服务端降级成普通 JSON 时，按非流式结果处理
      if (ct.indexOf('text/event-stream') < 0) {
        return r.json().then(function (j) {
          var raw = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (j && j.usage) usageObj = j.usage;
          if (j && j.model) respModel = j.model;
          if (!raw || !String(raw).trim()) return null;
          acc = String(raw);
          var o = parseLooseJSON(raw);
          o = o ? normalizeMood(o) : null;
          if (o && o.say) { if (onText) onText(o.say); return o; }
          if (onText) onText(String(raw).trim());
          return { say: String(raw).trim(), mood: null };
        });
      }
      var reader = r.body.getReader();
      var dec = new TextDecoder('utf-8');
      var buf = '';

      function feed(chunk) {
        buf += chunk;
        var idx, blocks = [];
        while ((idx = buf.indexOf('\n\n')) >= 0) { blocks.push(buf.slice(0, idx)); buf = buf.slice(idx + 2); }
        blocks.forEach(function (block) {
          block.split('\n').forEach(function (line) {
            if (line.indexOf('data:') !== 0) return;
            var data = line.slice(5).trim();
            if (!data || data === '[DONE]') return;
            var j;
            try { j = JSON.parse(data); } catch (e) { return; }
            if (j && j.usage) usageObj = j.usage;          // 最后一块带真实 usage
            if (j && j.model) respModel = j.model;
            var d = j && j.choices && j.choices[0] && j.choices[0].delta;
            if (d && d.content) {
              if (!firstAt) firstAt = Date.now() - t0;
              acc += d.content;
              if (window.WhaleUsage) window.WhaleUsage.tick(acc, respModel || modelId);
              var say = extractSay(acc);
              if (say && say !== lastSay) { lastSay = say; if (onText) onText(say); }
            }
          });
        });
      }
      function pump() {
        return reader.read().then(function (v) {
          if (v.done) return;
          feed(dec.decode(v.value, { stream: true }));
          return pump();
        });
      }
      return pump().then(function () {
        feed(dec.decode());
        var o = parseLooseJSON(acc);
        o = o ? normalizeMood(o) : null;
        if (o && o.say) return o;
        if (acc.trim()) return { say: acc.trim(), mood: null };
        // 流里一个正文字都没有（模型偶发沉默）：退回非流式，那边有"换问法再问一次"
        console.warn('[llm-stream] 空流，改用非流式重试');
        viaFallback = true;
        return askLLM(text);
      });
    }).then(function (v) {
      clearTimeout(timer);
      if (viaFallback) { return v; }             // 计数由 askLLM 自己记
      var U = window.WhaleUsage;
      if (v) {
        llmState.ok++; llmState.lastErr = '';
        llmState.lastMs = Date.now() - t0;
        llmState.firstMs = firstAt || llmState.lastMs;
        if (U) {
          if (usageObj) U.record(respModel || modelId, usageObj, promptText, acc, llmState.lastMs);
          else U.recordEstimate(respModel || modelId, promptText, acc, llmState.lastMs);
        }
      } else {
        llmState.fail++; llmState.lastErr = acc.trim() ? '空 say' : '空回复';
        if (U) U.cancel();
      }
      if (DIAG) document.body.setAttribute('data-llmfirst', String(llmState.firstMs || 0));
      return v;
    }).catch(function (e) {
      clearTimeout(timer);
      llmState.fail++;
      llmState.lastErr = (e && e.name === 'AbortError') ? '超时' : String((e && e.message) || e);
      console.warn('[llm-stream] 失败：' + llmState.lastErr);
      if (window.WhaleUsage) window.WhaleUsage.cancel();
      return null;
    });
  }

  /* ============ 提示词拼装（P0-1 长度 / P0-2 表情包 / P1-1 记忆） ============ */
  function replyMax(mood) {
    var by = R.byMood || {};
    var m = by[mood];
    return m == null ? (R.maxChars || 40) : m;
  }
  function sceneMax(cls, text) {
    var sc = R.byScene || {};
    var out = R.maxChars || 40;
    if (text && text.length <= 3 && sc.busy) out = Math.min(out, sc.busy);          // 用户只说一两个字：别啰嗦
    if (cls && cls.key === 'question' && sc.question) out = Math.min(out, sc.question);
    if (cls && cls.key === 'user_sad' && sc.sad) out = Math.min(out, sc.sad);
    if (nightQuiet() && sc.night) out = Math.min(out, sc.night);
    return out;
  }
  function currentLimit(cls, text) {
    return Math.min(replyMax(S.mood), sceneMax(cls, text)) || 40;
  }

  /* 硬规矩放在最后：anthropic/DSH 的实践都证明，靠后的指令更“管用” */
  function hardRules(limit) {
    var lines = ['【本轮硬规矩（最后交代，优先级最高）】'];
    lines.push('- 这一轮最多 ' + limit + ' 字，最多 ' + (R.maxSentences || 2) + ' 句。话越少越好，能一句就别两句。');
    lines.push('- 想补一句就分两条说，不要堆成一段；不写旁白、括号动作、Markdown 标题或加粗。');
    if (BAN.length) lines.push('- 禁止出现这些词：' + BAN.join('、') + '。');
    lines.push('- 只输出一个 JSON 对象，JSON 之外一个字都不要。');
    lines.push('- 想发图就在 JSON 里加 "sticker":"<表情包目录里的 id>"，不想发写 null。大多数轮次写 null，连续两轮别发同一张。');
    return lines.join('\n');
  }

  /* system = 人设（静态前缀，利于命中缓存）+ 记忆摘要 + 表情包目录 + 本轮硬规矩（动态尾） */
  function buildPrompt(cls, text) {
    var parts = [SYS_PROMPT || ''];
    var mem = window.WhaleMemory ? window.WhaleMemory.promptSection() : '';
    if (mem) parts.push(mem);
    var cat = window.WhaleStickers ? window.WhaleStickers.catalogText() : '';
    if (cat) parts.push(cat);
    parts.push(hardRules(currentLimit(cls, text)));
    return parts.join('\n\n');
  }

  /* 长度双保险②：硬截断 —— 超上限时截到最近的句末标点并补「…」 */
  function clampSay(s, limit) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (!s) return { text: '', cut: false };
    if (s.length <= limit) return { text: s, cut: false };
    var stops = ['。', '！', '？', '…', '!', '?', '；', '，', ',', ';'];
    var cut = -1;
    for (var i = Math.min(s.length - 1, limit); i >= 0; i--) {
      if (stops.indexOf(s.charAt(i)) >= 0) { cut = i; break; }
    }
    if (cut < Math.floor(limit * 0.5)) cut = limit - 1;
    var out = s.slice(0, cut + 1).replace(/[，,；;]$/, '。');
    if (cut + 1 < s.length && out.charAt(out.length - 1) !== '…') out += '…';
    return { text: out, cut: true };
  }

  function splitSentences(s) {
    var out = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      cur += s.charAt(i);
      if ('。！？!?…'.indexOf(s.charAt(i)) >= 0) { out.push(cur); cur = ''; }
    }
    if (cur.trim()) out.push(cur);
    return out;
  }
  /* 超过 2 句就拆成两条气泡（先后说，间隔 R.splitGapMs） */
  function splitForBubbles(s) {
    var maxS = R.maxSentences || 2;
    var ss = splitSentences(s);
    if (ss.length <= maxS) return [s];
    return [ss.slice(0, maxS).join(''), ss.slice(maxS).join('')];
  }

  function checkBan(say) {
    if (!R.warnBanlist) return;
    BAN.forEach(function (w) { if (w && String(say).indexOf(w) >= 0) console.warn('[人设] 命中 AI 味黑名单：' + w); });
  }

  /* ============ 表情包（P0-2） ============ */
  var lastStickerAt = 0, stickerStreak = 0, stickerResetTimer = null;
  function stickerAllowed() {
    if (!window.WhaleStickers || SK.enabled === false) return false;
    if (stickerStreak >= 1) return false;                                   // 一轮最多一张
    if (Date.now() - lastStickerAt < (SK.cooldownTurns || 2) * 9000) return false;  // 冷却，别刷屏
    return true;
  }
  function sceneTags(cls) {
    var out = [];
    if (!cls) return out;
    if (cls.key === 'praise') out.push('praise');
    if (cls.key === 'greet') out.push('greet');
    if (cls.key === 'question') out.push('question');
    if (cls.key === 'user_sad') out.push('comfort');
    if (cls.key === 'food') out.push('food');
    if (cls.key === 'bored') out.push('bored');
    if (S.mood === 'happy' || S.mood === 'excited') out.push('success');
    if (nightQuiet()) out.push('night');
    return out;
  }
  function sendSticker(st, opt) {
    opt = opt || {};
    if (!st) return;
    window.WhaleStickers.markSent(st);
    lastStickerAt = Date.now(); stickerStreak++;
    clearTimeout(stickerResetTimer);
    stickerResetTimer = setTimeout(function () { stickerStreak = 0; }, 20000);
    showStickerPop(st);
    if (!opt.quiet) showBubble(st.name, { pri: 20, hold: 2200 });
    pushLogSticker(st);
    paintPanel();
  }
  function showStickerPop(st) {
    var box = $('#stickerPop');
    if (!box) return;
    box.innerHTML = '';
    var im = new Image();
    im.src = st.url; im.alt = st.name;
    box.appendChild(im);
    box.classList.add('on');
    clearTimeout(showStickerPop._t);
    showStickerPop._t = setTimeout(function () { box.classList.remove('on'); }, SK.holdMs || 3200);
  }
  function pushLogSticker(st) {
    var log = $('#log');
    if (!log) return;
    var d = document.createElement('div');
    d.className = 'msg her sticker';
    var im = new Image();
    im.src = st.url; im.alt = st.name; im.title = st.meaning || st.name;
    d.appendChild(im);
    log.appendChild(d);
    while (log.children.length > LOG_MAX) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function send(text) {
    text = String(text || '').trim();
    if (!text || !rig) return;
    if ($('#input')) $('#input').value = '';
    var cls = E.classify(text);
    var style = E.speechStyle(S);
    // 内容层同步算一次：即使走 LLM，也用它兜底 & 提供台词
    var talk = window.WhaleTalk ? window.WhaleTalk.reply(text, { S: S, name: NAME }) : null;
    pushChat('user', text);
    pushLog('user', text);
    if (asleep) wakeUp(true);
    if (window.WhaleMemory && MEM.enabled !== false) window.WhaleMemory.learn(text);   // 立刻抽取"我叫阿伟"这类事实

    // 先改情绪状态，再生成回复（情绪驱动语速/延迟/长度）
    setMood(cls.mood, { intensity: cls.intensity, cause: cls.cause });
    busyReply = true;
    lastReplyAt = Date.now();
    bubbleClearQueue();                       // 正式回复优先，清掉待机闲话
    var started = Date.now();
    var streamed = false;
    var limit = currentLimit(cls, text);
    var shown = '';

    // 流式：token 一到就写进气泡，首字几百毫秒可见（打字机效果换成"真·逐字到达"）
    function onDelta(say) {
      if (!say) return;
      streamed = true;
      llmState.ticks = (llmState.ticks || 0) + 1;   // 收到几次增量（>2 说明是真·逐字流式）
      if (!bubble) bubble = $('#bubble');
      if (!bubble) return;
      clearTimeout(bubbleTimer); clearInterval(typeTimer);
      bubble.classList.remove('has-img');
      bubble.classList.add('on');
      // 长度双保险不动流式体验：超上限先截断再上屏
      var cl = clampSay(say, limit);
      if (cl.text.length >= shown.length) { shown = cl.text; bubble.textContent = cl.text; }
      if (rig) rig.speaking = true;
    }

    var llmOn = !!(A.llm && A.llm.enabled);
    var streaming = llmOn && A.llm.stream !== false;
    if (!llmOn && window.WhaleUsage) window.WhaleUsage.localTurn();
    var pending = streaming ? askLLMStream(text, onDelta) : askLLM(text);

    pending.then(function (res) {
      var rawSay = (res && res.say) || (talk && talk.say) || replyLocal(text, cls) || sysLine('error');
      var mm = (res && res.mood) || (talk && talk.mood ? { label: talk.mood, intensity: Math.max(1.8, cls.intensity) } : null);
      // 长度双保险②：代码侧硬截断（提示词管不住时兜底），再按句数拆气泡
      var cl = clampSay(rawSay, limit);
      var say = cl.text || rawSay;
      if (cl.cut) console.log('[长度] 截断 ' + rawSay.length + ' → ' + say.length + ' 字（上限 ' + limit + '）');
      checkBan(say);
      var parts = splitForBubbles(say);
      // 已经边到边显示了就不用再等"思考延迟"；非流式才补 style.delay
      var wait = streamed ? 0 : Math.max(0, style.delay - (Date.now() - started));
      setTimeout(function () {
        if (mm && mm.label && E.MOODS[mm.label]) {
          setMood(mm.label, {
            intensity: mm.intensity == null ? 2 : mm.intensity,
            valence: mm.valence, arousal: mm.arousal,
            cause: mm.cause || cls.cause
          });
        }
        pushChat('assistant', say);
        pushLog('her', say);

        // ---- 表情包（P0-2）：先用模型挑的（校验过 id），没有就按情绪/场景概率补一张 ----
        var st = (window.WhaleStickers && SK.enabled !== false) ? window.WhaleStickers.validate(res && res.sticker) : null;
        if (!st && window.WhaleStickers && Math.random() < (SK.autoChance || 0) && stickerAllowed()) {
          st = window.WhaleStickers.pickFor({ mood: S.mood, scene: sceneTags(cls) });
        }
        if (st) sendSticker(st, { quiet: true });

        clearInterval(typeTimer);
        if (streamed && bubble) {
          bubble.textContent = parts[0];
          if (rig) rig.speaking = false;
          if (parts[1]) {
            bubbleTimer = setTimeout(function () {
              showBubble(parts[1], { pri: 30, persist: !!HOLD });
            }, (R.splitGapMs || 700) + 900);
          } else if (!HOLD) {
            bubbleTimer = setTimeout(function () { bubble.classList.remove('on'); }, 5200);
          }
        } else {
          showBubble(parts[0], { pri: 30, persist: !!HOLD });
          if (parts[1]) setTimeout(function () {
            showBubble(parts[1], { pri: 30, persist: !!HOLD });
          }, R.splitGapMs || 700);
        }
        speak(say);
        if (talk && talk.act && rig.act) rig.act(talk.act, { priority: 26 });
        if (cls.mood === 'shy' || cls.mood === 'happy') S.affinity = Math.min(100, S.affinity + 1.2);
        if (cls.mood === 'hurt') S.affinity = Math.max(0, S.affinity - 1.5);
        if (window.WhaleMemory && MEM.enabled !== false) window.WhaleMemory.addTurn(text, say);
        busyReply = false;
        paintPanel();
      }, wait);
    });
  }

  /* ============ 语音输出 ============ */
  function pickVoice() {
    var list = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    var pref = (A.tts && A.tts.voiceName) || '';
    if (pref) { for (var i = 0; i < list.length; i++) { if (list[i].name === pref) return list[i]; } }
    var zh = list.filter(function (v) { return /zh|Chinese/i.test(v.lang + v.name); });
    var girl = zh.filter(function (v) { return /female|女|Xiaoxiao|Xiaoyi|Huihui|Yaoyao|Yunxi/i.test(v.name); });
    return girl[0] || zh[0] || null;
  }

  function speak(text) {
    var tts = A.tts || {};
    if (!text) return;
    // 自定义音色（克隆）：配置 tts.mode='http' + tts.url，指向本地/云端 TTS 服务
    if (tts.mode === 'http' && tts.url) {
      fetch(tts.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, mood: S.mood, rate: 0.9 + S.arousal * 0.25, pitch: 0.9 + S.valence * 0.15 })
      }).then(function (r) { return r.blob(); }).then(function (b) {
        var a = new Audio(URL.createObjectURL(b));
        a.onplay = function () { if (rig) rig.speaking = true; };
        a.onended = function () { if (rig) rig.speaking = false; };
        a.play().catch(function () { if (rig) rig.speaking = false; });
      }).catch(function () { if (rig) rig.speaking = false; });
      return;
    }
    if (!ttsOn || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      voice = voice || pickVoice();
      if (voice) u.voice = voice;
      u.lang = tts.lang || 'zh-CN';
      u.rate = 0.92 + S.arousal * 0.28;
      u.pitch = 0.92 + S.valence * 0.18;
      u.onstart = function () { if (rig) rig.speaking = true; };
      u.onend = function () { if (rig) rig.speaking = false; };
      u.onerror = function () { if (rig) rig.speaking = false; };
      speechSynthesis.speak(u);
    } catch (e) { if (rig) rig.speaking = false; }
  }

  /* ============ 语音输入 ============ */
  function initMic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    var rec = new SR();
    rec.lang = (A.tts && A.tts.lang) || 'zh-CN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = function (ev) {
      var t = ev.results[0][0].transcript;
      if ($('#input')) $('#input').value = t;
      send(t);
    };
    rec.onend = function () { micOn = false; syncButtons(); };
    rec.onerror = function () { micOn = false; syncButtons(); };
    return rec;
  }

  /* ============ 面板 ============ */
  function paintPanel() {
    if (!$('#panel')) return;
    var m = E.MOODS[S.mood] || E.MOODS.calm;
    $('#pMood').textContent = m.emoji + ' ' + m.label;
    $('#pCause').textContent = S.cause ? ('触发：' + S.cause) : '情绪平稳';
    $('#pInt').style.width = Math.round((S.intensity / 5) * 100) + '%';
    $('#pIntVal').textContent = S.intensity.toFixed(1);
    $('#pAff').style.width = Math.round(S.affinity) + '%';
    $('#pAffVal').textContent = Math.round(S.affinity);
    $('#pVal').textContent = (S.valence > 0 ? '+' : '') + S.valence.toFixed(2);
    $('#pAro').textContent = S.arousal.toFixed(2);
    drawCompass();
    paintTimeline();
  }

  function drawCompass() {
    var cv = $('#compass');
    if (!cv) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 148, h = 148;
    if (cv.width !== Math.round(w * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2, R = w / 2 - 12;
    ctx.strokeStyle = 'rgba(255,255,255,.13)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    if (compassTrail.length > 1) {
      ctx.beginPath();
      for (var i = 0; i < compassTrail.length; i++) {
        var t = compassTrail[i];
        var x = cx + t.v * R, y = cy - t.a * R;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(255,255,255,.2)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    var px = cx + S.valence * R, py = cy - S.arousal * R;
    var m = E.MOODS[S.mood] || E.MOODS.calm;
    ctx.beginPath();
    ctx.arc(px, py, 5 + S.intensity * 1.7, 0, Math.PI * 2);
    ctx.fillStyle = m.color;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText('愉快', cx + R - 24, cy - 6);
    ctx.fillText('不愉快', cx - R + 2, cy - 6);
    ctx.fillText('激动', cx + 4, cy - R + 10);
    ctx.fillText('平静', cx + 4, cy + R - 2);
  }

  function paintTimeline() {
    var box = $('#timeline');
    if (!box) return;
    box.innerHTML = '';
    var hist = S.history.slice(-7).reverse();
    if (!hist.length) { box.appendChild(el('div', 'tl-empty', '还没有情绪记录')); return; }
    hist.forEach(function (h) {
      var m = E.MOODS[h.mood] || E.MOODS.calm;
      var row = el('div', 'tl-row');
      var dot = el('i', 'tl-dot');
      dot.style.background = m.color;
      var d = new Date(h.at);
      var hh = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      row.appendChild(dot);
      row.appendChild(el('span', 'tl-name', m.label));
      row.appendChild(el('span', 'tl-cause', h.cause || '—'));
      row.appendChild(el('span', 'tl-t', hh));
      box.appendChild(row);
    });
  }

  /* ============ 交互 ============ */
  function momo() {
    if (asleep) wakeUp(true);
    clearActTimers();
    lastAct = Date.now();
    S.affinity = Math.min(100, S.affinity + 0.8);
    var warm = (S.mood === 'angry' || S.mood === 'hurt' || S.mood === 'annoyed');
    setMood(warm ? 'annoyed' : 'shy', { intensity: 2.0, cause: '被摸了摸头', act: false });
    applyAct(S.mood);                                            // 常驻层：换成被摸之后的表情
    rig.act('wave', { kind: 'clip', priority: 30, force: true }); // 临时层：摇手，播完自动回常驻层
    var t = sysLine('momo') || '……摸头可以，别拎尾巴。';
    showBubble(t);
    speak(t);
    paintPanel();
  }

  function feed() {
    if (asleep) wakeUp(true);
    clearActTimers();
    lastAct = Date.now();
    setMood('excited', { intensity: 3.0, cause: '吃到 token 了', act: false });
    applyAct(S.mood);
    rig.act('eat', { kind: 'clip', priority: 30, force: true });
    rig.prop('🐟', { ttl: 2800, size: 1.1 });
    S.affinity = Math.min(100, S.affinity + 2);
    var t = sysLine('eat') || '……就一口。';
    showBubble(t);
    speak(t);
    paintPanel();
  }

  function toggleSleep() {
    if (asleep) { wakeUp(false); return; }
    asleep = true;
    clearActTimers();
    // 睡是"一直保持"的临时层：ttl 给足，醒来时被 wake 顶掉
    rig.act('sleep', { kind: 'clip', priority: 30, force: true, ttl: 3600 * 1000 });
    setMood('bored', { intensity: 1.2, cause: '困了', act: false });
    paintMood();
    showBubble('我先眯一会儿……有事叫我。', { hold: 3600 });
    syncButtons();
  }

  function wakeUp(quiet) {
    if (!asleep) return;
    asleep = false;
    clearActTimers();
    setMood('calm', { intensity: 1.6, cause: '被叫醒了', act: false });
    applyAct(S.mood);
    rig.act('wake', { kind: 'clip', priority: 30, force: true });
    paintMood();
    syncButtons();
    if (!quiet) {
      var t = sysLine('wake') || '我醒着呢……刚才只是闭了一下眼睛。';
      showBubble(t);
      speak(t);
    }
  }

  function toggleVoice() {
    ttsOn = !ttsOn;
    if (!ttsOn && window.speechSynthesis) speechSynthesis.cancel();
    syncButtons();
    if (ttsOn) {
      var t = '那我说话就有声音了……你听得清吧？';
      showBubble(t);
      speak(t);
    } else {
      showBubble('好，我安静陪你。', { hold: 2400 });
    }
  }

  function togglePanel() {
    var p = $('#panel');
    if (!p) return;
    p.classList.toggle('on');
    if (p.classList.contains('on')) paintPanel();
  }

  /* ============ 表情包面板（P0-2） ============ */
  function buildStickerGrid() {
    var box = $('#stickerGrid');
    if (!box || !window.WhaleStickers) return;
    box.innerHTML = '';
    window.WhaleStickers.all().forEach(function (st) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sticker-cell';
      b.title = st.name + (st.meaning ? '｜' + st.meaning : '');
      var im = new Image();
      im.src = st.url; im.alt = st.name; im.loading = 'lazy';
      b.appendChild(im);
      b.onclick = function () { sendSticker(st); };
      box.appendChild(b);
    });
    var hint = $('#stickerHint');
    if (hint) hint.textContent = window.WhaleStickers.count() + ' 张 · 点一张让她发出来';
  }
  function toggleStickerPanel() {
    var box = $('#stickerPanel');
    if (!box) return;
    box.classList.toggle('on');
    if (box.classList.contains('on')) buildStickerGrid();
  }

  /* ============ DSH 工作状态联动（P1-2；读不到就静默，不影响聊天） ============ */
  var dshLast = null;
  var DSH_POSE = {
    shell: 'think', write: 'think', read: 'think', web: 'turn', plan: 'proud',
    error: 'grumpy', done: 'sparkle', waiting: 'surprise', think: 'think', idle: null
  };
  function onDshState(st) {
    if (!st || !st.ok || !rig) return;
    dshLast = st;
    if (window.WhaleDSH && window.WhaleDSH.killed) return;
    var intent = st.status === 'tool' ? (st.toolKind || 'shell') : st.status;
    var pose = DSH_POSE[intent];
    if (pose && rig.act) rig.act(pose, { kind: 'pose', priority: 18, ttl: DSHC.holdMs || 4000 });
    if (DSHC.speak && st.status === 'done') showBubble('这个我帮你盯完了。', { pri: 12, hold: 2600 });
    if (DIAG) document.body.setAttribute('data-dsh', intent + '/' + (st.toolName || '-') + '/' + (st.ageMs | 0));
  }
  function toggleDsh() {
    DSHC.enabled = !DSHC.enabled;
    if (window.WhaleDSH) {
      if (DSHC.enabled) { window.WhaleDSH.start(onDshState); showBubble('我开始偷看你干活了……', { pri: 20, hold: 2400 }); }
      else { window.WhaleDSH.stop(); showBubble('好，我不看了。', { pri: 20, hold: 2000 }); }
    }
    var b = $('#btnDsh');
    if (b) b.classList.toggle('on', !!DSHC.enabled);
  }

  function toggleMic() {
    mic = mic || initMic();
    if (!mic) { showBubble('这个浏览器不支持语音识别，用文字吧。', { hold: 3000 }); return; }
    if (micOn) { try { mic.stop(); } catch (e) {} micOn = false; }
    else { try { mic.start(); micOn = true; } catch (e) { micOn = false; } }
    syncButtons();
  }

  function syncButtons() {
    var b = $('#btnVoice'); if (b) b.classList.toggle('on', ttsOn);
    var m = $('#btnMic'); if (m) m.classList.toggle('on', micOn);
    var s = $('#btnSleep');
    if (s) { s.classList.toggle('on', asleep); s.textContent = asleep ? '☀️' : '🌙'; }
  }

  /* ============ 主循环 ============ */
  var lastT = 0, compassAcc = 0, frameCount = 0;
  function step(dt) {
    frameCount++;
    if (MANUAL) document.body.setAttribute('data-frames', frameCount);
    if (FREEZE && frameCount === (parseInt(Q.get('fr'), 10) || 90)) freezeCanvas();
    E.tick(S, dt);
    if (rig) { rig.update(dt); rig.draw(); }
    if (TEST) {
      var c = $('#stage'), g = c.getContext('2d');
      g.save(); g.setTransform(1,0,0,1,0,0);
      g.fillStyle = '#ff0000'; g.fillRect(40, 40, 160, 160);
      g.fillStyle = '#00ff88'; g.fillRect(c.width/2-80, c.height/2-80, 160, 160);
      g.restore();
      if (frameCount % 20 === 0) {
        try {
          var d = g.getImageData(Math.round(c.width/2), Math.round(c.height/2), 1, 1).data;
          document.body.setAttribute('data-px', d.join(','));
          d = g.getImageData(300, 900 - 300, 1, 1).data;
          document.body.setAttribute('data-px2', d.join(','));
        } catch (e) { document.body.setAttribute('data-pxerr', String(e.message)); }
      }
    }
    compassAcc += dt;
    if (compassAcc > 0.25) {
      compassAcc = 0;
      compassTrail.push({ v: S.valence, a: S.arousal });
      if (!S.history.length) S.history.push({ mood: S.mood, cause: '刚和你见面', at: Date.now() });
      if (compassTrail.length > 60) compassTrail.shift();
      if ($('#panel') && $('#panel').classList.contains('on')) paintPanel();
    }
  }
  function loop(ts) {
    var now = ts || performance.now();
    var dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0.016;
    lastT = now;
    step(dt);
    requestAnimationFrame(loop);
  }
  var frozen = false;
  function freezeCanvas() {
    if (frozen || !FREEZE) return;
    frozen = true;
    try {
      var c = $('#stage');
      var url = c.toDataURL('image/png');
      var im = document.createElement('img');
      im.src = url;
      im.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:1;pointer-events:none;';
      document.body.appendChild(im);
    } catch (e) { document.body.setAttribute('data-freezeerr', String(e.message)); }
  }

  function startManualLoop() {
    var last = performance.now();
    manualTimer = setInterval(function () {
      var now = performance.now();
      var dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      step(dt);
    }, 33);
  }

  /* ============ 待机小动作 ============ */
  // 待机：3.5~7.5s 抽一次小动作（IDLE_TABLE 加权），偶尔冒一句闲话（低优先级，会被夜间静默/队列挡掉）
  function ambient() {
    setInterval(function () {
      if (asleep || busyReply || !rig) return;
      if (document.hidden) return;
      if (Date.now() - lastAct < 3500) return;
      var idleFor = (Date.now() - lastAct) / 1000;
      if (idleFor > 240) { toggleSleep(); return; }
      lastAct = Date.now();
      rig.rollIdle();                                  // {glance/express/mutter/hungry/nopang}，自带 TTL 与回位
      if (Math.random() < 0.28) {
        var fn = window.WhaleTalk && window.WhaleTalk.idleLine;
        if (typeof fn === 'function') {
          var t = null;
          try { t = fn({ S: S, name: NAME }); } catch (e) {}
          if (t) showBubble(t, { pri: 8, hold: 2400 });   // pri<=10：走 ambientSpeechAllowed 闸门
        }
      }
    }, 3800);
  }

  /* ============ 指针：拖拽 / 摸摸 ============ */
  function initPointer() {
    var cv = $('#stage');
    var down = false, moved = 0, px = 0, py = 0;
    cv.addEventListener('pointerdown', function (e) {
      down = true; moved = 0; px = e.clientX; py = e.clientY;
      rig.pickup(px, py);
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      if (asleep) wakeUp(true);
    });
    cv.addEventListener('pointermove', function (e) {
      // 视线跟随：没按住时眼睛也往鼠标方向偏一点（伪 Live2D 的"活着"感）
      try {
        var rc = cv.getBoundingClientRect();
        if (rig && rig.setGaze) rig.setGaze(((e.clientX - rc.left) / rc.width - 0.5) * 2, ((e.clientY - rc.top) / rc.height - 0.5) * 2);
      } catch (err) {}
      if (!down) return;
      moved += Math.abs(e.clientX - px) + Math.abs(e.clientY - py);
      rig.dragTo(e.clientX, e.clientY);
      px = e.clientX; py = e.clientY;
    });
    cv.addEventListener('pointerup', function () {
      if (!down) return;
      down = false;
      rig.release();
      if (moved < 8) momo();
    });
    cv.addEventListener('pointercancel', function () {
      if (!down) return;
      down = false;
      rig.release();
    });
  }

  /* ============ 启动 ============ */
  function loadJSON(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function loadAssets() {
    var lp = WH.linesPath || 'persona/lines.json';
    var pp = WH.personaPath || 'persona/persona.json';
    var sp = WH.systemPromptPath || 'persona/system-prompt.md';
    return Promise.all([
      loadJSON(lp),
      loadJSON(pp),
      fetch(sp).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; })
    ]).then(function (res) {
      if (res[0] && res[0].moods) LINES = res[0];
      if (res[1]) PERSONA = res[1];
      var txt = res[2] || '';
      var m = txt.match(new RegExp(FENCE + '(?:text|markdown)?\\s*\\n([\\s\\S]*?)' + FENCE));
      SYS_PROMPT = (m ? m[1] : txt).trim();
      if (!SYS_PROMPT && PERSONA) SYS_PROMPT = PERSONA.system_prompt || '';
    });
  }

  function bindUI() {
    var map = {
      '#btnMomo': momo, '#btnFeed': feed, '#btnSleep': toggleSleep,
      '#btnVoice': toggleVoice, '#btnMic': toggleMic,
      '#btnPanel': togglePanel, '#btnClose': togglePanel,
      '#btnUsage': function () { toggleUsage(); },
      '#btnSticker': toggleStickerPanel,
      '#btnStickerClose': toggleStickerPanel,
      '#btnDsh': toggleDsh
    };
    Object.keys(map).forEach(function (sel) { var n = $(sel); if (n) n.onclick = map[sel]; });
    var rU = $('#uReset');
    if (rU) rU.onclick = function () { if (window.WhaleUsage) window.WhaleUsage.reset(); };
    var form = $('#composer');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); send($('#input').value); });
    if (window.speechSynthesis) {
      speechSynthesis.onvoiceschanged = function () { voice = pickVoice(); };
    }
  }

  function dumpDiag() {
    var info = rig.debugInfo ? rig.debugInfo() : {};
    var report = 'DIAG 大肥鱼 | clip=' + info.clip +
      ' | 图集=' + (info.atlas || []).join(',') +
      ' | cellH=' + Math.round((info.framing || {}).cellH || 0) +
      ' cx=' + Math.round((info.framing || {}).cx || 0) +
      ' | 台词=' + Object.keys(LINES.moods || {}).length + '类/' + Object.keys(LINES.system || {}).length + '组' +
      ' | persona=' + (PERSONA ? PERSONA.name : '无') +
      ' | prompt=' + SYS_PROMPT.length + '字' +
      ' | 贴纸=' + (window.WhaleStickers ? window.WhaleStickers.count() : 0) + '张' +
      ' | 记忆=' + (window.WhaleMemory ? window.WhaleMemory.stats().chars + '字' : '-') +
      ' | base=' + (info.base || '-') + ' ov=' + (info.override || '-') +
      ' | dsh=' + (window.WhaleDSH ? (window.WhaleDSH.get() || {}).status || '-' : 'off') +
      ' | mood=' + S.mood + ' i=' + S.intensity.toFixed(1) +
      ' | canvas=' + rig.W.toFixed(0) + 'x' + rig.H.toFixed(0) + ' ready=' + rig.ready + ' frames=' + frameCount +
      ' feet=' + Math.round(rig.framing.feet) + ' cellH=' + Math.round(rig.framing.cellH) + ' imgs=' + Object.keys(rig.images).length +
      ' | llm=' + (!(A.llm && A.llm.enabled) ? 'off'
        : (A.llm.useProxy !== false ? 'proxy' : 'direct') +
          ' ok=' + llmState.ok + ' fail=' + llmState.fail +
          ' ' + llmState.lastMs + 'ms' +
          (llmState.firstMs ? ' 首字=' + llmState.firstMs + 'ms' : '') +
          (llmState.ticks ? ' 增量=' + llmState.ticks + '次' : '') +
          (llmState.lastErr ? ' err:' + llmState.lastErr : '')) +
      (function () {
        if (!window.WhaleUsage) return '';
        var us = window.WhaleUsage.snapshot(), L = us.last;
        if (!L) return ' | tok=none';
        return ' | tok=' + (L.exact ? '' : '~') + L.inTok + '/' + L.outTok +
          ' cost=' + window.WhaleUsage.money(L.cost) +
          ' sess=' + us.session.calls + '次 ' + window.WhaleUsage.money(us.session.cost);
      })();
    document.title = report;
    var pre = $('#diag');
    if (!pre) { pre = el('pre', 'diag'); pre.id = 'diag'; document.body.appendChild(pre); }
    pre.textContent = report;
    console.log(report);
  }

  window.addEventListener('error', function (ev) {
    document.body.setAttribute('data-err', (ev.message || 'err') + ' @' + (ev.filename || '').split('/').pop() + ':' + ev.lineno);
  });

  function boot() {
    if (CHROMELESS) document.body.classList.add('bare');
    document.title = NAME;

    // Token 用量卡：先接上渲染回调，再按配置/上次开关决定显不显示
    if (window.WhaleUsage) {
      window.WhaleUsage.init(paintUsage);
      var showCost = !(A.cost && A.cost.show === false);
      var bU = $('#btnUsage');
      if (bU) bU.classList.toggle('hidden', !showCost);
      var savedOn = null;
      try { savedOn = localStorage.getItem('whale.usage.on'); } catch (e) {}
      toggleUsage(showCost && savedOn !== '0');
      paintUsage();
    }
    var who = $('#whoName');
    if (who) who.textContent = NAME;

    rig = new window.WhaleRig($('#stage'));
    loadAssets().then(function () {
      return rig.load();
    }).then(function () {
      paintMood();
      syncButtons();
      bindUI();
      initPointer();
      ambient();
      compassTrail.push({ v: S.valence, a: S.arousal });

      // 贴纸包 + 记忆 + DSH 状态读取器（任何一个失败都不影响聊天）
      if (window.WhaleStickers && SK.enabled !== false) {
        window.WhaleStickers.load().then(function () { buildStickerGrid(); }).catch(function () {});
      }
      if (window.WhaleMemory && MEM.enabled !== false) {
        setInterval(function () { try { window.WhaleMemory.flush(); } catch (e) {} }, 10000);
      }
      if (Q.get('dsh') === '1') DSHC.enabled = true;
      if (Q.get('dsh') === '0') DSHC.enabled = false;
      if (window.WhaleDSH && DSHC.enabled) {
        try { window.WhaleDSH.start(onDshState); } catch (e) {}
        var bD = $('#btnDsh'); if (bD) bD.classList.add('on');
      }

      applyAct(S.mood);
      var greet = sysLine('greet') || '嗯？你叫我？';
      showBubble(greet, { hold: 5200 });
      rig.act('wave', { kind: 'clip', priority: 12 });

      var qm = Q.get('mood');
      if (qm && E.MOODS[qm]) {
        var qi = parseFloat(Q.get('i')) || 3.0;
        setMood(qm, { intensity: qi });
        var qu = Q.get('u');
        if (qu) send(qu);
        if (Q.get('snap') === '1') { try { rig.time = 0.4; rig.draw(); } catch (e) {} }
      } else if (Q.get('u')) {
        send(Q.get('u'));
      }

      // ?say=第一句|第二句|第三句 —— 一次跑多轮，用来检查"答得对不对"
      var SAY = Q.get('say');
      if (SAY) {
        SAY.split('|').forEach(function (line, i) {
          setTimeout(function () { if (line.trim()) send(line.trim()); }, 800 + i * 1400);
        });
      }

      if (Q.get('panel') === '1') togglePanel();
      if (DIAG) { dumpDiag(); setInterval(dumpDiag, 1200); }
      if (MANUAL) { if (manualTimer) clearInterval(manualTimer); startManualLoop(); }
      else requestAnimationFrame(loop);

      window.__whale = {
        rig: rig, S: S, send: send, setMood: setMood, applyAct: applyAct,
        stickers: function () { return window.WhaleStickers; },
        memory: function () { return window.WhaleMemory; },
        promptNow: function (t) { return buildPrompt(E.classify(t || '在吗'), t || '在吗'); },
        clamp: clampSay, split: splitForBubbles, limit: currentLimit,
        dsh: function () { return dshLast; },
        lines: LINES, persona: PERSONA, prompt: function () { return SYS_PROMPT; }
      };
    }).catch(function (err) {
      console.error(err);
      document.body.classList.add('fail');
      var b = $('#bubble');
      if (b) { b.classList.add('on'); b.textContent = '加载失败：' + err.message; }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
