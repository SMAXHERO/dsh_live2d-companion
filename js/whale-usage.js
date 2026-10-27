/* ============================================================
 * whale-usage.js — token 用量 / 花费统计（纯前端，不联网、不额外请求）
 *
 * 数据从哪来：DeepSeek 的流式响应最后一块带 usage（服务端请求时加了
 *   stream_options.include_usage），非流式响应本身带 usage。
 *   拿不到 usage 时退化为"按字数估算"，界面上会显示 ≈。
 *
 * 花费怎么算：单价写在 config.js 的 cost.prices，单位「元 / 百万 token」。
 *   输入分缓存命中/未命中两档（DeepSeek 命中便宜很多）。
 * 累计存 localStorage，刷新页面不丢；点面板上的「清零」可以归零。
 * ============================================================ */
(function () {
  'use strict';

  var CFG = (window.APP_CONFIG && window.APP_CONFIG.cost) || {};
  var LS = 'whale.usage.v1';
  var CUR = CFG.currency || '¥';

  // 估算校准系数：估算 = 字数模型 × 系数。每拿到一次真实 usage 就更准一点。
  var CAL = { prompt: 1, completion: 1 };
  var session = { calls: 0, inTok: 0, outTok: 0, hitTok: 0, cost: 0 };
  var last = null;            // 最近一轮：{model,in,out,hit,cost,ms,exact,live}
  var onChange = function () {};
  var lastTickAt = 0;

  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(LS) || 'null');
      if (o && o.session) session = Object.assign(session, o.session);
      if (o && o.cal) CAL = Object.assign(CAL, o.cal);
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(LS, JSON.stringify({ session: session, cal: CAL, t: Date.now() })); } catch (e) {}
  }

  /* ——— 单价表 ——— */
  function priceOf(model) {
    var p = (CFG.prices || {})[String(model || '')] || CFG.fallback || {};
    var input = num(p.input, 0), output = num(p.output, 0);
    return { input: input, output: output, hit: num(p.cacheHit, input) };
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  function costOf(model, u) {
    var p = priceOf(model);
    var hit = Number(u.prompt_cache_hit_tokens ||
      (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0) || 0;
    var pin = Number(u.prompt_tokens || 0) || 0;
    var pout = Number(u.completion_tokens || 0) || 0;
    if (hit > pin) hit = pin;
    var cost = (hit * p.hit + (pin - hit) * p.input + pout * p.output) / 1e6;
    return { hit: hit, inTok: pin, outTok: pout, cost: cost, price: p };
  }

  /* ——— 字数 → token 估算（可被真实 usage 校准） ——— */
  function cjkCount(s) {
    var n = 0, c;
    for (var i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x9fff) ||
          (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60)) n++;
    }
    return n;
  }
  function baseTokens(str) {
    str = String(str == null ? '' : str);
    if (!str) return 0;
    var n = cjkCount(str);
    return n * 0.62 + (str.length - n) * 0.30;
  }
  function estPrompt(str) { return Math.max(1, Math.round(baseTokens(str) * CAL.prompt)); }
  function estOut(str) { return Math.max(0, Math.round(baseTokens(str) * CAL.completion)); }
  function calibration(real, est) {
    if (!real || !est) return 1;
    var r = real / est;
    return Math.max(0.4, Math.min(2.5, r));
  }

  /* ——— 一轮对话的三种状态 ——— */
  function begin(promptText, model) {
    last = {
      model: model || '', live: true, exact: false, ms: 0,
      inTok: estPrompt(promptText), outTok: 0, hit: 0, cost: 0, price: priceOf(model)
    };
    lastTickAt = 0;
    onChange('begin');
  }

  // 流式时每次收到增量都调；内部节流，避免每一帧都重画
  function tick(rawText, model) {
    if (!last || !last.live) return;
    if (model) last.model = model;
    var out = estOut(rawText);
    if (out === last.outTok) return;
    last.outTok = out;
    last.cost = (last.inTok * last.price.input + out * last.price.output) / 1e6;
    var now = Date.now();
    if (now - lastTickAt < 90) return;   // 90ms 一次，足够"实时"又不抖
    lastTickAt = now;
    onChange('tick');
  }

  function record(model, usage, promptText, rawCompletion, ms) {
    if (!last) begin(promptText, model);
    var modelName = (usage && usage.model) || model || last.model;
    var c = costOf(modelName || '', usage || {});
    // 用真实值校准估算器（下次没拿到 usage 时更准）
    var bp = baseTokens(promptText), bo = baseTokens(rawCompletion);
    if (c.inTok && bp > 4) CAL.prompt = CAL.prompt * 0.6 + calibration(c.inTok, bp) * 0.4;
    if (c.outTok && bo > 2) CAL.completion = CAL.completion * 0.6 + calibration(c.outTok, bo) * 0.4;
    last = {
      model: modelName || '', live: false, exact: true, ms: ms || 0,
      inTok: c.inTok, outTok: c.outTok, hit: c.hit, cost: c.cost, price: c.price
    };
    session.calls++;
    session.inTok += c.inTok; session.outTok += c.outTok;
    session.hitTok += c.hit; session.cost += c.cost;
    save();
    onChange('record');
  }

  // 上游没回 usage（极少数服务商不认 stream_options）：按字数估一份，标记"估算"
  function recordEstimate(model, promptText, rawCompletion, ms) {
    var inTok = estPrompt(promptText), outTok = estOut(rawCompletion);
    var p = priceOf(model);
    last = {
      model: model || '', live: false, exact: false, ms: ms || 0,
      inTok: inTok, outTok: outTok, hit: 0, cost: (inTok * p.input + outTok * p.output) / 1e6, price: p
    };
    session.calls++;
    session.inTok += inTok; session.outTok += outTok; session.cost += last.cost;
    save();
    onChange('record');
  }

  // 这一轮根本没调模型（纯本地台词）：把"本轮"清零并说明
  function localTurn() {
    last = { model: '', live: false, exact: true, local: true, ms: 0, inTok: 0, outTok: 0, hit: 0, cost: 0, price: priceOf('') };
    onChange('local');
  }

  function cancel(reason) {
    last = null;
    onChange('cancel');
  }

  function reset() {
    session = { calls: 0, inTok: 0, outTok: 0, hitTok: 0, cost: 0 };
    save();
    onChange('reset');
  }

  function money(v) {
    v = Number(v) || 0;
    if (v <= 0) return CUR + '0.0000';
    if (v < 0.01) return CUR + v.toFixed(4);
    if (v < 1) return CUR + v.toFixed(3);
    return CUR + v.toFixed(2);
  }

  function snapshot() {
    return {
      last: last ? Object.assign({}, last) : null,
      session: Object.assign({}, session),
      model: (window.APP_CONFIG && window.APP_CONFIG.llm && window.APP_CONFIG.llm.model) || '',
      currency: CUR,
      price: last ? last.price : priceOf((window.APP_CONFIG && window.APP_CONFIG.llm && window.APP_CONFIG.llm.model) || '')
    };
  }

  window.WhaleUsage = {
    init: function (fn) { onChange = fn || function () {}; load(); },
    begin: begin, tick: tick, record: record, recordEstimate: recordEstimate, cancel: cancel, localTurn: localTurn,
    reset: reset, snapshot: snapshot, money: money,
    estimate: { prompt: estPrompt, out: estOut, base: baseTokens }
  };
})();
