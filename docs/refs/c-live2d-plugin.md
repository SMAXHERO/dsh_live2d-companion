# c-live2d-plugin：DSH Live2D 桌宠参考（refs-c）

> 取文件方式备注：本机 raw.githubusercontent.com / github.com / codeload 均被墙（连接超时），api.github.com 未认证配额打满（60/h，core remaining=0）。实际用 **gh-proxy 镜像**取到的原文（GitHub 上路径与本文所述一致）：
> `https://gh-proxy.com/https://raw.githubusercontent.com/<owner>/<repo>/main/<path>`（备用 `https://ghfast.top/…`，两个都实测 200）。
> jsDelivr 在本机 ECONNRESET、ungh.cc 429，均不可用。

---

### Andersen216/dsh-whale-girl-live2d（star 数未取到·API 限流；JavaScript；DSH Web 右下角的 Live2D「鲸鱼娘」桌宠插件：44 表情/8 动作跟 agent 真实事件流变脸，点击说话，右键钱包）

**安装/运行**：插件本体 `dsh plugin --profile web add github:Andersen216/dsh-whale-girl-live2d` → **重启 DSH** → 强刷页面；自检 `GET /dsh-pet/pet.js`（401=已挂载、404=没加载）。要求 DSH 0.2.0-rc.x；**零第三方依赖**（只用 node 内置模块）。开发预览 `node tools/preview-server.mjs`（:5199，带假 agent 事件发生器）。插件清单：`package.json` 的 `dsh.bundle.patch: ./cordis.patch.yml`；`cordis.patch.yml` 只有 `- insert: [{id: dsh-live2d-pet, name: dsh-whale-girl-live2d}]`（**name 必须等于包名**）；profile 的 `~/.dsh/profiles/web/package.json` 里 `dependencies` 与 `dsh.profile.bundles` 都要有包名；`files` 打包 lib/assets/docs/skill/cordis.patch.yml；`bin: dsh-pet → tools/pet-ctl.mjs`。

**设定/人设**：**没有** persona/system prompt 文件，人设=硬编码常量表。`assets/pet.js` 顶部「一、性格表」（约 96–546 行）：`MOOD_FACE`（情绪→表情文件名）、`PROPS`/`SCENES`（常驻，`group` 同组互斥、`needs` 前置、`key` 原作者热键）、`ACTIONS`（一次性，含 `ms` TTL、`mood:null` 表示不压动画自带表情）、`FACE_ACT`/`PROP_ACT`/`SCENE_ACT`（每项配 3 句台词）、`TOOL_LINE`（30+ 工具各 2–5 句）、`TOOL_REACT`（工具→{mood, prop}）、`SAY`（idle/slack/start/done/fail/head/body/many/ticklish/fat/hungry/reading/tidy/thinking/working/wake 共约 60 条短句）。语气规范写在注释：称「主人」、自称「人家/本鲸」、傲娇嘴甜、贪吃白米、不能被叫胖、不叫鱼片。`skill/SKILL.md:13` 有一行浓缩人设。**不拼 system prompt**：桌宠不产 LLM 文本，用户输入经官方 `sessionController.prompt()` 直接进会话。

**形象/Live2D**：`assets/model/c_0120.2048`（moc3+model3.json+physics3+44 个 exp3.json），来自 VTube Studio 素材（B站@氵六青），美术 CC BY-NC-SA 4.0 非商用。渲染栈 **PIXI 6.5.10 + pixi-live2d-display 0.4.0 + Cubism Core**，全部 vendored 到 `assets/vendor/`，加载顺序固定（pet.js:1555-1560）：`live2dcubismcore.min.js → pixi.min.js → cubism4.min.js`，再 `Live2DModel.from('/dsh-pet/model/c_0120.model3.json',{autoInteract:false,autoUpdate:true,idleMotionGroup:'idle'})`。PIXI.Application 30fps（低性能档 20fps）、`resolution=min(dpr,1.5)`、`preserveDrawingBuffer:true`（alpha 掩码要读像素）。44 表情其实是 44 组参数开关（全 Add 混合），**不用**框架 expressionManager，自写 rig 挂 `internalModel.on('beforeModelUpdate', applyRig)`（动作/眨眼/视线/物理算完之后写，帧末 loadParameters 还原故不累积）；禁用 `internal.eyeBlink` 自写 `blinkTick`；物理交给 physics3.json；口型用嘴部参数近似（`rig.talking`，模型无口型参数）。原 VTS 模型没有 Motions 段，`tools/build-model.mjs` 生成 `assets/model/manifest.json`（motions 带 `params` 清单/loop/ambient）。

**动作逻辑**：状态来自宿主 SSE `/dsh-pet/events`，后端监听 `ctx.on('session/event')`（user/message、turn/start、step/start、assistant/message、assistant/attempt、tool/call、tool/result、turn/end、approval/*、session/title）和 `ctx.on('agent/assistant-stream')`（text-delta / reasoning-delta / tool-call-delta）；只认「人正在用的主会话」（`primarySessionId`，由 `d.source.kind==='user'` 确定），子代理只发 `{t:'subagent'}` 轻信号。前端三层：`base`(mood+props) / `override`(一次性 `act()` 带 TTL) / `gaze`；`act()` 保证一个表情+至多一个动作+至多一个特效、单参数单写者。前端 `agent.status`：idle/listening/thinking/speaking/working。工具映射：`TOOL_REACT` 里读类→{mood:'reading', prop:'auto'}（`randomGlasses()` 随机圆/方/椭圆/三成不戴）、搜索类撞 `DEVICE_TOOLS` 把笔换手机、产出类→happy+stickerCat、ask_user_question→confused。工作轮播 `workTick` 每 1.5s 一次、在「认真/摸鱼/思考」间 9–14s 慢切换；待机权重表 `IDLE_TABLE=[['glance',46],['express',28],['mutter',22],['hungry',4],['nopang',2]]`，3.5–7.5s 摇一次，待机**不放任何动作**；2s 兜底看门狗把空闲态强制复位 neutral；`sleepAfterMs:180000` 打哈欠→sleepy；turn-end 播 `celebrate`（随机猫耳/兔耳/花花/心跳）+ 统计气泡。

**对话逻辑**：**没有自己的 LLM 调用、无上下文条数/token/摘要管理**。输入框 Enter → `POST /dsh-pet/say {text}` → 宿主 `controller.prompt({requestId, sessionId, mode:'queue'|'steer', content:[{type:'text',text}]}, new AbortController().signal)`（第二个 signal 参数必需，否则 `signal.throwIfAborted()` 炸）；没会话时先 `controller.create({})` 自动开一个。打断：`POST /dsh-pet/cancel` → `controller.cancel({sessionId})`。回复走 SSE 的 `delta` 逐字进气泡（`bubble.show(text,{stream:true})` 累加 buffer），`assistant` 事件用完整文本 sticky 显示。兜底：fetch 失败→气泡「发不出去：…」；SSE onerror 指数退避重连（800ms×retry，封顶 10s）；启动异常挂 `window.__DSHPetError` 并把 stack 显示在气泡。无结构化输出协议（不产 JSON）。

**对话长度**：宿主 `assistant` 事件 `textOf(...).slice(0,8000)`、`user` 事件 `slice(0,4000)`；前端气泡 `buffer.length>4000 ? '…'+buffer.slice(-4000)`（pet.js:2544）；CSS `.dshp-body{max-height:150px;overflow:auto}`；user 气泡再 `slice(0,300)`；SKILL.md:197 明令「气泡最长 4000 字、可视高度 150px，长内容留给正常回复」。台词本身全是短句常量，靠**素材表**而非提示词约束。

**表情包/贴纸**：没有 PNG/emoji 贴纸系统；「贴纸」= Live2D 表情参数（猫猫/兔兔/蝴蝶结贴纸 .exp3.json），以**道具常驻开关**呈现。菜单四页（表情/装饰/场景/动作）＝四种生命周期：表情 3–4s 临时、装饰+场景常驻（再点取消，同类 `group` 互斥）、动作一次性 TTL。给 agent 的驱动面不是 tool 而是 **HTTP `POST /dsh-pet/control`**（字段 mood/expression/motion/say/bubble/bubbleMs/props/clearProps/attention/report）+ CLI `tools/pet-ctl.mjs`（status/mood/expr/motion/say/ask/prop/clear）+ `skill/SKILL.md` 教 agent 何时用、怎么不重复驱动。

**其他亮点**：右键钱包 HUD（`GET /dsh-pet/hud`：DeepSeek `user/balance` 余额 + 峰谷计价 `PRICE.flash hit[0.02,0.04]/miss[1,2]/out[4,8]`、`HOLIDAY_VALLEY` 节假日表、`turn/end` 用 `costOf(usage,peak,tier)` 结算、60s 缓存、每轮自动弹 9s）；alpha 掩码命中判定（postrender+preserveDrawingBuffer，点空气事件穿透到 DSH UI）；视线跟随/眨眼自定义；设置与位置存 localStorage（`dsh-live2d-pet:layout`）；桌面壳通行证 `~/.dsh/dsh-live2d-pet-desktop.json`（600 权限随机 token，回环+token 过 `connection.requestRejection` 信任栅栏）；`/dsh-pet/diag` 自检页；pet.js 按 mtime 热读取，改前端不用重启宿主；测试基建 `tools/smoke.mjs`(98KB)/`test-host.mjs`/`e2e-agent.mjs`。未见：TTS/ASR、记忆持久化（除布局/道具）、小游戏/成就。

**★ 可直接搬给本地项目（Canvas 2D 图集版大肥鱼）**
1. **表情/装饰/场景/动作四层数据表 + 生命周期**：抄 `assets/pet.js` 的 `MOOD_FACE/PROPS/SCENES/ACTIONS` 与 `act()` 单写者（一个表情+至多一个动作+至多一特效、override 带 TTL 自动过期，不写持久层）——本地没有表情包系统，这一套表 + 菜单四页能直接落成「图集换图 + 道具叠加」。
2. **工具→表情映射两张表**：前端 `TOOL_REACT`/`TOOL_LINE`（pet.js:339-456）+ 宿主 `TOOL_LABELS`（lib/index.js:107-135），加新工具只需加一行；本地已有情绪状态机，把 state 名对齐 `mood` 即可接 agent 工具调用。
3. **气泡长度约束**：`buffer>4000 保留末尾`+`.dshp-body max-height:150px`+stream 累加（pet.js:2519-2560），以及「工作气泡 workHold 优先级高于互动气泡」——本地流式对话气泡直接照抄这几个常量。
4. **事件桥协议**：SSE 首帧 `{t:'hello',status}`，后续 `turn-start/step-start/delta(kind:'text'|'reasoning')/tool-call(label,args)/tool-result(error)/assistant(usage)/turn-end(ms,tokens,amount)`（lib/index.js:565-846），前端 `handleEvent()` 一函数收口（pet.js:4343+）——本地进程内直接 function call 也行，事件名照搬即可复用整张反应表。

---
来源仓库：https://github.com/Andersen216/dsh-whale-girl-live2d（branch main，v0.4.6）。已读原文：README.md、package.json、cordis.patch.yml、lib/index.js(1175 行)、assets/pet.js(5021 行)、skill/SKILL.md、docs/作者按键表-对照.md、assets/model/manifest.json。
