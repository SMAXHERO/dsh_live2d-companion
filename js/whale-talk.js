/* whale-talk.js — 本地对话引擎（不接 LLM 也能"答得上话"）
 *
 * 为什么需要它：moods.js 的 classify() 只判断"用户让我有什么情绪"，
 * 台词库里的句子也是按情绪分组的通用台词。于是不填 API key 时，
 * 回复永远只跟情绪有关、跟你问的内容无关（问"你叫什么"会得到"我、我先把头低一会儿"）。
 *
 * 这个文件补的是"内容层"：先认意图（identity/时间/算数/讲笑话/表白/吐槽代码…），
 * 再用带槽位的模板生成回应，并把对话记忆（你的称呼、上一轮意图）存进 localStorage。
 *
 * 对外：window.WhaleTalk.reply(text, ctx) → { say, mood?, act?, intent }
 *   ctx = { name:'大肥鱼', S: 情绪状态对象 }
 */
(function (global) {
  'use strict';

  var MEM_KEY = 'whale.mem.v1';
  var mem = { name: '', lastIntent: '', lastUser: '', lastTopic: '', turn: 0 };
  // 当前角色名：默认大肥鱼；换角色时传 ctx.name，身份/玩笑会自动换
  var CUR_NAME = '大肥鱼';

  function loadMem() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(MEM_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        for (var k in o) { if (Object.prototype.hasOwnProperty.call(mem, k)) mem[k] = o[k]; }
      }
    } catch (e) { /* 隐私模式/禁用存储时静默 */ }
  }
  function saveMem() {
    try { global.localStorage && global.localStorage.setItem(MEM_KEY, JSON.stringify(mem)); } catch (e) {}
  }
  loadMem();

  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(a) { return (!a || !a.length) ? '' : a[rnd(a.length)]; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  /* ---------- 关键词：从用户话里抠出"他在说什么" ---------- */
  var STOP = (' 你 我 他 她 它 的 了 是 在 有 和 就 都 也 很 太 好 吗 呢 吧 啊 呀 哦 嗯 这个 那个 什么 怎么 ' +
    '为什么 能不能 可以 一个 一下 现在 今天 明天 昨天 我们 你们 他们 这样 那样 感觉 觉得 就是 还是 但是 ' +
    '因为 所以 如果 然后 其实 真的 有点 一些 的话 请问 帮我 告诉 知道 说 想 要 会 能 把 被 给 对 从 到 ').split(/\s+/);

  function keywords(text) {
    var t = String(text || '');
    // 先按标点切开，取最长的一段（通常是话题主体）
    var parts = t.split(/[，,。.！!？?；;、\n]+/).filter(function (s) { return clean(s).length > 0; });
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i].replace(/[的了呢吧啊呀哦嗯嘛诶欸]+$/g, '');
      seg = seg.replace(/^(那|那么|所以|然后|不过|但是|而且|就是|我想说|我想问)/, '');
      var k = clean(seg);
      if (k.length >= 2 && k.length <= 16 && out.indexOf(k) < 0) out.push(k);
    }
    if (!out.length) {
      var k2 = t.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
      if (k2.length >= 2) out.push(k2.slice(0, 12));
    }
    return out;
  }
  function topicOf(text) {
    var ks = keywords(text);
    if (!ks.length) return '';
    var k = ks[0];
    // 去掉"你觉得/你觉得X"这类前缀，留下 X
    k = k.replace(/^(你觉得|你认为|你说|你看|关于|对于)/, '');
    for (var i = 0; i < STOP.length; i++) {
      if (k === STOP[i]) return '';
    }
    return k;
  }

  /* ---------- 小工具：真实能做到的事就真做 ---------- */
  function clockWords() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    var ap = h < 6 ? '凌晨' : h < 11 ? '早上' : h < 13 ? '中午' : h < 18 ? '下午' : h < 23 ? '晚上' : '半夜';
    return { hm: pad(h) + ':' + pad(m), ap: ap, h: h, m: m, d: d };
  }
  function weekday() {
    return '星期' + '日一二三四五六'.charAt(new Date().getDay());
  }
  function tryMath(text) {
    // 带括号的复杂算式先老实放弃（宁可不答，也不给错答案）
    if (/[()（）]/.test(String(text))) return null;
    var t = String(text).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); });
    t = t.replace(/乘以|乘/g, '*').replace(/除以|除/g, '/').replace(/加上|加/g, '+')
         .replace(/减去|减/g, '-').replace(/×/g, '*').replace(/÷/g, '/')
         .replace(/[?？=等于多少呢啊呀呀]/g, ' ');
    // 语法：数字 (运算符 数字)+，允许空格；只认这些字符，避免误触发
    var expr = t.match(/-?\d+(?:\.\d+)?(?:\s*[+\-*/]\s*-?\d+(?:\.\d+)?)+/);
    if (!expr) return null;
    var e = expr[0].replace(/\s+/g, '');
    if (!/^-?[\d.]+([+\-*/]-?[\d.]+)+$/.test(e)) return null;
    // 先乘除后加减：拆成项，两遍算
    var nums = e.split(/(?=[+\-*/])/);            // ['3','+5','*2']
    if (!nums.length) return null;
    // 第一遍：乘除
    var stack = [nums[0]];
    for (var i = 1; i < nums.length; i++) {
      var op = nums[i].charAt(0), n = nums[i].slice(1);
      if (op === '*' || op === '/') {
        var prev = parseFloat(stack.pop());
        var cur = parseFloat(n);
        var v = op === '*' ? prev * cur : (cur === 0 ? null : prev / cur);
        if (v === null) return null;
        stack.push(String(v));
      } else {
        stack.push(op);
        stack.push(n);
      }
    }
    // 第二遍：加减（stack 形如 ['3','+','10']）
    var acc = parseFloat(stack[0]);
    for (var j = 1; j < stack.length; j += 2) {
      var o2 = stack[j], n2 = parseFloat(stack[j + 1]);
      acc = o2 === '+' ? acc + n2 : acc - n2;
    }
    var r = Math.round(acc * 1e6) / 1e6;
    var first = parseFloat(nums[0]), last = parseFloat(nums[nums.length - 1].slice(1));
    return { a: first, b: last, op: nums.length === 2 ? nums[1].charAt(0) : 'chain', r: r, expr: e };
  }

  var JOKES = [
    '为什么鲸鱼不上班？因为它们已经在"海"选了。',
    '我昨天想吃小鱼干，结果发现袋子空了。后来想想，可能是我自己吃的。',
    '有人问我为什么这么蓝。因为我不开心的时候也不红脸，我只变蓝。',
    '你知道鲸鱼最怕什么吗？怕被叫"大肥"。所以请叫我大肥鱼，谢谢。',
    '我试着学人类减肥，坚持了三天。第四天我决定先吃掉那块蛋糕再想。'
  ];
  var SING = [
    '♪ 小鱼干～小鱼干～掉进海里就找不到～',
    '♪ 蓝色的海，蓝色的我，蓝色的饥饿～',
    '♪ 你别改代码了，先吃饭吧～（跑调）'
  ];

  /* ---------- 意图表：具体 → 泛化，顺序很重要 ---------- */
  var INTENTS = [
    /* ==== 关于她自己 ==== */
    { id: 'identity', re: /(你(到底)?是(谁|什么|啥)|你叫什么|你的名字|自我介绍|你是什么东西|介绍一下你)/,
      mood: 'calm',
      say: function () {
        if (CUR_NAME !== '大肥鱼') {
          return [ '我是' + CUR_NAME + '。', '叫' + CUR_NAME + '。记住了？', CUR_NAME + '。别的先不用知道。' ];
        }
        return [ '我是大肥鱼，一条蓝色的鲸鱼娘。',
                 '大肥鱼。海里住惯了，现在住你屏幕里。',
                 '名字叫大肥鱼——是"鱼"，不是"肥"，念错了我会记仇。' ];
      },
      extra: function () { return ['你呢，怎么称呼？', '你叫什么，我记一下。', '']; } },

    { id: 'ask_about_me', re: /(我是谁|你知道我是谁|我叫什么|记得(我|我的名字)|你还记得我吗)/,
      say: function () {
        if (mem.name) return ['你是' + mem.name + '。这个我记得。', mem.name + '。忘不了，你上次还欠我一包小鱼干。'];
        return ['你还没告诉我你叫什么呢。', '不知道。你也没说过呀——现在说也不算晚。'];
      } },

    { id: 'name_set', re: /(我叫|我的名字是|叫我)\s*([\u4e00-\u9fa5A-Za-z0-9_]{1,10})/,
      say: function (m) {
        var who = m[2];
        if (/谁|什么/.test(who)) return null;
        mem.name = who;
        return ['记住了，' + who + '。', who + '，好，我记下了。', '行，' + who + '。以后就这么叫你。'];
      } },

    { id: 'hobby', re: /(你(喜欢|爱)(什么|啥|干|做)|爱好|兴趣|平时(都)?(干|做)什么|喜欢吃什么)/,
      say: function () {
        return ['吃小鱼干。还有看你写代码——写着写着就开始抓头发，挺好玩的。',
                '收集海底的亮片，还有偷偷数你打字的次数。',
                '吃，睡，看你改同一行代码改十遍。'];
      } },

    { id: 'dislike', re: /(你(讨厌|不喜欢)(什么|啥)|最讨厌)/,
      say: function () {
        if (CUR_NAME !== '大肥鱼') return ['吵架。还有饿肚子。', '改了半天的东西被人一句"重做"打回来。'];
        return ['吵架。还有饿肚子。', '被人叫"大肥"。', '改了半天的东西被人一句"重做"打回来。'];
      } },

    { id: 'age', re: /(你(多大|几岁)|年龄|出生)/,
      say: function () { return ['鲸鱼不讲年龄。', '反正比你大，也比你小，看你信哪个。', '这个不告诉你。']; } },

    { id: 'ability', re: /(你会(什么|啥|做什么)|能做什么|有什么用|会干什么|你有什么用|你会(写|做|用|编|改|看)(代码|程序|python|js|脚本|bug)?|懂(代码|编程)吗)/,
      say: function (m, ctx, text) {
        if (/写|代码|程序|python|js|脚本|bug|编程/i.test(text || '')) {
          return ['会一点。写整段不行，挑错还行。', '能看懂，能改小地方。大工程你自己来。', '会写一点点，更多时候是帮你看看哪里不对。'];
        }
        return ['陪你说话，看你改代码，饿了提醒你吃饭——虽然最后一条通常是我自己饿了。',
                '会听你讲，会记住你讲过的话，会在你熬夜的时候念你两句。',
                '会唱歌，会算数，会假装没看见你又在凌晨改需求。'];
      } },

    { id: 'howareyou', re: /(你(最近)?(好|怎么样|还好吗|心情|开心吗|难过吗)|在干嘛|你在做什么|干嘛呢)/,
      say: function (m, ctx) {
        var label = ctx && ctx.S ? (ctx.S.mood || 'calm') : 'calm';
        var map = { calm: '就那样，泡在水里发呆。', happy: '挺好的，心情不错。', excited: '好得很，正想找点事做。',
                    shy: '……还行吧。别问这么细。', sad: '有点闷。', hurt: '有点委屈。', annoyed: '有点烦。',
                    angry: '正在生气，你小心点。', surprised: '刚被吓了一跳。', bored: '无聊，正等你说话。' };
        return [map[label] || '还行。', (map[label] || '还行。') + '你呢？'];
      } },

    /* ==== 现实信息（能真答就真答） ==== */
    { id: 'time', re: /(几点了|现在(是)?(什么|几点)|时间|什么时候了|还有多久)/,
      say: function () {
        var c = clockWords();
        var tail = c.h >= 23 || c.h < 5 ? '这个点还不睡，你是打算跟鱼比谁先秃。'
                 : c.h < 11 ? '早上。先吃点东西。' : c.h < 14 ? '中午，记得吃饭。'
                 : c.h < 18 ? '下午了，撑住。' : '晚上了，别熬太狠。';
        return ['现在 ' + c.hm + '。' + tail];
      } },

    { id: 'date', re: /(今天几号|几月几号|星期几|今天(是)?周几|今天日期)/,
      say: function () {
        var d = new Date();
        return ['今天是 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 号，' + weekday() + '。'];
      } },

    { id: 'math', re: /\d+\s*(?:[+\-*/×÷]|乘以|除以|加上|减去|[加减乘除])\s*\d+|(算|等于)(一下|多少)/,
      say: function (m, ctx, text) {
        var r = tryMath(text);
        if (!r) return null;
        if (r.op === 'chain') {
          return [r.expr + ' = ' + r.r + '。这个我还会算。',
                  '等于 ' + r.r + '。别问更难的了，我只是条鱼。'];
        }
        return ['' + r.a + ' ' + (r.op === '+' ? '+' : r.op === '-' ? '−' : r.op === '*' ? '×' : '÷') + ' ' + r.b + ' = ' + r.r + '。这个我还会算。',
                '等于 ' + r.r + '。别问更难的了，我只是条鱼。'];
      } },

    { id: 'weather', re: /(天气|下雨|下雪|气温|几度|冷不冷|热不热)/,
      say: function () { return ['我这边只有水温和洋流，看不见你窗外的天。外面怎么样？',
                                 '不知道。不过你要是冷，就把外套穿上——别硬撑。']; } },

    { id: 'joke', re: /(讲个笑话|笑话|逗我|搞笑|说个段子|无聊死)/,
      say: function () {
        var pool = CUR_NAME === '大肥鱼' ? JOKES : JOKES.filter(function (j) { return j.indexOf('大肥鱼') < 0; });
        return [pick(pool)];
      } },

    { id: 'sing', re: /(唱歌|唱(个|一首|首|段|句|一下|点)|哼(个|一首|首|段|一?句|一下)?|来(一首|一个|段)|哼歌)/,
      mood: 'excited', act: 'hum',
      say: function () { return [pick(SING), '唱完了。不许笑。']; } },

    /* ==== 关系与情绪 ==== */
    { id: 'love', re: /(我喜欢你|我爱你|爱你|做我(女朋友|老婆)|当我(女朋友|老婆)|你(会|真的|到底|有)?(喜欢|爱)我(吗|么|不|嘛)?)/,
      mood: 'shy',
      say: function () { return ['……你、你突然说这个干什么。', '别、别乱说。我又不是那种随便的鱼。',
                                 '（耳朵红了）……你先把手里的活干完再说。']; } },

    { id: 'praise', re: /(好棒|真棒|厉害|可爱|最好了|聪明|爱你|萌萌|漂亮|好看|喜欢(你|大肥鱼))/,
      mood: 'shy',
      say: function () { return ['……你、你别突然这样。', '哼，这还用你说。', '真的？……那你多说两句。']; } },

    { id: 'compliment_me', re: /(夸我|我(帅|好看|厉害|棒|优秀)吗|我是不是很(好|厉害|棒)|鼓励我)/,
      mood: 'happy',
      say: function () { return ['嗯，你比我见过的多数人类都靠谱。', '你挺好的。真的，不是安慰。',
                                 '你至少还在改，没跑。这就够厉害了。']; } },

    { id: 'thanks', re: /(谢谢|谢了|多谢|感谢|thx|thanks)/i,
      mood: 'happy',
      say: function () { return ['不客气。', '嗯。别客气，我记着你的好。', '谢什么，反正我也没别的事做。']; } },

    { id: 'sorry', re: /(对不起|抱歉|我错了|不好意思|原谅我)/,
      mood: 'calm',
      say: function () { return ['……算了。下次别这样。', '知道错就行。我可没那么小气——只有一点点。',
                                 '哼。看你态度还行，这次算了。']; } },

    { id: 'comfort_me', re: /(安慰我|抱抱|摸摸我|难受|难过|不开心|心情不好|想哭|好累|累死|烦死|好烦|崩溃|焦虑|压力大|失眠|加班到|被骂|委屈|伤心|emo|撑不住)/,
      mood: 'hurt',
      say: function () {
        return ['先别急着给自己下结论。你说，我听着。',
                '累就到这儿吧。剩下的明天再弄，天塌不下来。',
                '……过来一点。不用说话也行，我陪你待一会儿。',
                '你已经做得够多了。真的。'];
      } },

    { id: 'scold', re: /(你(真|好|太)?(笨|蠢|傻|垃圾|废物|烦)|闭嘴|滚|讨厌你|不喜欢你|没用|别说了|好差|什么破)/,
      mood: 'hurt',
      say: function () { return ['……我又不是故意的。', '行，我不说了。', '（转过身去）你凶什么凶。']; } },

    { id: 'bye', re: /(再见|拜拜|晚安|我走了|下次聊|先这样|下线|睡了)/,
      mood: 'sad',
      say: function () { return ['……好。晚安。', '走吧。别熬太晚。', '嗯，去吧。我在这儿。']; } },

    { id: 'greet', re: /^(hi|hello|嗨|哈喽|你好|早上好|晚上好|在吗|在不在|回来了|我回来了|早)/i,
      mood: 'happy',
      say: function () {
        var h = new Date().getHours();
        return [h < 11 ? '早。今天也一起吧。' : h < 18 ? '来了。' : '晚上好。今天想干点什么？',
                '嗯，我在。', '在的。有事说事，没事也可以待着。'];
      } },

    /* ==== 话题类 ==== */
    { id: 'food', re: /(吃(饭|什么|了吗)|好吃|饿了|好饿|零食|外卖|奶茶|火锅|宵夜|投喂|喂你|小鱼干|夜宵)/,
      mood: 'excited',
      say: function () { return ['说到吃的我就精神了。你要请我吃小鱼干吗？',
                                 '饿了就去吃，别撑着。……顺便带一份给我。',
                                 '我今天想吃炸的。别问为什么，鱼也想过得开心点。']; } },

    /* ==== 泛化：至少接住用户说的话 ==== */
    { id: 'opinion', re: /(你怎么看|你觉得呢|你的看法|^(.{2,14}?)(好不好|怎么样|行不行|可以吗|值得吗|靠不靠谱|对不对))/,
      say: function (m, ctx, text) {
        var raw = m[1] || m[2] || '';
        var kw;
        if (/^(你怎么看|你觉得呢|你的看法)$/.test(raw)) {
          // "这个需求你怎么看" → 话题是"这个需求"
          kw = clean(text || '')
            .replace(/[\s]*(你|您)(觉得|认为|怎么看|怎么想|看)(呢|怎么样|如何)?[?？。\s]*$/, '')
            .replace(/^.*?[，,]/, '');
        } else {
          kw = clean(raw).replace(/^(你觉得|你认为|你说|那|我想问)/, '')
            .replace(/(好不好|怎么样|行不行|可以吗|值得吗|靠不靠谱|对不对)$/, '');
        }
        if (!kw) return ['你心里其实有答案吧。', '先小步试一下。'];
        return ['「' + kw + '」啊……我觉得先小步试一下，别一口气全押上。',
                '「' + kw + '」这事，你自己心里其实有答案吧。',
                '「' + kw + '」——我没见过实物，但听起来不坏。'];
      } },

    { id: 'code', re: /(代码|报错|bug|debug|编译|写(个|段)?(程序|脚本)|部署|上线|接口|重构|测试|加班|改了(半天|一天)|跑不起来)/i,
      mood: 'annoyed',
      say: function (m, ctx, text) {
        var kw = topicOf(text);
        var base = ['又是它？上次不是刚修过。', '先看报错最后一行，别从头读。',
                    '改之前先跑一遍，别凭感觉。', '把那段注释掉试试，二分法最省时间。'];
        if (kw && kw.length <= 10) base.push('「' + kw + '」这块……你上次也卡在这儿。');
        return base;
      } },

    { id: 'why', re: /(为什么|为啥|怎么会|凭什么)/,
      say: function (m, ctx, text) {
        var kw = topicOf(text.replace(/为什么|为啥|怎么会|凭什么/g, ''));
        // 代码类的问题我能给点方向，其它一律老实说不知道
        if (/代码|报错|bug|程序|接口|需求|编译|部署|崩|卡|没反应/i.test(text)) {
          return [kw ? '「' + kw + '」这种，先看日志最后几行，再看是不是最近改过。' : '先看报错最后一行，别从头读。',
                  '多半是状态没对上。你把输入打出来看一眼就知道了。'];
        }
        return [kw ? '「' + kw + '」……为什么啊。这个我真答不上来，我只是条鱼。'
                   : '不知道。这个超出我的知识范围了。',
                '我猜不出来。你要不要查一下，查到讲给我听？'];
      } },

    { id: 'self_doubt', re: /(我(是不是)?(很|太|有点|真的)?(笨|蠢|傻|差|不行|没用|废物|失败)|我(是不是)?做错了|我不行)/,
      mood: 'hurt',
      say: function () {
        return ['不许这么说自己。', '不是。你只是还没弄明白，这两件事不一样。',
                '你要是笨，就不会问这个问题了。', '……我不同意。你只是累了。'];
      } },

    { id: 'yesno', re: /(是不是|对不对|能不能|可不可以|要不要|会不会|有没有)/,
      say: function (m, ctx, text) {
        var kw = topicOf(text.replace(/是不是|对不对|能不能|可不可以|要不要|会不会|有没有/g, ''));
        return [kw ? '「' + kw + '」——我倾向于是的，但你先自己试一下。' : '我觉得可以。',
                kw ? '这个不好说。' + kw + '得看你怎么用。' : '嗯，我觉得行。'];
      } },

    { id: 'idle_activity', re: /(好无聊|无聊死|没事(干|做)|干点什么|做点什么|陪我|找点事)/,
      mood: 'bored',
      say: function () { return ['那你跟我说说今天都干了什么，我负责听。', '要不要我哼一段？不好听但不要钱。',
                                 '无聊就早点睡。或者再改一行代码——反正也会无聊。']; } },

    { id: 'bored', re: /^(嗯|嗯嗯|哦|哦哦|额|呃|啊这|随便|算了|没事|行吧|好吧)[。！!？?~…]*$/,
      say: function () { return ['……你这声"嗯"我听出来很多意思。', '敷衍我。', '行吧。那我自己找事做。']; } },

    { id: 'gender', re: /(你是(男|女)(的|生|孩)?|你(是)?男孩|你(是)?女孩|性别)/,
      say: function () { return ['鱼不分这个。你要当我是女的也行。', '女孩子的鱼。满意了？']; } },

    { id: 'robot_question', re: /(你是(不是)?(机器人|AI|程序|真人)|你有没有(感情|意识)|你是活的吗)/,
      say: function () { return ['我是住在你屏幕里的一条鱼。信不信随你。', '算程序吧。但我现在确实不太高兴，这算不算感情？']; } },

    { id: 'thanks_more', re: /(然后呢|接着呢|还有呢|继续说)/,
      say: function () { return ['没有了。我脑子里就这些。', '你还想听什么，我问你。']; } }
  ];

  /* 通用"怎么做"：给方法，不装懂 */
  INTENTS.push({
    id: 'howto',
    re: /(怎么(做|实现|写|弄|开始|学)|如何(做|实现|写|学)|步骤|从哪(里)?开始)/,
    say: function (m, ctx, text) {
      var kw = topicOf(String(text || '').replace(/怎么|如何|步骤|从哪|开始|实现|做|写|弄|学/g, ''));
      return [ kw ? '「' + kw + '」的话，先做一个能跑的最小版本，再往里加。' : '先做个最小的能跑的，别一上来就想着完整版。',
               '拆成三步：先跑通、再改对、最后改好看。多数人死在第一步就想第二步。' ];
    }
  });

  function matchIntent(text) {
    var s = clean(text);
    for (var i = 0; i < INTENTS.length; i++) {
      var it = INTENTS[i];
      var m = s.match(it.re);
      if (m) {
        var say = it.say ? it.say(m, null, s) : null;
        if (say && (typeof say === 'string' ? say : say.length)) {
          return { it: it, m: m, say: [].concat(say) };
        }
      }
    }
    return null;
  }

  function fallback(text) {
    var kw = topicOf(text);
    var isQ = /[?？]|什么|怎么|如何|谁|哪个|多少|吗$/.test(String(text).trim());
    if (kw && isQ) {
      return {
        say: [ '「' + kw + '」这个我不太懂。你换个说法？',
               '「' + kw + '」……我答不上来。你先告诉我，我记着。',
               '不知道。这个超出我范围了。' ],
        intent: 'fallback_question'
      };
    }
    if (kw) {
      return {
        say: [ '「' + kw + '」……嗯，我在听。然后呢？',
               '你说「' + kw + '」，我记下了，还有吗？',
               '「' + kw + '」啊。' ],
        intent: 'fallback_topic'
      };
    }
    return { say: ['嗯，我听着。', '继续说。', '然后呢？'], intent: 'fallback' };
  }

  function reply(text, ctx) {
    if (ctx && ctx.name) CUR_NAME = ctx.name;
    var raw = String(text == null ? '' : text);
    // "喜欢<角色名>" 这类夸奖，归一成 praise 能识别的说法
    if (CUR_NAME !== '大肥鱼' && raw.indexOf(CUR_NAME) >= 0) raw = raw.replace(new RegExp(CUR_NAME, 'g'), '你');
    var s = clean(raw);
    if (!s) return { say: '你不说话，我就当你在发呆。', intent: 'empty' };

    // 上下文接话：上一轮在讲笑话，用户回"不好笑"，继续逗
    if (/^(不好笑|没意思|无聊|切|呵)$/.test(s) && mem.lastIntent === 'joke') {
      return { say: '……那再来一个。' + pick(JOKES), intent: 'joke' };
    }

    var hit = matchIntent(s);
    var out;
    if (hit) {
      // 带槽位的模板需要 ctx 再算一次（比如 howareyou 要看当前情绪）
      var arr = hit.it.say ? [].concat(hit.it.say(hit.m, ctx, s)) : [];
      out = { say: arr, intent: hit.it.id, mood: hit.it.mood, act: hit.it.act };
    } else {
      out = fallback(s);
    }
    if (!out.say || !out.say.length) out = fallback(s);

    var say = pick(out.say);
    // 只在"本来就该有两拍"的意图后面加一句跟随，别在算数/报时后面乱接
    var TWO_BEAT = { opinion: 1, fallback_topic: 1, fallback_question: 1, code: 1, joke: 1, why: 1, howareyou: 1 };
    if (TWO_BEAT[out.intent] && Math.random() < 0.4) {
      var tails = ['你说呢？', '总之你自己拿主意。', '我就在这儿。', '……算了，当我没说。'];
      say = say + ' ' + pick(tails);
    }

    mem.turn++;
    mem.lastUser = s;
    mem.lastIntent = out.intent;
    mem.lastTopic = topicOf(s);
    saveMem();

    return { say: say, mood: out.mood, act: out.act, intent: out.intent };
  }

  global.WhaleTalk = {
    reply: reply,
    mem: mem,
    reset: function () { mem.name = ''; mem.lastIntent = ''; mem.lastUser = ''; mem.lastTopic = ''; mem.turn = 0; saveMem(); }
  };
})(typeof window !== 'undefined' ? window : this);
