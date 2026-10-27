/* ============================================================
 * 大肥鱼 · 配置文件（改这里就能改人设/声音/长度/表情包）
 * ============================================================ */
window.APP_CONFIG = {

  /* ——— LLM：真模型对话。key 放在 config.local.json（不进网页、不改这里） ———
   * enabled: 开着就会先问模型，失败/超时会自动回落本地台词
   * useProxy: true = 走 server.js 的 /api/chat（key 只在服务端，推荐）
   *            false = 浏览器直连 baseUrl（需要 key 也填在这里 + 上游允许跨域）
   * 想换模型：改 config.local.json 的 model（deepseek-flash / deepseek-v4-pro）
   */
  llm: {
    enabled: true,
    useProxy: true,
    proxyUrl: "/api/chat",
    baseUrl: "https://api.deepseek.com/v1",   // useProxy=false 时才用
    apiKey: "",                               // useProxy=false 时才用
    model: "deepseek-flash",
    temperature: 1.05,
    stream: true,                             // 流式：边生成边显示，首字约 0.3~1s
    timeoutMs: 20000
  },

  /* ——— 语音播报：先用系统 TTS 占位（无需 GPU）；M2 换自己的音色 ———
   * mode: "system" = 浏览器 speechSynthesis（免费、零依赖）
   *       "http"   = 转发到自定义 TTS 服务（自己的音色/克隆音色都走这条）
   */
  tts: {
    enabled: true,
    lang: "zh-CN",
    voiceName: "",         // 留空=自动挑一个中文女声
    mode: "system",
    url: ""                // mode="http" 时填，例如 http://127.0.0.1:9880/tts
  },

  /* ——— 说话长度：提示词给软目标 + 代码侧硬截断（双保险） ———
   * maxChars: 硬上限，超了就截到最近的句末标点并补「…」
   * softChars: 软目标，会写进提示词
   * maxSentences: 一次最多几句；超了拆成两条气泡先后说
   * byMood / byScene: 按情绪 / 场景再收紧（数字都是「字」数）
   */
  reply: {
    maxChars: 40,
    softChars: 24,
    maxSentences: 2,
    splitGapMs: 700,          // 拆成两条气泡时的间隔
    byMood: { excited: 60, happy: 44, calm: 36, bored: 20, sad: 26, hurt: 26, angry: 30, annoyed: 30, shy: 30, surprised: 34 },
    byScene: { busy: 16, night: 26, sad: 30, question: 48 },
    banlist: ["首先", "其次", "综上所述", "希望这个回答对你有帮助", "作为 AI", "作为AI", "这是个好问题", "保证", "绝对有效"],
    warnBanlist: true         // 命中黑名单时只在 console 警告，不改内容
  },

  /* ——— 表情包（M1 新增）：模型可以挑一张真的图发出来 ———
   * dir: 素材根目录；packs: 要加载的包（每个包 dir/<pack>/manifest.json）
   * autoChance: 模型没给 sticker 时，按情绪自动补一张的概率（0 关掉）
   * cooldownTurns: 连续几轮内不要重复发（避免刷屏）
   * maxPerTurn: 每轮最多几张
   */
  stickers: {
    enabled: true,
    dir: "assets/stickers/",
    packs: ["default"],
    autoChance: 0.34,
    cooldownTurns: 2,
    maxPerTurn: 1,
    holdMs: 3200              // 贴纸在气泡旁停留多久
  },

  /* ——— 记忆（M1 新增）：四区记忆，只把「摘要段」塞进提示词 ———
   * enabled: 关掉就完全不记
   * maxChars: 记忆总量上限，超了按 最旧摘要→详细区→固定记忆 的顺序丢
   * extract: 是否从用户话里抽「我叫/我在做/我喜欢/记住」
   * injectLimit: 每轮最多往提示词里塞多少字的记忆
   */
  memory: {
    enabled: true,
    maxChars: 16000,
    recentTurns: 5,
    rollingMax: 80,
    injectLimit: 1200,
    extract: true
  },

  /* ——— DSH 工作状态联动（M1 新增，需 P1 服务端点） ———
   * enabled: true 时启动就开轮询（也可以在页面右上角按钮随时开关）
   * 读取 server.js 的 /api/dsh/state（它读 ~/.dsh/sessions 的会话文件）
   * speak: 是否允许对工作状态发表情/台词（默认只动不吭声，免得吵）
   */
  dsh: {
    enabled: false,
    url: "/api/dsh/state",
    pollMs: 700,
    speak: false,
    debounceMs: 300,
    holdMs: 4000,
    nightQuiet: true          // 23:00–5:59 不说话
  },

  /* ——— 大肥鱼：伪 Live2D 形象 + 独立人设包 ——— */
  whale: {
    name: "大肥鱼",
    linesPath: "persona/lines.json",
    personaPath: "persona/persona.json",
    systemPromptPath: "persona/system-prompt.md",
    /* 取景：角色占屏高比例、水平位置、脚底位置（0~1） */
    view: { charH: 0.76, charHMobile: 0.64, cx: 0.5, cxMobile: 0.5, footY: 0.94 }
  },

  /* ——— Token 用量 / 花费（右上角那张卡） ———
   * show: false 可以整张卡不显示
   * prices: 单价，单位「元 / 百万 token」，三个数对上你自己的账单即可
   *   input = 输入（未命中缓存）、cacheHit = 输入（命中前缀缓存，DeepSeek 便宜很多）、output = 输出
   * 拿不到 usage 时界面显示 ≈（估算），拿到就是真实值
   */
  cost: {
    show: true,
    currency: "¥",
    prices: {
      "deepseek-flash": { input: 2, output: 3, cacheHit: 0.2 },
      "deepseek-v4-pro": { input: 4, output: 16, cacheHit: 0.4 }
    },
    fallback: { input: 2, output: 3, cacheHit: 0.2 }
  },

  /* ——— 情绪引擎参数：调这些数值就能改“脾气” ——— */
  mood: {
    inertia: 0.55,         // 上一刻情绪残留（越大越记仇/越慢消气）
    decayPerMinute: 0.6,   // 每分钟自然衰减强度
    minIntensity: 0.6,
    maxIntensity: 5
  }
};
