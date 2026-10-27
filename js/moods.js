/* ============================================================
 * moods.js — 大肥鱼的情绪引擎（与渲染层解耦，可单独复用）
 * ------------------------------------------------------------
 * 10 个情绪 = 状态变量，不是权重：
 *   mood 标签 / intensity 强度 / valence 愉悦度 / arousal 唤醒度
 * 情绪 → 行为（姿势、动作、回复长度、打字速度、气泡颜色）
 * ============================================================ */
(function (global) {
  'use strict';

  /* 情绪表：label 中文名、color 主色（驱动背景/气泡）、valence/arousal 基线、
   * act 进入情绪时播什么（clip 优先，pose 兜底）、hold 停多久后回待机 */
  const MOODS = {
    calm:      { label: '平静', emoji: '🌊', color: '#4FC3F7', valence: 0.10, arousal: 0.28, act: { pose: 'calm', hold: 0 } },
    happy:     { label: '开心', emoji: '😊', color: '#FFB74D', valence: 0.72, arousal: 0.55, act: { pose: 'smile', hold: 3400 } },
    excited:   { label: '兴奋', emoji: '✨', color: '#FF7043', valence: 0.88, arousal: 0.92, act: { clip: 'dance', pose: 'excited', hold: 2200 } },
    shy:       { label: '害羞', emoji: '☺️', color: '#F48FB1', valence: 0.55, arousal: 0.40, act: { clip: 'turnAway', pose: 'shy', hold: 2600 } },
    sad:       { label: '低落', emoji: '🌧', color: '#78909C', valence: -0.55, arousal: 0.18, act: { pose: 'sad', hold: 4200 } },
    hurt:      { label: '委屈', emoji: '🥺', color: '#90A4AE', valence: -0.50, arousal: 0.30, act: { pose: 'hurt', hold: 4600 } },
    annoyed:   { label: '不爽', emoji: '😤', color: '#FFB300', valence: -0.30, arousal: 0.45, act: { pose: 'pout', hold: 3200 } },
    angry:     { label: '生气', emoji: '💢', color: '#E53935', valence: -0.80, arousal: 0.85, act: { clip: 'turnAway', pose: 'grumpy', hold: 3000 } },
    surprised: { label: '惊讶', emoji: '❗', color: '#26C6DA', valence: 0.35, arousal: 0.95, act: { clip: 'jump', pose: 'surprised', hold: 1800 } },
    bored:     { label: '无聊', emoji: '💤', color: '#B0BEC5', valence: -0.15, arousal: 0.08, act: { pose: 'bored', hold: 5200 } }
  };

  /* 本地意图识别（没有 LLM 也能有情绪）。顺序 = 优先级 */
  const RULES = [
    { key: 'hurt_me', re: /(你(真|好|太)?(笨|蠢|傻|垃圾|废物|烦)|闭嘴|滚(开|吧)?|讨厌你|不喜欢你|没用|别说了|好差|什么破)/, mood: 'hurt', i: 2.8, cause: '被用户凶了' },
    { key: 'user_sad', re: /(难过|好累|累死|烦死|崩溃|想哭|失眠|焦虑|压力大|加班|不想活|没意义|失败|好惨|emo|抑郁|被骂)/, mood: 'hurt', i: 2.3, cause: '用户心情不好', care: true },
    { key: 'praise', re: /(好棒|真棒|厉害|可爱|喜欢你|最好了|聪明|谢谢你?|夸你|爱你|萌萌)/, mood: 'shy', i: 2.4, cause: '被夸了' },
    { key: 'food', re: /(吃饭|好吃|饿了|好饿|零食|外卖|奶茶|火锅|宵夜|点个|投喂|喂你|token|口粮)/, mood: 'excited', i: 2.5, cause: '说到吃的' },
    { key: 'greet', re: /^(hi|hello|嗨|哈喽|你好|早上好|晚上好|在吗|在不在|回来了|我回来了)/i, mood: 'happy', i: 2.1, cause: '打招呼' },
    { key: 'neg', re: /(不行|不对|不好|难看|太差|又错|改一下|说错|不满意|重来)/, mood: 'annoyed', i: 2.1, cause: '被挑刺' },
    { key: 'bored', re: /^(嗯|嗯嗯|哦|哦哦|额|呃|啊这|随便|算了|没事|行吧|好吧)[。！!？?~]*$/, mood: 'bored', i: 1.7, cause: '被敷衍了' },
    { key: 'question', re: /([?？]|怎么|为什么|如何|能不能|是不是|帮我|请问|什么)/, mood: 'calm', i: 1.6, cause: '在问问题', think: true },
    { key: 'pos', re: /(好耶|太好了|可以|不错|棒|谢谢|搞定|成功|通过了)/, mood: 'happy', i: 2.2, cause: '好消息' }
  ];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function createState() {
    return {
      mood: 'calm', intensity: 1.2, valence: 0.10, arousal: 0.28,
      affinity: 50, cause: '', history: [], lastAt: Date.now(),
      sleep: false, speaking: false
    };
  }

  /* 情绪更新：新强度 = 旧强度 × inertia + 触发强度（有惯性、会衰减） */
  function setMood(S, label, opt) {
    opt = opt || {};
    if (!MOODS[label]) label = 'calm';
    const m = MOODS[label];
    const inertia = (opt.inertia === undefined ? 0.55 : opt.inertia);
    const trig = opt.intensity === undefined ? 2.0 : opt.intensity;
    S.intensity = clamp(S.intensity * inertia + trig, 0.6, 5);
    S.mood = label;
    S.valence = clamp((opt.valence === undefined ? m.valence : opt.valence), -1, 1);
    S.arousal = clamp((opt.arousal === undefined ? m.arousal : opt.arousal), 0, 1);
    S.cause = opt.cause || '';
    S.lastAt = Date.now();
    S.history.push({ at: Date.now(), mood: label, cause: S.cause, intensity: S.intensity });
    if (S.history.length > 40) S.history.shift();
    if (opt.affinity) S.affinity = clamp(S.affinity + opt.affinity, 0, 100);
    return S;
  }

  /* 情绪自然衰减：每分钟掉一点，掉到地板就回 calm */
  function tick(S, dtSec) {
    const decay = 0.055 * dtSec;          // ≈ 每分钟 3.3
    S.intensity = Math.max(0.6, S.intensity - decay * 0.35);
    if (S.mood !== 'calm') {
      const m = MOODS[S.mood];
      S.valence += (m.valence * 0.35 - S.valence) * 0.02 * dtSec;
      S.arousal += (m.arousal * 0.35 - S.arousal) * 0.02 * dtSec;
      if (S.intensity <= 0.9) setMood(S, 'calm', { intensity: 1.0, cause: '' });
    }
  }

  /* 从一句话里识别人设情绪；返回 {mood, intensity, cause, care, think} */
  function classify(text) {
    const s = String(text || '').trim();
    if (!s) return { mood: 'calm', intensity: 1.4, cause: '' };
    for (const r of RULES) {
      if (r.re.test(s)) {
        let i = r.i;
        if (/[!！]/.test(s)) i += 0.5;
        if (s.length > 40) i += 0.3;
        return { mood: r.mood, intensity: i, cause: r.cause, care: !!r.care, think: !!r.think };
      }
    }
    return { mood: 'calm', intensity: 1.5, cause: '' };
  }

  /* 情绪影响说话方式：延迟、长度、后缀 */
  function speechStyle(S) {
    const m = MOODS[S.mood];
    const delay = 260 + (1 - S.arousal) * 520 + S.intensity * 40;
    const typing = clamp(1000 / (14 + S.arousal * 30), 22, 90);
    let maxLen = S.mood === 'bored' ? 12 : (S.mood === 'angry' || S.mood === 'hurt' ? 16 : 30);
    if (S.affinity > 75) maxLen += 6;
    return { delay, typing, maxLen, color: m.color, label: m.label, emoji: m.emoji };
  }

  global.WHALE_MOODS = { MOODS, RULES, createState, setMood, tick, classify, speechStyle, clamp };
})(window);
