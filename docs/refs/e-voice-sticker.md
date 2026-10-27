# 参考仓库研究 · 语音互动与表情包（refs-e）

> 抓取方式说明：本机 api.github.com 未认证配额已耗尽（remaining=0）、raw.githubusercontent.com 10s 超时，
> 全部内容经 jsDelivr 镜像（`https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>/<path>`，备用 `fastly.jsdelivr.net`）取得，
> 三个仓库的主要源文件均已完整读到。抓取时间 2026-10-27。

---

### aceice01/dsh-whale-pet（24★，HTML/JS，DSH 桌面/网页双形态鲸鱼娘桌宠：晓伊神经网络语音 + 撒娇互动 + 任务完成提醒）

- **安装/运行方式**：`dsh plugin --profile web add github:aceice01/dsh-whale-pet`（自动挂 bundle patch），或 `powershell -ExecutionPolicy Bypass -File install.ps1`；桌面版靠 Electron 主进程开透明置顶小窗加载 `/pet.html`。
- **设定/人设**：**没有独立人设文件**，人设=台词表 + 语音，硬编码在两处且必须逐字对齐：
  - `tools/synth_all.py` 的 `LINES` dict（49 条，key 为稳定 id）：coquetry 0-14（15 条撒娇）、running 0-9、celebrate 0-9、sad 0-7、todo 0-3、approval0、welcome0 = 共 49 条（README badge "lines-49" 即此）。
  - `lib/pet.template.html` L641-700 的 `LINES` 对象：按情绪分 5 组（coquetry 15 / running 10 / celebrate 10 / sad 8 / todo 4），todo 组带 `{done}{total}{left}` 槽位，celebrate 首条带 emoji `✨`。
  - 语气规范：全部用"人家/主人～"、句尾波浪号、短句（10-20 字），**没有禁忌清单、没有开场白之外的 system prompt（未见 system prompt——本仓库不调用 LLM）**。欢迎语 `welcome0: "主人好～人家是鲸鱼娘！"`。
- **形象/Live2D**：**无 Live2D、无 Cubism**。素材是 6 个 GIF（`lib/anim/{idle,running,failed,waiting,waving,jumping}.gif`），`tools/build-pet.mjs` 用 sharp 转成 animated WebP 并把**帧延迟 ×3**（`DELAY_SCALE = 3`，舒缓节奏）后 base64 内联；另生成一张 idle 静止首帧 `ANIM_IDLE_STATIC` 让待机时"真的静止"。渲染栈=纯 HTML/CSS + `<img src="data:image/webp;base64,...">`，无 pixi。表情=无面部差分，靠动画片段 + 气泡文字表达情绪。
- **动作逻辑**：服务端 `plugin/dsh-balance-widget/lib/index.js` 订阅 `ctx.on("session/event")`，把事件折叠成一个 `work` 对象并暴露 `GET /api/status`（`Cache-Control: no-store`）：字段 `status('idle'|'running')`、`runningSince`、`doneAt`、`doneCount`、`lastTool{name,at}`、`lastToolError{name,code,at}`、`todos{total,done,summary}`、`goal{state,reason}`、`waitingApproval{toolName,reason,at}`、`command{name,running,at}`、`lastEvent`。**事件→状态映射**：turn/start→running；turn/end→idle 且 doneCount++/doneAt；tool/call→lastTool；tool/result（`d.error` 非空）→lastToolError；todo/write→统计 done；goal/change；approval/asked|decided；command/run|done。
  - 前端状态机（pet.template.html L711-735）：5 态 `idle / running / happy / coquetry / sad`，映射 `{running:'running', happy:'jumping', coquetry:'waving', sad:'failed'}`，用 `body.classList` + 换 `<img>.src` 实现。
  - 空闲行为：待机放静止帧，`scheduleIdleMotion()` 每 5-13s 随机播一次变体——`IDLE_VARIANTS` 带权重 idle:1 / waving:2 / waiting:2 / jumping:1，播完回静止（L747-772）。
  - 交互权重（L784-834）：点击帽子 = 65% 撒娇 / 20% 开心跳 / 15% 委屈；长按 0.7s = 摸头 + "被主人摸头啦"；双击=静音切换；三击=语音诊断面板；右键=自绘菜单（阻止 Electron 默认右键刷新）。
  - **"跟随 agent 工具调用"的映射**：有，但只做到气泡级——running 且有 lastTool 时 40% 概率冒 `正在用「{name}」忙活中…`，30% 概率冒 todo 进度句（`{done}/{total}/{left}`）；`waitingApproval` 时固定冒 `需要主人批准：{toolName} 🖐️` 并切 running；新 `lastToolError` 且距上次 doneAt 60s 内 → sad；`doneAt` 变化 → celebrate(doneCount)。**没有工具名→具体动作/立绘的表**（动画只有 5 态）。
- **对话逻辑**：**无 LLM 对话**。只有"冒泡 + 语音"，气泡由状态机/交互直接调 `showBubble(text, ms)`（默认 3200ms）。无上下文、无提示词拼装、无结构化输出、无流式、无失败兜底（未见）。
- **对话长度**：靠"台词表本身就是短句"保证，无运行时字数截断；唯一代码处理是 celebrate 时拼 `（已完成 N 次啦）` 入气泡，念的时候用 `line.replace(/（.*）/,'')` 剥掉（L773-782）。TTS 前另有一步 `speak()` 用正则剥 emoji/符号（U+1F300-1FAFF、2600-27BF、FE0F、2B00-2BFF、2190-21FF、200D、20E3）**以保证文本能逐字匹配到预合成片段**。
- **表情包/贴纸**：**未见贴纸系统**；情绪表达=动画 + 气泡文字 + 语音。
- **其他亮点**：
  - **三层语音降级**（本项目最有价值的部分）：① `AUDIO = __AUDIO_JSON__` 构建时把 `lib/audio.json`（base64 mp3，49 条）内联，`playClip()` 用 `AudioContext.decodeAudioData` + `GainNode` 播放，**完全离线、无网络**；② 命中不了就 `edgeSpeak()` 走 Edge 在线 TTS WebSocket：`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&ConnectionId=...`，SSML `<voice name='zh-CN-XiaoxiaoNeural'><prosody rate='+8%' pitch='+8Hz'>`；③ 再兜底 `speechSynthesis`，`VOICE_PREF = [/xiaoxiao/i,/yuyang/i,/yaoyao/i,/kangkang/i,/huihui/i,/zh[-_]CN/i,/Chinese/i]` 按序挑音色，`rate 1.0 pitch 1.1 volume 0.9`。注释明确写了原因："no system TTS (which is silent in the Electron sandbox)"。
  - 音色/韵律可配：`PET_VOICE=zh-CN-XiaoyiNeural`（默认）、`PET_RATE=+10%`、`PET_PITCH=+14Hz`；`synth_all.py` 支持断点续跑（已有 b64 跳过）+ 每帧落盘。
  - 自动播放策略：`window.addEventListener("pointerdown", unlockAudio, {once:true, capture:true})` 首次点击解锁 AudioContext。
  - 音量分级：`volFor(action) = petVolume * actionVol[action]`，`actionVol` 分 voice/sfx/celebrate 三路，滑块值存 localStorage。
  - 余额徽章：`/api/balance` 通过 `credentialRef("DEEPSEEK_API_KEY")` 服务端取 key（key 不进浏览器），30s TTL 缓存 + 失败回退上次值并打 `stale:true`。
  - 自更新：每 10s fetch `/pet.html?ts` 比对 `id="ver"` 版本串，不同则 `location.replace` 强制刷新。
  - Web 版：`client.js` 往 `shell.overlay` 注入 200×216 浮动面板，iframe 加载同一份 /pet.html，拖动用 `window.parent.postMessage({type:'dswp-drag',dx,dy,phase})` 桥接。
- **★可直接搬给本地项目的 4 条**：
  1. **语音三层降级 + 台词预合成**：照 `tools/synth_all.py` 的 `LINES`(key→text) + `lib/audio.json`(key→{b64,text,bytes}) + `lib/pet.template.html:507 playClip()`/`530 speakText()`/`543 speak()` 这套结构，本地 `persona/lines.json` 可原样加一层 `audio.json`，用 edge-tts 一次合成、离线播放，用 `AUDIO[k].text === text` 精确匹配，匹配不上再走 speechSynthesis。`speak()` 里那段剥 emoji 的正则必须照抄（否则带 ✨ 的台词永远匹配不上）。
  2. **把 agent 工作状态做成 `/api/status` 的扁平对象**：`index.js` L38-56 的 `work` 字段表就是一份现成的"桌宠可消费状态协议"，本地若接 DSH 联动直接复刻字段名（`status/lastTool/lastToolError/todos{done,total}/waitingApproval/doneAt/doneCount`），前端 1.5s 轮询。
  3. **交互权重表 + 长按/连击分流**：`poke()` 的 15/20/65 权重、长按 0.7s 摸头、双击静音、三击诊断（L950-1020），本地 `js/moods.js` 有情绪但缺"点击→情绪"的权重表，可直接补 `{p:0.65, mood:'shy'}, {p:0.20, mood:'happy'}, {p:0.15, mood:'hurt'}`。
  4. **音量分级持久化**：`volFor(action)=master*actionVol[action]`（master + voice/sfx/celebrate 三路滑块，localStorage 持久化），本地目前只有单一音量。
- **本地项目的缺口对照**：本地"无表情包/无语音/无 DSH 联动"，此仓库正好补"语音"和"状态协议"两块，但**不提供贴纸、不提供 LLM 人设**。

---

### mdd111/deepseek-dafeiyu-pet（20★，Python/PyQt5，Windows 大肥鱼桌宠增强版：11 个 DSH 动作联动 + 喂食 + 系统监控）

- **安装/运行方式**：`python -m venv .venv` → `.venv\Scripts\pip install -r requirements.txt` → `.venv\Scripts\pythonw 桌宠.py`（或双击 `启动桌宠.bat`）；仅 Windows 10/11，Python 3.10+（3.14 自带 `compression.zstd`）。
- **设定/人设**：**没有独立人设文件**，人设=一条 39 字 system prompt + 分场景台词表，全在 `桌宠.py`：
  - `桌宠.py:68` `DS_SYSTEM = "你是桌面宠物大肥鱼，贱兮兮但可爱，每句话不超过25字，偶尔吐槽主人但别真骂人。"`（约 39 字，直接写死在代码里，无分字段/无分层）。
  - 台词分层：`DSH_LINES`（L3931-3943，9 类：start/approval/error/done/tool_pwsh/tool_edit/tool_read/tool_web/idle，每类 2-3 句）、`FOOD_LINES`（L73-80，5 种食物各 2-3 句）、`LINES`/`INNER_LINES`（日常/心声两大板块，可在设置里整块关闭 `lines_off`）、`custom_lines` + `default_line_overrides`（config.json 可覆写内置句）。
  - 语气规范：短句、口语、带"～/嘛/咯/哦"、自称"我"、吐槽但"别真骂人"（唯一显式禁忌）。称呼用于 `agent_name`（默认 "Codex"）、`{app}`/`{name}` 等槽位由 `fill_vars()` 替换。
  - 语录频率 4 档（安静/正常/话多/话痨，`LINE_FREQ_LEVELS` 控制 `cooldown`）。
- **形象/Live2D**：**无 Live2D**。三视图 PNG（`sprites/正面.png`、`侧面.png`、`背面.png`，各 4 档高度 187/238/306）由 Qt `QWidget.paintEvent` 自绘，无 pixi/无 canvas。11 个 DSH 动作帧在 `sprites/dsh/<动作名>/<序号>_<高度>.png`（每动作 1-3 帧 × 3 档尺寸）。素材工具 `工具/make_frames.py`：**泛洪抠白底**（只抠连到画布边缘的浅色区域，人物内部白色不误删）→ 裁到角色 → **统一缩放角色高度 = 画布高 × 0.95**（切动作不跳大小）→ 生成 3 档。表情=无面部差分，全靠换整张立绘。
- **动作逻辑**（本仓库核心）：`桌宠.py` L4073-4108
  - `DSH_ACTS = {"start":(180,True), "approval":(140,True), "error":(160,False), "done":(220,False), "tool_pwsh":(200,True), "tool_edit":(200,True), "tool_read":(200,True), "tool_web":(200,True), "idle":(400,True), "sing":(400,True), "working":(400,True)}` —— 值 = (帧时长 ms, 是否循环)，正好 11 个。
  - `DSH_ACT_INFO` 同表带中文名与触发说明，供设置窗"动作一览"展示。`DSH_ACT_ZOOM = {"sing":1.18}` 单独放大。
  - **优先级链**（`_dsh_react` L8220-8265）：`approval > error > start > done > tool_* > 常态`；常态再分 `working(思考中) > sing(放歌) > 三视图`（`_dsh_act_revert` L8294）。
  - **工具→动作映射** `DSH_TOOL_KIND`：`pwsh|bash|shell→tool_pwsh`、`edit|write→tool_edit`、`read|glob|grep→tool_read`、`web_search|web_fetch→tool_web`。
  - 触发判据（关键改进）：工具反应不看"等够时间"，而看 **`tool/call` 计数增加**——`new_call = state.tool_calls > old.tool_calls`，再配 `DSH_TOOL_COOLDOWN=1.2s` 防刷屏；空闲判定 `DSH_IDLE_SEC=120s`（turn=False 且 mtime 静默 → 冒一句闲话）。
  - 帧选择 `_dsh_act_pix()`（L8266）：按 `i = int(dsh_act_t/ms)`，循环取模、单次动作 `min(i, len-1)`；同一序号多档尺寸时 `min(variants, key=lambda t: abs(t[0]-cur_h))` 挑**源高度最接近当前显示高度**的那张（越接近越清晰）。
  - 兜底：动作图没画 `play_dsh_act()` 直接 `name=None` 静默忽略，回三视图；`hold` 秒数到点自动收回（单帧动作不设 hold 会"挂着像卡住"——注释里写了这个坑）。
- **对话逻辑**：`_call_ds()` L8039-8080，**非流式**：
  - `POST https://api.deepseek.com/v1/chat/completions`，`model = "deepseek-chat"`，`messages = [{"role":"system","content":DS_SYSTEM}] + self.chat_history[-40:] + [{"role":"user",...}]`（**只带最近 40 条原始消息，无摘要/无 token 估算**），`max_tokens=100`、`temperature=0.9`、`timeout=10`。
  - 线程模型：worker 线程发请求，回复走 `_queue_say(text)` 入队，主线程 tick 统一弹出（线程安全）。
  - 失败兜底：分类文案且**每类只给 12 字**——`API错误: {err[:12]}` / `请求超时，检查网络` / `连接失败，检查网络` / `请求失败: {str(e)[:12]}`；并发保护 `ds_busy` 时回"等等，上一句还没回完呢"；无 key 时提示去设置。
- **对话长度**：**双重约束**——① 提示词里"每句话不超过25字"；② 代码硬截断 `if len(reply) > 30: reply = reply[:28] + "…"`（L8058）。气泡时长由 `say(text, seconds=2.8)` 控制，长句不自动延长。另有丰富的 `say()` 调度规则（L7996）：`idle=True` 的闲话与上句重复则丢弃；`queue=True` 的自动话术按 `_queue_behind()` 排队（队列上限 `_pending_bubbles[:-6]`）；触发类话（开应用/到点/快捷键）优先，闲话不许盖；免打扰 `quiet_left()>0` 时一句不说。
- **表情包/贴纸**：**未见**（无贴纸系统、无 emoji 入对话）。"喂食"是纯 emoji 面板：`FOODS = ["🐟","🍰","🍭","🍡","💎"]` + `FoodPanel` 弹窗，选中后 `on_food()` 换 `stretch` 动作 + 播 `FOOD_LINES[food]` 台词。
- **其他亮点**：
  - **会话日志增量读取 452ms→0.3ms**（`dsh_read_new` L4019-4052 + `_dsh_worker` L8139）：DSH 每追加一次写一个**独立 zstd 帧**（实测整份 1351 帧 ≈1.8KB/帧、8.8MB）。做法：`f.seek(offset)` 只读新增字节 → 循环 `n = _zstd.get_frame_size(chunk[off:])` → 只对**完整帧** `_zstd.decompress(chunk[off:off+n])` → `off += n`。帧写一半（`off+n > len` 或异常）就 break，**偏移只推进到最后一个完整帧**（保证下次从帧头开始，不会错位漏事件）。实测只解新帧 0.09ms；轮询 `dsh_timer.start(700)`，切换会话/文件变小时重置 offset。
  - 换会话那一拍**不反应**（`if is_new: return`），避免拿上一条会话旧状态比出新 start/done 误报；`_dsh_queue` 只取最新一条（`[-1]` + clear）防积压。
  - 系统监控：`psutil.cpu_percent() ≥90` / `virtual_memory().percent ≥95` / `pynvml` GPU `>80℃` 冒提醒句，10s 节流。
  - 余额/今日用量/峰谷价（高峰=周一至五 09:00-12:00、14:00-18:00，价格 2 倍）+ 每轮消耗；音乐 SMTC + LRC 歌词逐字卡啦 OK；13 页设置窗（`ui_console.py` 158KB）；`config.json` 首次运行自动生成（`dsh_link`/`dsh_debug`/`sing_on` 等开关）。
  - 隐私：只读 `%USERPROFILE%\.dsh\sessions\**\session.v4.jsonl.zstd`，永不外传，可在右键菜单/设置里关。
- **★可直接搬给本地项目的 4 条**：
  1. **zstd 增量帧读取**（`桌宠.py:4019 dsh_read_new`）：本地若要"跟随 DSH 干活换动作"，直接照抄 seek+get_frame_size 循环 + "只推进完整帧"的不变式，成本从每拍 452ms 降到 0.09ms。
  2. **11 动作表 + 优先级链 + 工具名映射**（`DSH_ACTS`/`DSH_ACT_INFO`/`DSH_TOOL_KIND` + `_dsh_react` L8220）：本地 `assets/whale/manifest.json` 已有 32 个 action（idle/walk/eat/wave/jump/dance/sneak/sleep/turn），可把 DSH 动作映射到这 9 个 clip 上，沿用 `approval > error > start > done > tool_* > working > sing > idle` 的链式判断。
  3. **"新 tool/call 计数"当触发判据**（不靠时间去抖）：`new_call = tool_calls 增没增` + 1.2s cooldown，比"每 N 秒冒一句"准得多；本地若接 `tool/call` 流可直接用。
  4. **28 字硬截断 + seconds 可控气泡**：`reply[:28]+"…"` 与 `say(text, seconds=2.8)` 的"气泡时长跟台词绑定"策略，可治本地流式长回复撑爆气泡的问题（提示词 25 字 + 代码 28 字双保险）。
- **本地项目的缺口对照**：本地"无记忆、单角色"；此仓库的 40 条 history + 台词板块开关 + 免打扰/排队优先级是最容易搬的"伪记忆 + 说话节奏"层。

---

### FeWOO/DeepSeek-meme（1★，JavaScript，DSH 表情包插件：面板 + 双随包 + 模型可调用的 send_sticker 工具）

- **安装/运行方式**：`dsh plugin add dsh-deepseek-meme`（npm，推荐）或 `dsh plugin add github:FeWOO/DeepSeek-meme`；要求 DSH 0.2.1-rc.2，Desktop/Web profile 均可；`dsh.bundle.patch = ./cordis.patch.yml`，`dsh.client.platform = web`（`immediately: true`，inject `@deepseek-ai/dsh-client-ui-conversation`）。
- **设定/人设**：**无角色人设**（未见人格/语气规范）。唯一"设定"是一段注入模型的**工具用法提示**：`index.js:1048` `ctx.systemPrompt.section({ name: 'tool:send_sticker', order: 115, text: '用户发来的表情包是一条纯图片消息，不会附带含义文字；请直接观察图片理解它的情绪和梗义。闲聊、问候、答谢、确认、撒娇等非任务对话，可以主动调用 send_sticker 回一张合适的表情；用户让你执行任务时以完成任务为主，表情只作点缀。每次回复最多一张。调用 send_sticker 成功后，把工具结果里的 markdown 图片（![...](...)）放进回复开头，让用户直接看到表情；工具卡片默认是折叠的。需要确认目录时用 action="list" 查看表情的 id、名称、含义和标签。' })`（约 180 字，order 115 决定插在系统提示中的位置）。
- **形象/Live2D**：**未见 Live2D**；贴纸素材是 640px 长边 WebP/PNG（透明背景、白边贴纸样式），`assets/default/`（GPT 绘制的 10 张）+ `assets/community/`（社区二创梗图 8 张）+ `assets/gpt/`（拆分源 PNG，不随 npm 包分发）。
- **动作逻辑**：**未见**（纯聊天插件，无桌宠形象/状态机）。
- **对话逻辑**：**双通道，都不伪造 Session 事件**：
  - **用户发表情**（`index.js:1000-1045 POST /api/memes/send`）：校验 `sessionId` 在 `ctx.sessions.get(sessionId)` 里活着（否则 409 `SESSION_NOT_LIVE`），把图缩到 `messageStickerSize`（默认 180，可配 96-240）→ `ctx.attachments.saveImage` → 再 `ctx.attachments.readImageRequest(fullRef, {width,height,maxBytes:512*1024})` 拿到缩放后字节 → `ctx.sessionController.prompt({ requestId, sessionId, mode: 'queue'|'steer', content: [{type:'image', mediaType, data: base64, name}] }, signal)`，30s AbortController 超时。**content 里只有 image，没有文字**（贴纸即消息）。
  - **模型发表情**（`tools.register` → `send_sticker` 工具）：`ctx.attachments.saveImage` 后再返回 `markdown: ![名](origin + /api/memes/assets/<id>?size=150)` + `image{attachmentId,mediaType,bytes,width,height}`。
  - 无流式相关代码；失败兜底：`fail(status, code, message)` 统一 JSON 错误、`sendError()`、找不到贴纸时返回 `{ok:false, message:'找不到表情 X，可以先调用 action="list" 查看可用 id'}`（**给模型可读的纠错话术**，不是抛异常）。
- **对话长度**：**未见文本长度约束**。图片尺寸约束明确：用户贴纸长边 180px（明显小于普通附件的 240px UI 上限，让聊天里"像表情"），模型贴纸内联 150px（`?size=150`，服务端用 `readImageRequest` 生成并缓存在 `smallAssetCache` Map，>400 条清空）。
- **表情包/贴纸**（核心）：
  - **数据模型**：`DSH_HOME/memes/catalog.json` + `memes/assets/<stickerId>.<ext>`，原子写入 + `#queue` 串行化。pack：`{id,name,description,order,bundled,createdAt,stickers[]}`；sticker：`{id('st_xxxxxxxx'), name, meaning(≤200字), tags(≤8个、每个≤16字), mediaType, bytes, width, height, url:'/api/memes/assets/<id>'}`。
  - **素材组织**：随包表情放 `assets/<pack目录>/manifest.json`（`assets/default/manifest.json` 即 "whale-gpt" 10 张、`assets/community/manifest.json` 即 "whale-community" 8 张），字段 `{pack:{id,name,description,order}, stickers:[{file,name,meaning,tags,width,height}]}`；启动时 `#listBundledManifests()` 扫 `assets/*/manifest.json` 自动播种，**`default` 先播、其余按字母序**；`#syncBundledPacks` 对**同 pack.id 保留用户编辑**（新增/删除 manifest 目录即可增删随包）。
  - **限制**：`MAX_PACKS=50`、`MAX_STICKERS_PER_PACK=500`、`maxStickerBytes=1MB`、`MAX_TAGS=8`、`MAX_NAME_LENGTH=40`、`MAX_MEANING_LENGTH=200`、`MAX_JSON_BODY=64KB`；`MEDIA_TYPES=['image/png','image/jpeg','image/webp','image/gif']`（**拒绝 SVG**），并用 `mediaTypeOf(buffer, declared)` 嗅探文件头而非只信 Content-Type。
  - **触发**：用户点面板网格（`StickerPanel` → `sendSticker(sessionId, sticker)`）；或模型调 `send_sticker`。渲染=**真实图片**（webp/png），不是 emoji/颜文字。
  - **模型可调用的工具**（`index.js:719-838`，最值得抄的一段）：`name:'send_sticker'`，description 里写清行为准则（闲聊主动发、任务时最多一张、**不得用表情代替必要的文字回答**、成功后把 markdown 图放回复开头）；`parameters:{action: enum['list','send'] (required), stickerId: string}`；`output.schema` 声明 `{ok,message,stickerId,name,meaning,markdown,image{attachmentId,mediaType,bytes,width,height,name}}`；`output.render(_args, value)` 返回 `[{type:'text',text: message+markdown},{type:'image',attachment: value.image}]` —— **工具卡默认展开并直接显示小图**。
  - **给模型看的目录文本** `catalogText(catalog, limit=120)`（L194-214）：输出 `可用表情包目录：\n【包名】\n- st_xxx｜名字：含义；标签：a/b\n...\n\n发送方式：调用 send_sticker，action=send，stickerId 用上面列出的 id。`，**上限 120 行**，空库时返回"表情包目录还是空的，可以先让主人添加几张。"——比塞 JSON 便宜、且模型能精确选 id。
- **其他亮点**：
  - HTTP 契约清晰（`docs/API.md`）：`GET /health`、`GET /catalog`（`no-store`）、`GET /assets/:id?size=150`、`POST /packs`、`PATCH|DELETE /packs/:id`、`POST /stickers?packId=`（元数据走自定义 header：`x-meme-name`/`x-meme-meaning`/`x-meme-tags`/`x-meme-width`/`x-meme-height`，用 `encodeURIComponent` 传输中文）、`PATCH|DELETE /stickers/:id`、`POST /send`。
  - Client 三个 slot：`conversation.input.right`（28×28 表情按钮，在模型选择器与发送键之间）、`conversation.input.dock`（全宽面板：包 tabs + 网格 + ＋添加 + 编辑 ✎ + 删除）、`tool.call.toolview`（工具卡，检测到 result 里有 image block 就 `disclosure.setExpanded(true)` 强制展开，再用 `props.loadImage(attachment)` 取 url）。
  - 上传时前端 `createImageBitmap(file)` 读宽高随 header 上报；`readImageSize` 失败不影响上传。
  - locale `zh.json`/`en.json` 双语（`ctx.locale.register`），CSS 全用 DSH 设计变量 `var(--dsw-alias-*)`，随主题变。
  - 隐私：只读写 `DSH_HOME/memes`，不联网、不上传、无遥测。
- **★可直接搬给本地项目的 3 条**：
  1. **`send_sticker` 工具定义整段照搬**（`index.js:719-838`）：`action:['list','send']` + `stickerId` + `output.schema` + `output.render` 返回 `[text, image]`。本地要做"让模型发贴纸"，只需把 `attachment` 换成 Canvas 图集渲染出的贴纸图（或本地静态贴纸文件），工具协议不用改。
  2. **`sticker.meaning` 字段 + `catalogText()` 目录注入**：贴纸不只是图，每个带 `name/meaning/tags`（meaning 写"什么时候用"的一句话），再用 `catalogText` 压成 ≤120 行纯文本塞进系统提示/工具 list 结果——这是"模型看得懂表情包"的关键，本地零成本接。
  3. **`assets/<pack>/manifest.json` 随包播种 + 同 pack.id 保留用户编辑**（`#listBundledManifests`/`#syncBundledPacks`）：本地 `assets/whale/manifest.json` 已是图集描述，可扩成 `packs[]` 结构，新增一套表情包 = 新增一个目录，不动代码。
- **本地项目的缺口对照**：本地"无表情包系统"——此仓库是唯一给出**完整贴纸数据模型 + 模型可调用工具 + UI 槽位 + 素材组织**的样本，`meaning/tags` 与 `catalogText` 是本项目最该抄的两处。

---

## 横向对比（给本地项目的取舍）

| 维度 | dsh-whale-pet | deepseek-dafeiyu-pet | DeepSeek-meme |
|---|---|---|---|
| 语音 | **三层降级 + 49 条预合成**（最完整） | 未见 | 未见 |
| DSH 状态联动 | `/api/status` 轮询 1.5s（5 态） | **zstd 增量读日志 0.09ms（11 态）** | 未见 |
| 人设 | 台词表即人设（无 prompt） | 39 字 `DS_SYSTEM` + 分场景台词表 | 无（只有工具用法 prompt 段） |
| 对话/LLM | 无 | `deepseek-chat` 非流式 + 40 条 history + 28 字截断 | 无（只发图） |
| 表情包 | 无 | 无（仅 emoji 喂食） | **完整贴纸系统 + send_sticker 工具** |
| 立绘/渲染 | GIF→WebP base64 + HTML | Qt QPainter 三视图 + 动作帧 | 无 |

**给本地的组合建议**：语音抄 whale-pet 的三层降级；DSH 联动抄 dafeiyu 的增量帧读取 + 11 动作优先级链；贴纸抄 DeepSeek-meme 的 `meaning/tags/catalogText/send_sticker` 四件套。三者互不冲突，且都不依赖 Live2D 运行库——与本地"Canvas 2D 图集"路线一致。
