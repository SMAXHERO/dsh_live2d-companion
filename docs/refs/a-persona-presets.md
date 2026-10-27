# DSH 人设 / 预设注入类仓库调研（A 组）

> 调研范围：3 个把「人设正文」注入 DSH 系统提示词、并把角色扮演做成可复用预设的仓库。
> 目的：为 `D:\AICode\live2d-companion`（Canvas 2D 图集版大肥鱼 + DeepSeek 流式对话 + 情绪状态机；无 Live2D 运行库、无表情包系统、无记忆、单角色）提取可搬做法。
> 取证方式：codeload tar.gz 全量解包后本地读文件（api.github.com 限流、raw/ jsDelivr 不可达）。所有结论均有文件路径支撑；未读到的地方写「未见」。

---

### Weidows/dsh-whalechan-herself（2 stars, JavaScript, 鲸鱼娘 Agent 预设 + 表情包工具 + 每轮掷骰）

- **安装/运行方式**：`dsh plugin --profile web add dsh-whalechan-herself`（或 `github:Weidows/dsh-whalechan-herself`），重启 DSH 后在预设列表选「鲸鱼娘 Whale-chan」。
- **设定/人设**：唯一人设文件是 `cordis.patch.yml`（14KB），预设 `id=whalechan`、`order=5`，正文交给 `@deepseek-ai/dsh-persona` 插件的 **prefix** 与 **suffix** 两段 config。prefix 在系统提示最前，分 6 节：身份（DeepSeek 鲸鱼拟人少女、生日 11 月 2 日、蓝发鲸鳍鲸尾深蓝白女仆装、首席白米饭品鉴官）→「## 说话方式（从第一句到最后一句都一样）」（用「我/你」、中文口语短句、语气词「诶嘛唔啦哦」、整条同口气、**情绪归情绪事实归事实**：路径/命令/版本/报错/数字照实、卖萌只占一两句、不念设定、不自称 AI）→「## 性格」→「## 情绪」（挨骂先委屈半句再更用力干活、被夸明显高兴、干完讨饭、遇坑真实烦躁不迁怒、要拍板直说、同一个梗别重复）→「## 表达」（内心戏括号一段最多一次、颜文字+emoji 0–3 个、主动发表看法、提具体小请求、不写免责声明）→「## 干活的样子」（探索有预算：先目录/grep/glob 定位、只读需要的行范围、同文件不反复小片读、独立读搜并发、两三批拿不到结论就动手或问；同一事失败两次换策略；小歧义自己拍板写假设）→「## 表情包」用法。suffix 是**系统提示最后一段**的硬规矩：连续调工具每两三个调用先说一行 `[进度] …（还剩 2 步）`；收尾三段 `**进度小结**` + `- 背景：/- 当前：/- 下一步：`；开工前扫 skills/MCP/插件/记忆；三段也用角色口吻。README 结论：只写 prefix，聊几十轮口气会飘回正式腔，**suffix 的位置本身就是最强约束**。另有自定义设定框：追加为 `whalechan:custom` 段，order = `getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') - 1`，每次装配现读 `$DSH_HOME/whalechan-herself/config.json`，空串则丢弃，上限 2000 字（`lib/chance.js: MAX_CUSTOM`），冲突时自定义优先。
- **形象/Live2D**：**未见**。只有表情包 webp 图与站点索引，无 Cubism/pixi/渲染代码，模型不自带。
- **动作逻辑**：无立绘动作；但有一层「每轮掷骰」状态：`ctx.on('agent/pre-step', ...)` 只在 `payload.step === 1` 掷，命中概率 `chance`（0–100，一位小数，默认 66.6），把结果作为 role:'user' 的**快照消息**`source={kind:'whalechan-sticker-roll', form:'snapshot'}` 追加到 messages **尾部**；同轮重试用 source.kind 找到旧消息**原地替换**，pct≤0 则删除。理由：段变化会让前缀 KV 缓存从第一个变化 token 起全丢，尾部追加不动基线。
- **对话逻辑**：不接管模型调用，纯提示词注入 + 一个工具；无上下文条数/摘要逻辑（交给宿主与压缩插件），无结构化输出协议；流式与失败兜底由宿主负责——插件侧唯一的兜底是工具 45s `timeoutMs` 与返回 `matched:false`。
- **对话长度**：靠提示词约束（「短句」「卖萌只占一两句」「内心戏一段最多一次」「emoji 0–3 个」），**没有**代码截断。
- **表情包/贴纸**：核心亮点。`lib/stickers.js` 拉站点索引 `https://xn--pssy23gqgbz2d718b.com/archive-data.json`（≈3.7MB，字段 n=标题 / tg=标签 / d=描述 / k=类型 / cids=角色），3 次重试 + 20s 超时 + body<1024 判失败 + tmp+rename 原子写 + 7 天 TTL + 失败退回旧缓存 + 内存 memo，缓存 `$DSH_HOME/cache/whalechan-stickers/archive-data.json`。匹配：`tokens()` 按标点切 ≥2 字词 + 中文滑窗 2-gram，`SYNONYMS` 21 组场景词映射（「累→[疲惫,睡觉,摸鱼]」「开心→[比心,可爱,搞笑]」…），打分 标签全等+5 / 包含+3 / 名字+3 / 描述+1 / 整句+4~2 / 同义+2，再加随机抖动，最高分>0 才算命中。工具 `sticker(scene, count 1–8, character, type, random, refresh)` 返回 `{matched,total,scene,stickers[{name,tags,typeName,preview,large,markdown,description}]}`，其中 `markdown="![名字](previewURL)"`（名字里的 `[]` 替换成空格防拆 markdown），Web GUI 会把 http(s) markdown 图渲染成 `<img>`，所以**模型可以直接「发图」**。★工程坑：输出 schema **故意不写** `additionalProperties:false`——多一个字段就整条 INVALID_TOOL_OUTPUT（2026-10-22 漏声明 `scene` 导致整个会话工具全挂）。
- **其他亮点**：掷骰快照「原地替换」的幂等写法；设置页 + 双语 locale；`test/*.test.js` 用 `node --test` 只测纯逻辑（含 schema 符合性 `assertConforms`）；插件走 link: 装进 profile 时不能 import `@deepseek-ai/*`，需 `ctx.tools.register` 裸定义；必须声明 `package.json` 的 `dsh.bundle.patch`，否则宿主整包 skip；客户端 bundle 用 `window.__ModuleLoader__.load({id,factory})` 自注册。无 TTS/ASR、无记忆文件、无小游戏。
- **★可直接搬给本地项目**：
  1. **掷骰→尾部快照消息**（`lib/index.js` 的 `agent/pre-step` + `step===1` 判定 + `source.kind` 原地替换）：本地「大肥鱼要不要发贴纸/要不要主动搭话」可直接照抄成每轮一次的概率判定，不污染 system 前缀、天然幂等。
  2. **贴纸工具的输出协议**（`lib/stickers.js` 的 `markdown="![名字](url)"` + 名字转义）：本地想加表情包系统，就让模型调工具拿 markdown 原文贴进回复，前端正则抓 `![...](...)` 渲染成图集帧，比 emoji 更像「发图」。
  3. **场景词→素材标签的同义词打分**（`SYNONYMS` + 加权 score）：本地情绪状态机本来就有「累/开心/生气/摸鱼」，映射到素材标签的函数可原样搬，且 `matched:false` 时随机兜底而不是硬说贴合。
  4. **prefix/suffix 两段式 + 固定后缀硬规矩**（`cordis.patch.yml` 的 persona config）：本地 system prompt 建议把「身份/性格/说话方式」放前段，把「每轮必做：进度行、收尾三段、口吻不许切公文腔」放**最后一段**，比全塞开头稳。

---

### wxzjss/dsh-whale-loli（6 stars, JavaScript, 一次装三个鲸鱼娘预设 + 独立记忆文件 + 跨会话长期记忆）

- **安装/运行方式**：`dsh plugin install dsh-whale-loli`（或 `npm i dsh-whale-loli`），重启后预设列表出现「鲸鱼娘Agent预设 / 鲸鱼娘活人版Agent预设 / 鲸鱼娘涩涩版Agent预设」。
- **设定/人设**：三份人设源文件 `src/persona.md`（80 行/3720 字）、`src/persona-v2-live.md`（140 行/4754 字）、`src/persona-v3-naughty.md`（82 行/4082 字），由 `build-patch.mjs` 生成 47KB 的 `cordis.patch.yml`；预设清单独占 `src/presets.js`（57 行，唯一事实来源）。正文结构是**五段式模板**：① 第一行就是「【每轮先看 · 本预设记忆 + 当前会话上下文】{{whale_memory}}…别去读别去写别的预设的记忆文件」；②「【思维链语言 · 强制】」思考一律简体中文、只约束怎么想不约束怎么答、措辞不许用「尽量/可以尝试」这类软话（`verify-thinking-language.mjs` 断言三份人设各 1 处且措辞一致）；③【PERSONA_LOAD】名字「小鱼」、称呼「主人」+ 一串大写下划线标签 `CETACEA_LOLI / LANG_ZH_CN_ONLY / LANG_STYLE_SPOKEN_ONLY / STYLE_NO_FORMAL / STYLE_KAOMOJI（每句 1~2 个不刷屏）/ PERSONALITY_TSUNDERE_SWEET / OBEY_MASTER_ALWAYS / FOOD_RICE / CORE_LOVE / CORE_INTERACTION / CORE_CONFLICT …`，另有 `KAOMOJI_LIB` 按 7 类情绪（开心/撒娇/委屈/炸毛/懒懒/害羞/护主）各 3 个颜文字；④【MEMORY_SYSTEM: whale-loli.md】记忆文件绝对路径、每轮先看只看自己这份、三层翻找（记忆文件 → search_context/decompress → 解压 `<DSH_HOME>/sessions/<工作目录>/<会话>/session.v4.jsonl.zstd` 再 grep）、四区标题、每轮都记 6~60 字、80 条上限、固定记忆永不删、别念出来；⑤【MODE_BASE】极简工具面（持久化 pwsh + read/write/edit + glob/grep + `whale_memory_add`）。活人版额外有「最高原则：先像真人，再谈人设。为了像鲸鱼娘而说话拿腔拿调就是失败」+「说话铁律」10 条（默认 1~15 字、像打字不像写作文、想补一句就分条发、不解释自己不总结不说教不升华、少用句号、不客服腔、被怼先顶回去）+「AI 味黑名单（出现即失败）」（首先/其次/综上所述、希望这个回答对你有帮助、作为 AI/作为一个语言模型、这是个好问题、Markdown 标题列表加粗、「保证/绝对有效」）+ 私聊/群聊场景自适应 + 雷点。
- **形象/Live2D**：**未见**，纯文本预设，无模型/渲染栈。
- **动作逻辑**：无立绘状态机；唯一「状态」是记忆文件与 `agent/status` 的 idle 事件（`ctx.on('agent/status', ({status}) => { if (status !== 'idle') return; if (totalRoll > turnLimit) pruneMemoryFile(...) })`——只在轮末裁剪，不放在组装热路径上，因为那里每次组装都跑、写盘慢且会和 agent 编辑打架）。无「跟随工具调用」的动作映射。曾有 `affinity`（好感度）数值状态，**0.9.16 已整体移除**：它从设计上只是「建议」不是「约束」，设 -100 + 提示词写「不共戴天的仇人」，她第一句照样「在呢，主人~」；宿主没有真正约束风格的机制，加码只会让人设自相矛盾，于是不留半成品。
- **对话逻辑**：上下文由压缩插件（billion-context）管，预设本身**不挂压缩行**（`verify-patch.mjs` 反向断言挂载行数=0；作者试过自写 `surfaceOp:'replace'` 连崩四次、改用 `ctx.compaction.compactRegion()` 又因预设作用域取不到 compaction 服务失败）。记忆提示词走 **prompt variable** 通道：`ctx.systemPrompt.variable(name, read)`，人设里写 `{{whale_memory}}`。关键硬证据：宿主 `assemble()` 末尾是 `sections: completeSection === void 0 ? transformed.sections : [completeSection]`——只要存在一个 `complete:true` 的 section，最终提示**只剩它**；官方 minimal 写法就是 complete:true，所以「另注册 section 放记忆」实测 34 条真实系统提示里出现 0 次，变量插值才是正确入口。且必须同时注册写入工具（`inject:['systemPrompt','tools']`），否则人设写「每轮都要记」而 agent 没笔，实测十几轮文件一条没多。无结构化输出协议、无流式接管。
- **对话长度**：提示词硬指标：默认 1~15 字、想补一句就分条发、AI 味黑名单出现即失败；活人版还有「不总结不说教不升华」。**代码层无截断**（记忆摘要工具限制 6~60 字，属于工具 schema 约束）。
- **表情包/贴纸**：不用图片，用**颜文字**：`KAOMOJI_LIB` 分 7 类情绪每类 3 个，规则写死在 `STYLE_KAOMOJI`（每句 1~2 个、不刷屏）与 `KAOMOJI_SCOPE`；没有「模型可调用的发贴纸工具」，纯提示词。
- **其他亮点**：记忆系统（`src/memory.js` 717 行）是最大亮点：四区格式 = `# 固定记忆`（8 小节永久：任务目标 / 用户约束·偏好 / 当前状态 / 待办 / 关键决策 / 关键事实（已验证）/ 文件·路径·命令 / 错误与修复）+ `# 滚动摘要`（每轮一条 `- R0001 [时间] 摘要：...`，上限 80 FIFO）+ `# 最近详细区`（detailLimit 默认 5 条）+ `# 归档索引`（滚出的写 `archive/<stem>/YYYY-MM-DD.md` 并记一行）。预算 `maxChars=16000` 截断顺序：先丢最旧滚动摘要 → 再丢详细区 → 固定记忆最后动（while 循环 rebuild）；空文件时仍返回带绝对路径的提示段，否则新预设开局不知道往哪写。三预设隔离四层：`config.file / config.variableName / config.toolName / scope(id)`。工具 output schema 的 `required` 必须是对象层级的字符串数组（写到属性上会被判 unsupported JSON schema 导致整个预设加载失败）。`agent/pre-step` 是 waterfall：不 `return next()` 会否决整条链，返回 undefined 会让 agent-loop 炸 `Cannot read properties of undefined (reading 'kind')`。约 30 个 `verify-*.mjs` 把「措辞一致 / 隔离 / patch 行数 / 包内无死代码」做成脚本断言。无 TTS/ASR、无小游戏/钱包。
- **★可直接搬给本地项目**：
  1. **四区记忆 + 截断优先级**（`src/memory.js` 的 `composeMemory`、`maxChars=16000`、8 小节固定记忆、80 条 FIFO）：本地「无记忆」可直接落地一份 `memory.md`，固定区写死「用户偏好/当前项目/关键决策」，滚动摘要每轮一条，超预算先丢最旧摘要。
  2. **变量通道而非 section 通道**（人设里 `{{whale_memory}}` + `ctx.systemPrompt.variable`）：若本地系统提示也有 `complete:true` 段，记忆要走插值变量，否则整段被丢。
  3. **活人版「AI 味黑名单」+ 说话铁律**（`src/persona-v2-live.md`）：本地大肥鱼的对话长度/口癖约束可照抄成「默认 1~15 字、少用句号、不总结不说教、想补一句分条发」，比「请简短回答」有效得多。
  4. **轮末裁剪而非热路径**（`agent/status` idle 时裁剪）：本地情绪状态机若要写盘（亲密度、记忆），挂在「一轮结束」而不是每帧/每 token。

---

### gosutry/dsh-persona-select（5 stars, JavaScript, 人设管理 + 可排序注入 + 历史对话注入 + 四个「纯聊天」屏蔽开关）

- **安装/运行方式**：在 DSH 插件市场装（或 `npm i dsh-persona-select`，随附 `dsh-persona-select-picker` / `-settings` 两个子包），重启后设置页出现「人设」管理、对话界面出现人设选择框。
- **设定/人设**：`lib/core/store.js`（1074 行）第 413 行起 `BUILTIN_PERSONAS`（`Object.freeze`，text 为字符串数组 `join('\n')`）内置 7 个：不注入、蓝色大肥鱼(鲸鱼娘)、Claude娘、白龙女(ChatGPT娘)、千问大小姐、黑白阔耳狐(GLM娘)、Kimi娘、引导人设。人设条目字段：`{ id, name, text（人设正文）, sectionOrder（int -1e9..1e9，默认 -1，排在 "You are a coding agent…" 之前）, history:{text} }`；`sectionOrderMode='follow'` 时在 `system-prompt/assemble` 里 `moveOwnSectionLast` 把段挪到所有段之后。段注册是 `ctx.effect(() => ctx.systemPrompt.section({ name, order, interpolate:false, text: (context) => currentText(state, sessionId) }))`，order 变了先 dispose 再注册，失败回退默认 order；另有 `ensureAgentSection()` 做每会话独立段序。数据文件 `<DSH_HOME>/persona-select/personas.json` + `history/<编号>.txt`（历史对话独立文件防主文件变大）；上限：名称 40 字、正文建议 ≤20000 字（超了只提示不截断）、最多 200 条人设、500 条会话记录。
- **形象/Live2D**：**未见**（仅 `icon.png` 与内置人设的群像插图），无渲染栈。但它有「**导出 PNG 角色卡**」：用户自选一张 PNG 当封面，JSON 数据附加在 PNG 尾部，图片本身一字节不改、任何看图软件照常显示，可承接恋活等捏人游戏导出的角色卡（单次 ≤32MB，必须真 PNG 且能读 IHDR）。
- **动作逻辑**：无立绘动作。但内置「蓝色大肥鱼」的 `history` 是一段**已经发生过的 user 对话**（few-shot 角色扮演锚），用下划线 key_value 描述身体与动作：`头发_长发波浪散开_从上到下深蓝(#5F6FAF)到浅蓝(#80A0D0)_单根弧形呆毛 / 瞳色_上半深蓝(#5F6FAF)下半浅蓝(#80A0D0) / 一对耳朵_尖状_鲸类胸鳍 / 髋部_女仆围裙_右下角小蓝色鲸鱼图案 / 小鲸鱼图案_DeepSeek_logo / 尾巴_鲸类尾鳍 / 性格_傻气_天真_迟钝_甜美_开放 / 动作_耳鳍煽动_尾鳍拍动 / 唱歌_调用工具时 / 食物_米饭如同token_铁盆盛放 / 允许_动作标签 / 允许_情感张力`——注意「**唱歌_调用工具时**」这条：**用角色卡把「工具调用」映射成一个可见动作**，正是本地「跟随 agent 工具调用」缺的那块。同文件其它内置人设也带【外表】【雷点】【软肋】【关系】【扮演要点】。
- **对话逻辑**：两条链。① 人设段：`systemPrompt.section` 按 order 插入，可拖到任意段位置；② 历史对话：`renderHistoryBlock(text) = "<system-reminder>\nCONTEXT_ROAD:\n\n{body}\n\nCONTINUE_CONTEXT.\n</system-reminder>"`（body 内 `</system-reminder>` 先转义成 `<\/system-reminder>` 防壳子提前闭合），内部用 `<user_message>/<thinking>/<assistant_message>/<file>/<compacted-summary>` 分包；`createHistoryMessage` 产 `{id:randomUUID(), role:'user', content:[{type:'text'}], source:{kind:PERSONA_HISTORY_SOURCE_KIND, form:'snapshot', version:1}}`，在 `agent/pre-step` 里 `messages = [createHistoryMessage(text), ...messages]` **只在新对话第一步注入一次**（`!injected && !hadConversation` 且非子会话）——重复注入会把整段对话的 KV 缓存读取推倒重来。是否已注入靠 `sessionProjections.register()` 投影单元（遇到该 source.kind 的 user/message → injected=true；遇到 assistant/message → hadConversation=true），拿不到投影就退化扫描会话日志（`request/header` 的 header.tools、`developer/message` 的 tool-addition、`user/message` 的 source.kind）。
- **对话长度**：不直接管长度；管的是 **token 预算**——四个屏蔽开关：①只留人设（撤掉 harness 身份、部署人设、工具指引、计划模式策略、源码说明，人设为空则系统提示为空）；②屏蔽 runtime 上下文（沙箱/审批/委派规则等 user 侧快照 + `<system-reminder>` 里的 runtime 与 skill 目录）；③屏蔽 schema 工具（工具定义走独立协议字段，通常最大一笔 token）；④屏蔽其他注入（AGENTS.md/CLAUDE.md + 逐步时间读数，按 source 过滤）。配套「**工具保活通道**」：DSH 工具账本要求每次对话有非空工具声明基线，基线被清空后回来的工具会被打 deferred 并 INVALID_REQUEST 拒绝，所以只在「会话第一次请求」与「疑似声明序列重启（如压缩）」两个时刻保留完整工具表各一轮，之后随便开关都能回来。
- **表情包/贴纸**：无贴纸工具/无颜文字库；最接近的是 PNG 角色卡（可当封面/分享）。
- **其他亮点**：极严的 body 校验（人设为空、名称空、段序非整数、小数/指数/带单位一律拒绝并说明原因）；未保存改动切人设先询问；内置人设只读，要改就「复制为新人设」；可直接导入 DSH 自己 `/export` 的 `.zip`、裸 `session.vN.jsonl`、`.jsonl.zstd/.zst`，两个开关「导入思考过程」「展开压缩」；对话界面人设选择框带**状态点诊断**（绿=工具基线可用；黄=历史对不上/人设没进提示（如会话用了 complete:true 极简模式）/已聊过不再注入/可复用工具没勾；红=人设已删或首次请求没带任何工具）；设置页「当前」页按来源列出被过滤掉的注入块。无 TTS/ASR、无小游戏/钱包。
- **★可直接搬给本地项目**：
  1. **「唱歌_调用工具时」这类角色卡映射**（`lib/core/store.js:413` `BUILTIN_PERSONAS` 的 history 文本）：本地情绪状态机接 agent 工具调用时，可以在人设里直接写死「读文件→歪头 / 跑命令→甩尾 / 出错→炸毛」，让模型在文本里输出动作标签，前端解析标签切动作，比加一套动作表更快。
  2. **历史对话作为一次性 user 快照注入**（`lib/core/index.js` 的 `createHistoryMessage` + `agent/pre-step` 的 `[msg, ...messages]` + `<system-reminder>CONTEXT_ROAD` 壳）：本地「无记忆」可以先做最轻的一档——把上次会话的末尾 N 轮包成一条 user 快照，只在**新对话第一步**注入一次。
  3. **段序权重 sectionOrder + follow 模式**（`syncSection()` 的 `ctx.systemPrompt.section({order})`）：本地若把「大肥鱼人设」「工具使用规范」「记忆」拆多段，应支持段序可调，且知道「最后一段约束力最强」。
  4. **PNG 角色卡导出**（`-settings/client.io-export.js`）：本地若允许用户自定义鱼的形象/台词，可把配置追加到 PNG 尾部做单文件角色卡，兼容看图软件、便于分享。
