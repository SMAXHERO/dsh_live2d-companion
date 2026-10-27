/* ============================================================
 * whale-stickers.js — 表情包（M1 / P0-2）
 * ------------------------------------------------------------
 * 素材是独立 WebP 贴纸包（assets/stickers/<pack>/manifest.json）
 * 模型在输出 JSON 里挑一张：{"say":"…","sticker":"nice-work"}
 * 这里负责：加载清单 / 生成给提示词的目录（≤120 行）/ 校验 id /
 *          按情绪+场景挑一张（模型忘了发时自动补，可关）
 * ============================================================ */
(function (global) {
  'use strict';

  var C = (global.APP_CONFIG && global.APP_CONFIG.stickers) || {};
  var ENABLED = C.enabled !== false;
  var DIR = C.dir || 'assets/stickers/';
  var PACKS = C.packs || ['default'];

  var list = [];        // 展开后的贴纸数组
  var byId = {};
  var packs = [];
  var loaded = false;
  var loadP = null;
  var recent = [];      // 最近发过的 id（避免连续重复）

  function pick() { return Array.prototype.slice.call(arguments).filter(Boolean)[Math.floor(Math.random() * Array.prototype.slice.call(arguments).filter(Boolean).length)]; }

  function norm(st, pack) {
    if (!st || !st.id) return null;
    return {
      id: String(st.id),
      name: st.name || st.id,
      file: st.file || (st.id + '.webp'),
      meaning: st.meaning || '',
      tags: st.tags || [],
      mood: st.mood || [],
      scene: st.scene || [],
      weight: st.weight == null ? 1 : st.weight,
      width: st.width || 0, height: st.height || 0,
      pack: pack,
      url: DIR + pack + '/' + (st.file || (st.id + '.webp'))
    };
  }

  function fetchPack(id) {
    return fetch(DIR + id + '/manifest.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (j) {
        if (!j) { console.warn('[stickers] 包加载失败：' + id); return 0; }
        var arr = (j.stickers || []).map(function (s) { return norm(s, id); }).filter(Boolean);
        if (j.pack) packs.push(j.pack);
        arr.forEach(function (s) { list.push(s); byId[s.id] = s; });
        return arr.length;
      });
  }

  function load() {
    if (loadP) return loadP;
    if (!ENABLED) { loadP = Promise.resolve(0); return loadP; }
    loadP = Promise.all(PACKS.map(fetchPack)).then(function (ns) {
      loaded = true;
      var n = ns.reduce(function (a, b) { return a + b; }, 0);
      console.log('[stickers] 共 ' + n + ' 张：' + list.map(function (s) { return s.id; }).join(','));
      return n;
    });
    return loadP;
  }

  /* ——— 给模型看的目录（保持短：只给 id / 名字 / 何时用） ——— */
  function catalogText() {
    if (!ENABLED || !list.length) return '';
    var lines = ['【表情包目录】你可以在 JSON 里加 "sticker":"<id>" 发一张图（大多数轮次写 null）：'];
    list.slice(0, 120).forEach(function (s) {
      var why = s.meaning || (s.tags.length ? s.tags.join('/') : '');
      if (s.meaning && s.tags.length) why += '（' + s.tags.join('/') + '）';
      lines.push('· ' + s.id + '｜' + s.name + '｜' + why.slice(0, 46));
    });
    return lines.join('\n');
  }

  function get(id) { return (id && byId[String(id)]) || null; }

  function candidates(opt) {
    opt = opt || {};
    var m = opt.mood, sc = opt.scene || [];
    var pool = list.filter(function (s) {
      if (recent.indexOf(s.id) >= 0) return false;
      if (m && s.mood.length && s.mood.indexOf(m) < 0) return false;
      return true;
    });
    if (!pool.length) pool = list.slice();
    // 场景命中的加权：命中一个场景 ×2.5，情绪命中 ×1.6
    var scored = pool.map(function (s) {
      var w = s.weight || 1;
      if (m && s.mood.indexOf(m) >= 0) w *= 1.6;
      sc.forEach(function (k) { if (s.scene.indexOf(k) >= 0) w *= 2.5; });
      return { s: s, w: w };
    });
    return scored;
  }

  function roll(weights) {
    var total = 0;
    weights.forEach(function (x) { total += x.w; });
    var r = Math.random() * total;
    for (var i = 0; i < weights.length; i++) { r -= weights[i].w; if (r <= 0) return weights[i].s; }
    return weights[weights.length - 1].s;
  }

  /* 按情绪/场景挑一张（模型没给 sticker 时的兜底） */
  function pickFor(opt) {
    if (!ENABLED || !list.length) return null;
    return roll(candidates(opt));
  }

  /* 校验模型给的 id：只认目录里的，枚举外一律当没发 */
  function validate(v) {
    if (!ENABLED || !v) return null;
    var id = typeof v === 'string' ? v : (v.id || v.sticker || '');
    return get(id);
  }

  function markSent(st) {
    if (!st) return;
    recent.push(st.id);
    while (recent.length > 8) recent.shift();
  }

  function all() { return list.slice(); }
  function count() { return list.length; }
  function ready() { return loaded; }

  global.WhaleStickers = {
    load: load, catalogText: catalogText, get: get, pickFor: pickFor,
    validate: validate, markSent: markSent, all: all, count: count, ready: ready,
    packs: function () { return packs.slice(); }
  };
})(window);
