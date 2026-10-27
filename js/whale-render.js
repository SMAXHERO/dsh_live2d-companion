/* ============================================================
 * whale-render.js — 大肥鱼「伪 Live2D」渲染层
 * ------------------------------------------------------------
 * 素材来源：https://github.com/YunYueSama/codex-deepseek-pet
 *   （大肥鱼项目署名许可 1.0，见 CREDITS.md）
 *
 * 为什么叫「伪」：真 Live2D 需要 .moc3（只能在 Cubism Editor 里做）。
 * 这里用同一套多帧原画 + 时间轴 + 程序化呼吸/眨眼/摇晃/挤压/视线，
 * 做出接近 Live2D 的“活着”的感觉，接口与真模型一致。
 *
 * 分层（M1 / P0-3，参考 Andersen216/dsh-whale-girl-live2d 的三层状态）：
 *   base     常驻层：情绪决定的姿势，情绪不变就不变（不再“过两秒弹回平静”）
 *   override 临时层：一次性动作/表情，带 TTL，到期自动回 base
 *   props    道具层：贴在身上的 emoji 小道具（吃鱼、问号…），带 TTL
 *   gaze     视线层：跟着鼠标轻微转头（伪 Live2D 增强）
 * 单写者：同一时刻只有一个 override；低优先级抢不到时记进 conflicts（不排队不打架）
 * 看门狗：2 秒内没人碰过状态且 override 卡住 → 强制回 base
 * ============================================================ */
(function (global) {
  'use strict';

  const BASE = 'assets/whale/';

  /* ——— 工具：帧序列 ——— */
  const range = (start, count, step) => {
    const a = [];
    for (let i = 0; i < count; i++) a.push(start + i * (step || 1));
    return a;
  };
  const seg = (atlas, stages, loop) => {
    const frames = [], times = [];
    for (const st of stages) {
      const list = st[0], ms = st[1];
      const t = Array.isArray(ms) ? ms : list.map(() => ms);
      for (let i = 0; i < list.length; i++) { frames.push(list[i]); times.push(t[i] === undefined ? ms : t[i]); }
    }
    return { atlas, frames, times, loop: !!loop };
  };

  /* ——— 动作片段表（时间轴照搬原项目 motion.js，按帧号取样） ——— */
  const CLIPS = {
    idle: { atlas: 'idle', frames: [0], times: [1600], loop: true },

    wave: seg('wave', [
      [[1, 3, 5, 7], [80, 70, 65, 65]],
      [[9, 11, 13, 15, 17, 19], [70, 65, 65, 65, 65, 70]],
      [[21, 23, 25, 27, 29, 31], [65, 65, 70, 75, 80, 100]]
    ]),
    eat: seg('eat', [
      [[1, 3, 5], [90, 100, 100]],
      [[7, 9, 11, 13, 15], 85],
      [[17, 19, 21, 23, 25], [110, 100, 100, 100, 110]],
      [[27, 29, 31], [110, 100, 150]]
    ]),
    jump: seg('jump', [
      [[0, 1, 3], [65, 85, 90]],
      [[5, 7, 9, 11, 13, 15, 17, 19], [45, 45, 50, 65, 65, 50, 45, 45]],
      [[21, 23], [65, 70]],
      [[25, 27, 29, 31], [60, 65, 70, 100]]
    ]),
    dance: seg('dance', [
      [[1, 3, 5], 80],
      [range(7, 10, 2), 85],
      [[27, 29, 31], [90, 100, 140]]
    ]),
    sleep: seg('sleep', [
      [[1, 3, 5, 7], [130, 170, 170, 130]],
      [[9, 11, 13], [120, 130, 140]],
      [[17, 19], [150, 180]],
      [[21, 23], [150, 180]],
      [[25, 27, 29, 31], [180, 180, 180, 220]]
    ]),
    wake: seg('sleep', [
      [[31, 29, 27, 25, 23, 21, 19], [100, 80, 80, 80, 90, 100, 150]],
      [[17, 13, 11, 9, 7, 1], [130, 130, 100, 100, 110, 150]]
    ]),
    sneak: seg('sneak', [
      [[1, 3, 5, 7, 9], [100, 100, 90, 100, 100]],
      [[11, 15, 17, 19, 21, 23, 25, 27, 29, 13], [90, 80, 80, 80, 80, 80, 80, 80, 90, 100]],
      [[31], 150]
    ]),
    hum: seg('hum', [[[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31], 90]], true),
    think: seg('token', [[[0, 1, 2, 3], [120, 150, 180, 350]]], true),
    turnAway: seg('turn', [[range(0, 7), 70]], true),
    turnBack: seg('turn', [[range(6, 7).reverse(), 70]], true)
  };

  /* 单帧姿势（静态表情），名字 → [图集, 帧号] */
  const POSES = {
    calm: ['idle', 0],
    smile: ['actions', 5],
    grin: ['actions', 1],
    content: ['actions', 6],
    shy: ['actions', 2],
    shy2: ['expr', 1],
    think: ['expr', 4],
    proud: ['actions', 11],
    pout: ['actions', 8],
    grumpy: ['expr', 10],
    sad: ['expr', 8],
    hurt: ['expr', 11],
    surprise: ['actions', 14],
    surprised: ['actions', 14],
    excited: ['actions', 15],
    sparkle: ['expr', 9],
    bored: ['expr', 14],
    sleepy: ['expr', 15],
    eating: ['expr', 6],
    satisfied: ['expr', 7],
    hum: ['expr', 12],
    walk: ['actions', 12],
    turn: ['actions', 7]
  };

  /* 待机小动作表（权重，参考 Andersen216 的 IDLE_TABLE，5 个动作） */
  const IDLE_TABLE = [
    { w: 46, act: 'glance',  kind: 'pose', name: 'turn',    ttl: 2200 },
    { w: 28, act: 'express', kind: 'pose', name: 'sparkle', ttl: 2400 },
    { w: 22, act: 'mutter',  kind: 'pose', name: 'think',   ttl: 2600 },
    { w: 4,  act: 'hungry',  kind: 'pose', name: 'eating',  ttl: 2600 },
    { w: 2,  act: 'nopang',  kind: 'pose', name: 'pout',    ttl: 2200 }
  ];

  const loadImage = (src) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('图片加载失败: ' + src));
    img.src = src;
  });

  class WhaleRig {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.ready = false;
      this.rig = null;
      this.images = {};
      this.time = 0;
      this.speaking = false;
      this.dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.clip = null; this.clipIndex = 0; this.elapsed = 0; this.priority = -1;
      this.onEnd = null; this.fade = null; this.done = false;
      this.blinkIn = 2.2 + Math.random() * 2.6; this.blinkLeft = 0;

      /* ——— 分层状态 ——— */
      this.baseData = null;      // 常驻层（情绪/待机）
      this.baseName = 'idle';
      this.ov = null;            // 临时层 {name,data,ttl,t,priority,onEnd}
      this.props = [];           // 道具层 [{emoji,x,y,t,ttl,size}]
      this.gaze = { x: 0, y: 0, tx: 0, ty: 0 };
      this.conflicts = [];       // 单写者冲突记录
      this.lastTouch = Date.now();
      this.watchdogMs = 2000;

      this.drag = { active: false, dx: 0, dy: 0, rot: 0, rot0: 0, sx: 1, sy: 1, t: 0, mode: '', px: 0, py: 0 };
      this.framing = { cellH: 0, cx: 0, feet: 0, charTop: 0 };
      this.W = 0; this.H = 0;
      this.resize();
      global.addEventListener('resize', () => this.resize());
    }

    async load() {
      const res = await fetch(BASE + 'rig.json');
      if (!res.ok) throw new Error('rig.json 读取失败');
      this.rig = await res.json();
      const files = [...new Set(Object.values(this.rig.atlas).map(a => a.file))];
      await Promise.all(files.map(f => loadImage(BASE + f).then(img => { this.images[f] = img; })));
      this.ready = true;
      this.setBase('idle', { priority: 0 });
      return this.rig;
    }

    resize() {
      const dpr = this.dpr;
      const w = this.canvas.clientWidth || global.innerWidth;
      const h = this.canvas.clientHeight || global.innerHeight;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.W = w; this.H = h;
      const conf = (global.WHALE_VIEW || { charH: 0.62, cx: 0.5, footY: 0.94 });
      const target = (w < 620 ? (conf.charHMobile || conf.charH) : conf.charH);
      this.framing.cellH = h * target / 0.82;   // 角色约占 cell 高度的 82%
      this.framing.cx = w * (w < 620 ? (conf.cxMobile || 0.5) : conf.cx);
      this.framing.feet = h * (conf.footY || 0.94);
      this.framing.charTop = this.framing.feet - h * target;
    }

    /* ——— 名字 → 内部片段：CLIPS 里的动作，或 POSES 里的单帧 ——— */
    _resolve(name, kind) {
      if (!name) return null;
      if (name.indexOf('pose:') === 0) name = name.slice(5);
      if (CLIPS[name] && kind !== 'pose') {
        return { kind: 'clip', name, data: Object.assign({ name }, CLIPS[name]) };
      }
      if (POSES[name]) {
        const p = POSES[name];
        return {
          kind: 'pose', name,
          data: { name: 'pose:' + name, poseName: name, atlas: p[0], frames: [p[1]], times: [999999], loop: false }
        };
      }
      if (CLIPS[name]) return { kind: 'clip', name, data: Object.assign({ name }, CLIPS[name]) };
      console.warn('[rig] 未定义动作/姿势:', name);
      return null;
    }

    /* ============ 分层 API ============ */
    /* 常驻层：情绪变了才换；override 正在播时不打断，等它到期自己回 base */
    setBase(name, opts) {
      opts = opts || {};
      const r = this._resolve(name, opts.kind);
      if (!r) return false;
      this.baseData = r.data;
      this.baseName = r.name;
      this.lastTouch = Date.now();
      if (!this.ov) this._play(r.data, { force: true, priority: opts.priority == null ? 5 : opts.priority });
      return true;
    }

    /* 临时层：一次性动作/表情，带 TTL；单写者（高优先级占着时低的记冲突） */
    act(name, opts) {
      opts = opts || {};
      const r = this._resolve(name, opts.kind);
      if (!r) return false;
      const prio = opts.priority == null ? 20 : opts.priority;
      this.lastTouch = Date.now();
      if (this.ov && this.ov.priority > prio && !opts.force) {
        this.conflicts.push({ at: Date.now(), skipped: name, held: this.ov.name, prio: prio, heldPrio: this.ov.priority });
        if (this.conflicts.length > 30) this.conflicts.shift();
        return false;
      }
      const ttl = opts.ttl || (r.kind === 'clip' ? (this._durOf(r.data) + 60) : 2400);
      this.ov = { name: r.name, data: r.data, ttl: ttl, t: 0, priority: prio, onEnd: opts.onEnd || null };
      this._play(r.data, { force: true, priority: prio });
      return true;
    }

    clearOverride(quiet) {
      if (!this.ov) return;
      const cb = this.ov.onEnd;
      this.ov = null;
      if (cb && !quiet) { try { cb(this.baseName); } catch (e) {} }
      if (this.baseData) this._play(this.baseData, { force: true, priority: 3 });
    }

    /* 兼容旧调用：play('wave') / pose('shy') 都是临时层，onEnd 照旧会回调 */
    play(name, opts) { return this.act(name, Object.assign({ kind: 'clip' }, opts || {})); }
    pose(name, opts) { return this.act(name, Object.assign({ kind: 'pose' }, opts || {})); }
    idle(opts) {
      this.ov = null;
      this.setBase('idle', opts);
      return true;
    }

    /* 道具层：贴在头顶的 emoji 小道具（喂鱼🐟、问号❓、完成✅…） */
    prop(emoji, opts) {
      opts = opts || {};
      this.props.push({
        emoji: emoji, x: opts.x == null ? 0 : opts.x, y: 0,
        t: 0, ttl: opts.ttl || 2600, size: opts.size || 0.11,
        vy: opts.vy == null ? -0.02 : opts.vy, r0: (Math.random() - 0.5) * 0.3
      });
      return true;
    }

    /* 视线层：给归一化坐标 (-1..1)，角色会轻微转头看过去 */
    setGaze(nx, ny) {
      this.gaze.tx = Math.max(-1, Math.min(1, nx || 0));
      this.gaze.ty = Math.max(-1, Math.min(1, ny || 0));
    }

    /* 待机动作抽签（权重表 IDLE_TABLE），app 拿到后自己 act() */
    rollIdle() {
      let total = 0;
      IDLE_TABLE.forEach(x => { total += x.w; });
      let r = Math.random() * total;
      for (const it of IDLE_TABLE) { r -= it.w; if (r <= 0) return it; }
      return IDLE_TABLE[0];
    }

    _durOf(data) {
      let acc = 0;
      for (const t of data.times) acc += t;
      return acc;
    }

    _play(clip, opts) {
      opts = opts || {};
      const priority = opts.priority === undefined ? 10 : opts.priority;
      if (!opts.force && this.priority > priority) return false;
      if (!opts.force && this.clip && this.clip.name === clip.name && clip.loop) return false;
      if (this.clip && this.curAtlas) this.fade = { atlas: this.curAtlas, index: this.curIndex, t: 0 };
      if (opts.once) clip = Object.assign({}, clip, { loop: false });
      const cums = []; let acc = 0;
      for (const t of clip.times) { acc += t; cums.push(acc); }
      this.clip = Object.assign({}, clip, { cums, total: acc });
      this.clipIndex = 0; this.elapsed = 0; this.priority = priority; this.done = false;
      this.onEnd = opts.onEnd || null;
      return true;
    }

    update(dt) {
      if (!this.ready) return;
      dt = Math.min(dt, 0.06);
      this.time += dt;

      /* override 到期 → 回 base（这是“临时动作结束必回当前情绪表情”的实现处） */
      if (this.ov && this.ov.ttl > 0) {
        this.ov.t += dt * 1000;
        if (this.ov.t >= this.ov.ttl) {
          const cb = this.ov.onEnd;
          this.ov = null;
          if (cb) { try { cb(this.baseName); } catch (e) {} }
          if (this.baseData) this._play(this.baseData, { force: true, priority: 3 });
        }
      }

      /* 看门狗：2 秒没人碰过状态，override 还卡着 → 强制回 base（防卡死） */
      if (this.ov && Date.now() - this.lastTouch > this.watchdogMs) {
        this.conflicts.push({ at: Date.now(), skipped: 'watchdog', held: this.ov.name });
        this.ov = null;
        if (this.baseData) this._play(this.baseData, { force: true, priority: 3 });
      }

      /* 道具漂浮 + 过期 */
      for (let i = this.props.length - 1; i >= 0; i--) {
        const p = this.props[i];
        p.t += dt * 1000; p.y += p.vy * dt * 1000;
        if (p.ttl > 0 && p.t >= p.ttl) this.props.splice(i, 1);
      }

      /* 视线缓动 */
      const k = Math.min(1, dt * 6);
      this.gaze.x += (this.gaze.tx - this.gaze.x) * k;
      this.gaze.y += (this.gaze.ty - this.gaze.y) * k;

      if (!this.clip || this.clip.name === 'idle') {
        this.blinkIn -= dt;
        if (this.blinkIn <= 0) { this.blinkLeft = 0.12; this.blinkIn = 2.4 + Math.random() * 3.2; }
      }
      if (this.blinkLeft > 0) this.blinkLeft -= dt;

      if (this.clip) {
        this.elapsed += dt * 1000;
        const c = this.clip;
        if (c.loop) {
          const t = this.elapsed % c.total;
          let i = 0; while (i < c.cums.length - 1 && t >= c.cums[i]) i++;
          this.clipIndex = i;
        } else {
          let i = 0; while (i < c.cums.length - 1 && this.elapsed >= c.cums[i]) i++;
          this.clipIndex = Math.min(i, c.frames.length - 1);
          if (this.elapsed >= c.total && !this.done) {
            this.done = true;
            if (this.onEnd) { const f = this.onEnd; this.onEnd = null; f(c.name); }
          }
        }
      }

      const d = this.drag;
      if (d.mode === 'land') {
        d.t += dt;
        const p = Math.min(1, d.t / 0.55);
        const k2 = Math.sin(p * Math.PI * 2 - Math.PI / 2) * (1 - p);
        d.sy = 1 - 0.14 * k2; d.sx = 1 + 0.11 * k2;
        d.rot = d.rot0 * (1 - p); d.dx = d.dx * (1 - p * 0.9); d.dy = d.dy * (1 - p * 0.9);
        if (p >= 1) { d.mode = ''; d.sx = 1; d.sy = 1; d.rot = 0; d.dx = 0; d.dy = 0; }
      }
      if (this.fade) { this.fade.t += dt; if (this.fade.t > 0.16) this.fade = null; }
    }

    _frame() {
      if (!this.clip) return { atlas: 'idle', index: 0 };
      if (this.clip.name === 'idle' && this.blinkLeft > 0) return { atlas: 'idle', index: 1 };
      return { atlas: this.clip.atlas, index: this.clip.frames[this.clipIndex] };
    }

    draw() {
      const ctx = this.ctx, W = this.W, H = this.H;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!this.ready) return;

      const f = this.framing, t = this.time, d = this.drag;
      const idleish = !this.clip || this.clip.name === 'idle';
      const amp = idleish ? 1 : 0.3;
      const breathe = 1 + Math.sin(t * 1.55) * 0.006 * amp;
      const bob = Math.sin(t * 1.55) * H * 0.0022 * amp;
      const sway = Math.sin(t * 0.62) * 0.007 * amp;
      const talk = this.speaking ? Math.sin(t * 21) * 0.005 : 0;
      const cellH = f.cellH;
      const anchorY = 0.9297;
      const cur = this._frame();

      // 影子
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = 'rgba(4,8,20,.85)';
      ctx.beginPath();
      ctx.ellipse(f.cx + d.dx * 0.7, f.feet + d.dy + 2, cellH * 0.26, cellH * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (this.fade) {
        const p = this.fade.t / 0.16;
        this._blit(this.fade.atlas, this.fade.index, cellH, anchorY, 1 - p);
      }

      // 视线：整体轻微平移 + 旋转（伪 3D 转头），幅度很小，不破坏构图
      const gx = this.gaze.x * cellH * 0.022;
      const gy = this.gaze.y * cellH * 0.008;
      ctx.save();
      ctx.translate(f.cx + d.dx + gx, f.feet + d.dy + bob + gy);
      ctx.rotate(sway + d.rot + this.gaze.x * 0.012);
      ctx.scale(d.sx, d.sy * breathe * (1 + talk));
      this._blit(cur.atlas, cur.index, cellH, anchorY, 1);
      ctx.restore();

      // 道具层：飘在头顶的 emoji
      if (this.props.length) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const p of this.props) {
          const life = p.ttl > 0 ? Math.min(1, p.t / p.ttl) : 0;
          const alpha = life > 0.75 ? Math.max(0, 1 - (life - 0.75) / 0.25) : 1;
          ctx.globalAlpha = alpha;
          ctx.font = Math.round(cellH * p.size) + 'px "Segoe UI Emoji", "Apple Color Emoji", system-ui, sans-serif';
          ctx.fillText(p.emoji, f.cx + p.x * cellH, f.charTop + cellH * 0.06 + p.y * cellH);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }

      this.curAtlas = cur.atlas; this.curIndex = cur.index;
    }

    _blit(atlasKey, index, cellH, anchorY, alpha) {
      const a = this.rig && this.rig.atlas[atlasKey];
      if (!a) return;
      const img = this.images[a.file];
      if (!img) return;
      const cell = a.cell;
      const col = index % a.cols, row = Math.floor(index / a.cols);
      const ctx = this.ctx;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, col * cell, row * cell, cell, cell,
        -cellH / 2, -cellH * anchorY, cellH, cellH);
      ctx.globalAlpha = 1;
    }

    pickup(px, py) {
      const d = this.drag;
      d.active = true; d.mode = 'drag'; d.sx = 1.03; d.sy = 0.98; d.rot = 0; d.px = px; d.py = py;
    }
    dragTo(px, py) {
      const d = this.drag;
      if (!d.active) return;
      d.dx += px - d.px; d.dy += py - d.py;
      d.px = px; d.py = py;
      d.rot = Math.max(-0.10, Math.min(0.10, d.dx / 1300));
    }
    release() {
      const d = this.drag;
      if (!d.active) return;
      d.active = false; d.mode = 'land'; d.t = 0; d.rot0 = d.rot;
      d.sx = 1; d.sy = 1;
    }

    debugInfo() {
      return {
        ready: this.ready,
        clip: this.clip && this.clip.name,
        base: this.baseName,
        override: this.ov ? this.ov.name + '(' + Math.round(this.ov.ttl) + 'ms)' : '',
        props: this.props.length,
        conflicts: this.conflicts.length,
        gaze: [Number(this.gaze.x.toFixed(2)), Number(this.gaze.y.toFixed(2))],
        frame: this._frame(),
        framing: this.framing,
        atlas: this.rig ? Object.keys(this.rig.atlas) : []
      };
    }
  }

  WhaleRig.CLIPS = CLIPS;
  WhaleRig.POSES = POSES;
  WhaleRig.IDLE_TABLE = IDLE_TABLE;
  global.WhaleRig = WhaleRig;
})(window);
