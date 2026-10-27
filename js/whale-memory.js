/* ============================================================
 * whale-memory.js — 四区记忆（M1 / P1-1）
 * ------------------------------------------------------------
 * 参考 wxzjss/dsh-whale-loli 的 src/memory.js（717 行）简化而来：
 *   固定记忆 fixed   ：我叫什么、在做什么项目、喜欢/讨厌什么（永久，最多 8 条）
 *   滚动摘要 rolling ：每轮一行「用户说… / 她说…」，最多 80 条，先进先出
 *   最近详细 recent  ：最近 5 轮原文（给提示词提供近处上下文）
 *   归档索引 archive ：被挤出 rolling 的旧摘要的标题链
 * 总量上限 maxChars（默认 16000），超了按 最旧摘要 → 详细区 → 固定记忆 的顺序丢。
 * 只把「摘要段」（≤ injectLimit 字）塞进 system prompt —— 原文不进。
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'whale.mem.v2';
  var C = (global.APP_CONFIG && global.APP_CONFIG.memory) || {};
  var MAX_CHARS = C.maxChars || 16000;
  var RECENT_MAX = C.recentTurns || 5;
  var ROLLING_MAX = C.rollingMax || 80;
  var INJECT_LIMIT = C.injectLimit || 1200;
  var ENABLED = C.enabled !== false;
  var EXTRACT = C.extract !== false;

  var M = load();
  var dirty = false;

  function seed() {
    return { v: 2, profile: { name: '', likes: [], dislikes: [], projects: [] },
      fixed: [], rolling: [], recent: [], archive: [], updatedAt: 0 };
  }

  function load() {
    try {
      var raw = global.localStorage && localStorage.getItem(KEY);
      if (!raw) return seed();
      var j = JSON.parse(raw);
      if (j && j.v === 2) {
        j.profile = j.profile || { name: '', likes: [], dislikes: [], projects: [] };
        j.fixed = j.fixed || []; j.rolling = j.rolling || [];
        j.recent = j.recent || []; j.archive = j.archive || [];
        return j;
      }
    } catch (e) {}
    return seed();
  }

  var saveTimer = null;
  function save() {
    if (!ENABLED) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }
  function flush() {
    try {
      M.updatedAt = Date.now();
      localStorage.setItem(KEY, JSON.stringify(M));
      dirty = false;
    } catch (e) { console.warn('[mem] 保存失败（可能是 localStorage 满了）', e); }
  }

  function chars() {
    var n = JSON.stringify(M).length;
    return n;
  }

  /* 超限裁剪：先丢最旧的滚动摘要（进归档），再丢详细区，最后才动固定记忆 */
  function prune() {
    var guard = 0;
    while (chars() > MAX_CHARS && guard++ < 500) {
      if (M.rolling.length > 8) {
        var old = M.rolling.shift();
        M.archive.push({ at: old.at, text: String(old.text || '').slice(0, 40) });
        if (M.archive.length > 60) M.archive.shift();
      } else if (M.recent.length > 2) {
        M.recent.shift();
      } else if (M.fixed.length > 4) {
        M.fixed.shift();
      } else { break; }
    }
    if (charAtLeast()) {
      // 还是超（极长单条）：把滚动摘要逐条砍半
      M.rolling = M.rolling.map(function (r) { return { at: r.at, text: String(r.text || '').slice(0, 24) }; });
    }
  }
  function charAtLeast() { return chars() > MAX_CHARS; }

  function uniqPush(arr, v, cap) {
    if (!v) return;
    v = String(v).trim();
    if (!v) return;
    if (arr.indexOf(v) >= 0) return;
    arr.push(v);
    while (arr.length > (cap || 8)) arr.shift();
  }

  /* ——— 从用户一句话里抽「值得记住」的事实 ——— */
  var RE = [
    { re: /(?:我叫|你可以叫我|叫我)([\u4e00-\u9fa5A-Za-z0-9]{1,12})/, fn: function (m) {
        M.profile.name = m[1]; uniqPush(M.fixed, '用户叫' + m[1], 8);
      } },
    { re: /(?:我在做|我在写|我在搞|我在开发|我在学)([^，。,.!！?？\s]{2,20})/, fn: function (m) {
        uniqPush(M.profile.projects, m[1], 6); uniqPush(M.fixed, '用户在做' + m[1], 8);
      } },
    { re: /我(?:最|很|超|特别)?喜欢([^，。,.!！?？\s]{1,12})/, fn: function (m) {
        uniqPush(M.profile.likes, m[1], 6); uniqPush(M.fixed, '用户喜欢' + m[1], 8);
      } },
    { re: /我(?:最|很|超|特别)?(?:讨厌|不喜欢|受不了)([^，。,.!！?？\s]{1,12})/, fn: function (m) {
        uniqPush(M.profile.dislikes, m[1], 6); uniqPush(M.fixed, '用户不喜欢' + m[1], 8);
      } },
    { re: /(?:记住|记得|别忘了)[:：,，]?\s*(.{2,40})/, fn: function (m) {
        uniqPush(M.fixed, '用户让我记住：' + m[1], 8);
      } }
  ];

  function learn(text) {
    if (!ENABLED || !EXTRACT) return [];
    var s = String(text || '').trim();
    if (!s || s.length > 200) return [];
    var hit = [];
    RE.forEach(function (r) {
      var m = r.re.exec(s);
      if (m) { try { r.fn(m); hit.push(s.slice(0, 24)); } catch (e) {} }
    });
    if (hit.length) { save(); }
    return hit;
  }

  /* ——— 每轮结束后记一条摘要 ——— */
  function addTurn(userText, herText) {
    if (!ENABLED) return;
    var u = String(userText || '').replace(/\s+/g, ' ').slice(0, 30);
    var h = String(herText || '').replace(/\s+/g, ' ').slice(0, 26);
    if (!u && !h) return;
    M.rolling.push({ at: Date.now(), text: u + (h ? ' → ' + h : '') });
    while (M.rolling.length > ROLLING_MAX) {
      var old = M.rolling.shift();
      M.archive.push({ at: old.at, text: String(old.text || '').slice(0, 40) });
      if (M.archive.length > 60) M.archive.shift();
    }
    M.recent.push({ at: Date.now(), u: u, h: h });
    while (M.recent.length > RECENT_MAX) M.recent.shift();
    prune(); save();
  }

  function fmtTime(ts) {
    try {
      var d = new Date(ts), hh = ('0' + d.getHours()).slice(-2), mm = ('0' + d.getMinutes()).slice(-2);
      return hh + ':' + mm;
    } catch (e) { return ''; }
  }

  /* ——— 给 system prompt 的摘要段（≤ injectLimit 字） ——— */
  function promptSection() {
    if (!ENABLED) return '';
    var lines = [];
    if (M.fixed.length) {
      lines.push('【你记得的事】');
      M.fixed.slice(-8).forEach(function (f) { lines.push('- ' + f); });
    }
    var roll = M.rolling.slice(-6);
    if (roll.length) {
      if (!lines.length) lines.push('【你记得的事】');
      lines.push('- 最近聊到：' + roll.map(function (r) { return r.text; }).join('；'));
    }
    if (!lines.length) return '';
    var out = lines.join('\n');
    if (out.length > INJECT_LIMIT) out = out.slice(0, INJECT_LIMIT) + '…';
    return out;
  }

  function stats() {
    return {
      fixed: M.fixed.length, rolling: M.rolling.length, recent: M.recent.length,
      archive: M.archive.length, chars: chars(), profile: M.profile, updatedAt: M.updatedAt
    };
  }

  function reset() {
    M = seed(); M.updatedAt = Date.now();
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  function dump() { return JSON.parse(JSON.stringify(M)); }
  function loadDump(obj) {
    if (!obj || obj.v !== 2) return false;
    M = obj; save(); return true;
  }

  global.WhaleMemory = {
    learn: learn, addTurn: addTurn, promptSection: promptSection,
    stats: stats, reset: reset, dump: dump, load: loadDump, flush: function () { if (dirty) flush(); }
  };
})(window);
