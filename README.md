# 大肥鱼 · 情绪陪伴 AI（M1 可运行骨架）

一个"有自己的情绪"的网页陪伴 AI：**一个角色（大肥鱼）＋ 一套情绪状态机 ＋ 一套内容层对话 ＋ 一套人设包**。

情绪不是靠措辞装出来的，而是一个**有惯性的状态变量**，实时驱动表情、动作、界面配色、打字速度和语音语调。

## 快速开始

双击 `start.bat`（或在目录里 `node server.js`），浏览器打开：

**http://127.0.0.1:5173/whale.html**

> 必须用 http 打开。直接双击 html（file://）会因为跨域读不到素材。
> 换一台机器才需要配 key：把 `config.local.example.json` 复制成 `config.local.json` 填上（见下文「接上真模型」）；当前这台已经填好，双击就能聊。
> 以后想换 key（比如这把泄露了）：双击 **`换key.bat`** 粘一次新的就行，只动 `config.local.json` 一个文件，其他都不用改。

## 先看效果

- `whale-hero.png`：聊天场景——右边是对话记录，气泡与配色跟着情绪走，右上角是 token 用量 / 花费卡，右下角刚弹出一张表情包
- `assets/stickers/default/preview.png`：14 张表情包总览
- `whale-moods.png`：十种情绪对照表（平静/开心/兴奋/害羞/低落/委屈/烦躁/生气/惊讶/无聊）
- `whale-panel.png`：情绪面板（强度、好感度、效价/唤醒、情绪罗盘、时间线）

## 现在能玩到什么

| 能力 | 状态 |
| --- | --- |
| 角色渲染（原画图集 + 程序化骨骼，即"伪 Live2D"） | 已完成 |
| 聊天界面（气泡配色跟随情绪、右侧对话记录） | 已完成 |
| 对话内容层（真答问题：名字/时间/算数/笑话/安慰/聊代码，带记忆） | 已完成 |
| 情绪状态机（惯性 / 强度叠加 / 自然衰减 / 好感度） | 已完成 |
| 情绪 → 动作与表情（10 种，见下表） | 已完成 |
| 情绪 → 界面（主色、光晕、情绪罗盘、时间线） | 已完成 |
| 情绪 → 行为（打字速度、语音语速音调、回复长短） | 已完成 |
| 待机小动作 / 拖拽 / 摸摸 / 喂鱼 / 睡觉 | 已完成 |
| 语音输入（浏览器原生识别，Chrome/Edge） | 可用 |
| 语音输出（系统 TTS 占位，**不是你的音色**） | 占位 |
| 你自己的音色（声音克隆） | 待做（M2） |
| 真 LLM 驱动自由对话（DeepSeek，**流式**逐字上屏） | 已完成（key 放 config.local.json） |
| 本地兜底（断网/没 key 时用内容层 + 台词库继续聊） | 已完成 |
| Token 用量 / 花费实时显示（真实 usage 记账 + 字数估算，累计存浏览器） | 已完成 |
| **回复长度双保险**（提示词动态上限 + 代码侧硬截断 + 超两句拆气泡） | 已完成 |
| **表情包**（14 张 webp，模型可主动发 / 概率自动补 / 🎨面板手动发） | 已完成 |
| **动作三层**（常驻 base / 临时 override 带 TTL / 道具与视线层 + 2s 看门狗） | 已完成 |
| **四区记忆**（固定 / 滚动摘要 / 最近详细 / 归档，存在浏览器，注入提示词） | 已完成 |
| **DSH 工作状态联动**（读 DSH 会话日志 → 她在敲键盘/写文件/出错/收工） | 已完成（默认关，点 🖥️ 打开） |
| **气泡调度**（队列 + 优先级 + 去重 + 夜间静默 + 工作态冷却） | 已完成 |

## 目录结构

```
live2d-companion/
├─ whale.html     页面（角色舞台 + 顶栏 + 气泡 + 输入条 + 情绪面板 + 对话记录）
├─ whale.css      界面样式（主色 --c 由情绪驱动）
├─ js/
│   ├─ whale-render.js  图集渲染器 WhaleRig（动作时间轴 / 姿势 / 呼吸眨眼 / 拖拽 / 口型）
│   ├─ whale-app.js     接线层：情绪编排、气泡打字机、面板、语音、交互
│   ├─ whale-talk.js    ★ 内容层对话引擎（认意图 → 真回答，带记忆；不接 LLM 也能聊）
│   ├─ moods.js         ★ 情绪数据与状态机（公共层，换角色也能用）
│   ├─ whale-memory.js  ★ 四区记忆（固定/滚动摘要/最近详细/归档，存 localStorage）
│   ├─ whale-stickers.js ★ 表情包加载、目录文本、校验、按情绪/场景挑图
│   ├─ whale-dsh.js     ★ DSH 状态读取器的前端（700ms 轮询 / 消抖 / 意图映射）
│   └─ whale-usage.js   ★ token 用量与花费账本（真实 usage 记账 / 字数估算 / localStorage 累计）
├─ persona/       ★ 大肥鱼人设包
│   ├─ persona.json      结构化人设卡（性格/口头禅/情绪规则/示例对话）
│   ├─ system-prompt.md  LLM 用的人设提示词（含 JSON 输出协议）
│   ├─ lines.json        情绪台词库（10 情绪 × 8~10 句 + 系统场景台词）
│   └─ 大肥鱼.persona.yaml  可读版人设卡（附署名与许可）
├─ assets/whale/  ★ 素材：rig.json + 图集 png（原画来自 YunYueSama/codex-deepseek-pet）
├─ assets/stickers/default/  ★ 14 张表情包 webp + manifest.json + preview.png
├─ docs/live2d-rig-guide.md  ★ 把大肥鱼做成"真 Live2D 模型"的制作包
├─ docs/升级方案-2026-10-27.md  这一版照着做的方案（对照 11 个 GitHub 仓库）
├─ CREDITS.md     素材署名与许可（务必保留）
├─ config.js      ★ 所有可调项：人设路径 / LLM / 语音 / 取景 / 情绪参数 / 单价
├─ config.local.json         你自己的 key 与模型（不进仓库、不对外提供）
├─ config.local.example.json 上面那份的占位模板
├─ server.js      静态服务器 + LLM 代理（key 留在服务端；/api/chat 支持流式 SSE）
├─ start.bat      Windows 一键启动
├─ 换key.bat      换 key / 检查 key（粘一次新 key，先联网验证再写入）
├─ tools/set-key.js  上面那个 bat 的实现（命令行也能直接用）
├─ tools/verify-stickers.mjs  表情包校验（尺寸/字节/重复 id/多余文件）
├─ tools/test-dsh-state.mjs   /api/dsh/state 自测（含路径穿越负向用例）
├─ CHANGELOG.md   这一版改了什么
├─ .gitignore     排除 config.local.json 等本地私密文件
└─ whale-*.png    三张效果图
```

## 四个关键概念（整套东西的核心）

**1. 情绪是状态，不是台词。**
妹妹被夸会害羞，不是"挑一句害羞的台词"，而是 强度 +1.4、valence 上升、持续若干秒，
期间表情、配色、打字速度、动作都跟着变。情绪还带**惯性**（新强度 = 旧强度 × 0.55 + 触发强度）和**自然衰减**。

**2. 情绪必须驱动行为，否则就是假的。**
只改表情=换脸；情绪同时驱动：说多快（打字速度）、说多长、播哪段动作、界面主色、语音语速音调、以及"要不要理你"。

**3. 内容层和情绪层是两件事。**
内容层回答"你说的这件事"，情绪层决定"她用什么状态回答"。缺了内容层，就会出现
"问什么都在撒娇"的答非所问（见下面专门一节）。

**4. 人设写在数据里，不写在代码里。**
性格、口头禅、情绪规则、示例对话都在 `persona/`；改性格不用改一行代码。

## 大肥鱼是怎么做出来的（伪 Live2D 路线）

原项目（`codex-deepseek-pet`）给的是**按动作分文件的多帧原画**，不是 Live2D 模型。
真 .moc3 只能由 Cubism Editor 产出，所以这里走"伪 Live2D"：同一套原画 + 时间轴 + 程序化骨架，
对外接口与真模型一致（`play / pose / idle / speaking`）。

### 素材层：一张图 → 一格

`assets/whale/rig.json` 记录每张图集的格子规格与脚底锚点，渲染器只靠它取图：

| 图集 | 尺寸 | 网格 | 用途 |
| --- | --- | --- | --- |
| idle-front | 2048×1024 | 2×1 格 1024 | 站立 / 闭眼（眨眼用） |
| actions | 2048×2048 | 4×4 格 512 | 16 个姿势 |
| expressions | 2048×2048 | 4×4 格 512 | 16 个表情 |
| dense-idle/wave/eat/jump/dance/sleep/sneak | 2048×4096 | 4×8 格 512 | 动作序列（奇偶帧=原帧+补间） |
| motion-turn | 2048×1024 | 4×2 格 512 | 转身 |
| story-hum / story-token | 1536×3072 | 4×8 格 384 | 哼歌 / 啃小鱼干 |

所有帧脚底统一在格子高度 92.97% 处、水平居中——所以渲染只要按"格子底部对齐"就能换图不跳。

### 动作层：情绪 → 播什么

`moods.js` 里每个情绪配一个 `act`（播哪段动作 + 停在哪个姿势 + 停多久）：

| 情绪 | 动作编排 |
| --- | --- |
| 开心 happy | 挥手 → 微笑 |
| 兴奋 excited | 跳舞（循环一次）→ 兴奋姿势 |
| 害羞 shy | 转身 → 转回 → 手放胸前 |
| 生气 angry | 转身 → 背对鼓腮（不理你） |
| 烦躁 annoyed | 转身 → 背对 → 转回 |
| 惊讶 surprised | 跳一下 → 瞪眼 |
| 低落 sad / 委屈 hurt | 站着低头，停更久 |
| 无聊 bored | 坐在地上冒泡 |
| 平静 calm | 站立待机 + 呼吸 + 随机眨眼 |

"活着的感觉"来自渲染层的持续小动作：呼吸（sin 缩放）、随机眨眼、轻微摇晃、
落地挤压回弹、说话时高频抖动，以及每 3.5~7.5 秒按权重抽一次的随机小动作（张望/表情/嘟囔/饿了/赌气，见上面「动作三层」）。

### 人设层：`persona/` 四件套

| 文件 | 内容 |
| --- | --- |
| `persona.json` | 结构化人设卡：身份、外貌、6 条性格、8 句口头禅、12 条情绪规则、10 个情绪的对应动作、8 组示例对话 |
| `system-prompt.md` | 接真 LLM 时直接当 system 提示词（含 `{"say","mood":{...}}` 的 JSON 输出协议） |
| `lines.json` | 离线台词库：10 情绪 × 8~10 句 + 系统场景（打招呼/被夸/被凶/喂食/待机/思考…） |
| `大肥鱼.persona.yaml` | 给人看的可读版（含性格反例、署名与许可说明） |

**想让性格变，改这里就够了**，代码一行都不用动。

### 内容层：听懂你在问什么

第一版只有情绪层：`classify()` 判断"这句话让她产生什么情绪"，然后从情绪台词池里挑一句。
问"你叫什么名字"时，情绪层给出"平静"，台词池随手给一句"我、我先把头低一会儿"——
语法没错、情绪没错，**就是没回答问题**。

现在补上了 `js/whale-talk.js`（零依赖）：

| 层 | 干什么 | 文件 |
| --- | --- | --- |
| 内容层 | 认意图 → 回答你问的那件事；带记忆（名字/上一轮话题） | `js/whale-talk.js` |
| 情绪层 | 这句话让她不爽/害羞/开心 → 强度累积、表情、动作、配色 | `js/moods.js` |
| 表演层 | 情绪 → 播哪段图集动作、要不要续期姿势 | `js/whale-render.js` |
| 人设层 | 她是谁、怎么说话（接 LLM 时用） | `persona/` |

能真答的：自我介绍 / 记住"我叫X"并下次叫你 / 现在几点、几号、周几（读真实时钟）/
多步算数（先乘除后加减）/ 讲笑话 / 唱歌（配 `hum` 动作）/ 你难过时先共情 /
问代码报错给排查方向 / "这个需求你怎么看"会抓着话题主体回答 / 无聊、敷衍、道谢、道歉、再见。
答不出来就老实说"这个我不太懂"，不硬编。

**加一条新意图**只要在 `whale-talk.js` 的 `INTENTS` 数组里加一项（正则 + 台词函数），顺序即优先级：

```js
{ id: 'recommend', re: /(推荐|安利)(个|一个)?(电影|番|游戏)/,
  mood: 'happy',
  say: function () { return ['先把手上的活干完，我就告诉你。', '《海底两万里》，看完再找我。']; } },
```

## 调试网址参数

```
whale.html?mood=angry&i=4       直接进入某情绪（强度 1~5）
whale.html?u=你好呀             自动发一句话
whale.html?say=你叫什么|现在几点  一次跑多轮，检查"答得对不对"
whale.html?panel=1              默认打开情绪面板
whale.html?manual=1             用 setInterval 驱动（无头截图/录屏用）
whale.html?freeze=1&fr=150      第 150 帧把画面冻结成静态图（配合截图）
whale.html?hold=1               气泡常亮（演示/截图）
whale.html?chromeless=1         隐藏所有 UI，只看角色
whale.html?diag=1               自检报告写进标题与页面（含 llm 成功/失败、首字耗时、增量次数）
whale.html?notmo=1              关掉请求超时（无头浏览器 --virtual-time-budget 调试用，正常别加）
whale.html?dsh=1                打开「DSH 工作状态联动」（= 点顶栏 🖥️）；?dsh=0 强制关
whale.html?ch=0.8&fx=0.5&fy=0.94  实时调取景（角色占比/水平/脚底位置）
```

## Token 用量与花费（右上角 🪙）

顶栏那个 🪙 按钮开关右上角的用量卡。它**不发额外请求**，数据全部来自这一轮对话本来就会拿到的 `usage`。

- **本轮**：这次对话的输入 / 输出 / 合计 token、命中缓存的 token、这一轮花了多少钱、耗时。
- **累计**：打开页面以来一共聊了几轮、多少 token、多少钱（存 `localStorage`，刷新不丢；点「清零」归零）。
- 数字前带 `≈` 表示**估算**：上游没回 `usage` 时按字数估（中文 0.62 token/字、其他 0.30），下次拿到真实值会自动校准系数。
- 输入里「命中」那部分是**缓存命中**，只按 ¥0.2 / 百万计费（未命中 ¥2、输出 ¥3）。同一段人设提示词聊得越多越便宜——截图那次 1,348 个输入 token 有 1,152 个命中，一轮只要 ¥0.0009。

单价、币种、显不显示都在 `config.js`：

```js
cost: {
  show: true,               // 关掉就隐藏用量卡
  currency: "¥",
  prices: {
    "deepseek-flash":  { input: 2,  output: 3,  cacheHit: 0.2 },  // 元 / 百万 token
    "deepseek-v4-pro": { input: 4,  output: 16, cacheHit: 0.4 }   // 占位，按实际价改
  },
  fallback: { input: 2, output: 3, cacheHit: 0.2 }
}
```

> 真实 `usage` 是靠服务端请求时带 `stream_options.include_usage: true` 拿到的（见 `server.js`），流式响应的最后一块里就有。服务端日志也会打一行，方便核对：
> `[llm] stream deepseek-flash 首字节 187ms, 共 6656B, 1516ms, token in=47 out=45`

## 这一版新加的六件事（P0/P1 全部落地）

| 项 | 一句话 | 关键文件 |
| --- | --- | --- |
| P0-1 回复长度双保险 | 提示词给上限 + 代码硬截断 + 超两句拆气泡 | `js/whale-app.js` |
| P0-2 表情包 | 14 张 webp，模型能主动发，也会按情绪自动补 | `assets/stickers/`、`js/whale-stickers.js` |
| P0-3 动作三层 | 常驻表情 / 临时动作 / 道具视线分层，谁也别抢谁 | `js/whale-render.js` |
| P1-1 四区记忆 | 记住你是谁、在做什么，只把摘要塞进提示词 | `js/whale-memory.js` |
| P1-2 DSH 状态联动 | 你在 DSH 里干活，她在旁边跟着演 | `server.js`、`js/whale-dsh.js` |
| P1-3 气泡调度 | 回复 > 互动 > 闲话，闲话会被夜间静默和冷却挡掉 | `js/whale-app.js` |

### 1. 回复长度双保险（P0-1）

只靠提示词写「说短点」是管不住的（实测会有 100+ 字的客服腔），所以做了两道闸：

1. **提示词动态给上限**：`buildPrompt()` = 静态人设（利于命中缓存）+ 记忆摘要 + 表情包目录 + **本轮硬规矩**。
   硬规矩永远放在最后一条，因为靠后的指令更管用；上限取 `min(按情绪, 按场景)`：

   | 情况 | 上限 |
   | --- | --- |
   | 兴奋 excited | 60 字 |
   | 平静 calm / 开心 happy | 36 / 44 字 |
   | 难过·委屈·生气 | 26 / 26 / 30 字 |
   | 你只发了一两个字（「嗯」「在吗」） | 16 字 |
   | 深夜（23:00–5:59） | 26 字 |

2. **代码侧硬截断**：`clampSay()` 超上限就截到最近的句末标点并补「…」；`splitForBubbles()` 超过两句就拆成两条气泡，
   间隔 700ms 先后出来——像真人打字，而不是一段小作文怼脸上。流式输出时也是边收边截，气泡不会越撑越高。

实测三轮：`11 字 / 15 字 / 10 字`；单元测试 `clampSay(40 字话, 24)` → `我跟你讲啊这个事情其实特别复杂。…`。

所有阈值都在 `config.js` 的 `reply` 块里（`maxChars` / `byMood` / `byScene` / `banlist`），AI 味黑名单命中会打 warn。

### 2. 表情包（P0-2）

`assets/stickers/default/` 里 14 张 300px 高的 webp（合计 393.8KB）：干得好 / 谢谢 / 收到 / 好耶 / 害羞 / 嗯？ / 哼 /
生气 / 低落 / 求安慰 / 困了 / 饿了 / 想想 / 无聊。每张在 `manifest.json` 里有 `name`、`meaning`（什么时候该发）、
`tags`、`mood[]`、`scene[]`、`weight`。

三条触发路径：

1. **模型主动发**：提示词里塞一份不超过 120 行的目录（`· id｜名字｜meaning（tags）`），模型想发就在 JSON 里给
   `"sticker":"nice-work"`，代码会 `validate()` 只认目录里的 id——乱编的 id 直接丢掉，不会变成破图；
2. **自动补一张**：模型没发时，按 `autoChance`（默认 0.34）和当前情绪/场景挑一张，带冷却（`cooldownTurns` × 9s）、
   一轮最多一张；
3. **手动发**：顶栏 🎨 打开表情包面板，点哪张发哪张。

发出来的图有两个落点：右下角弹一下（`#stickerPop`，3.2s），以及对话记录里留一张（刷新前都能回看）。

校验：`node tools/verify-stickers.mjs` → `✅ 14/14 stickers ok`（会查真实 webp 头里的宽高、字节数、重复 id、
目录里没登记的图片）。实测三轮对话里发了 2 张，不刷屏。

### 3. 动作三层（P0-3）

以前是「播一段动作 → onEnd 回到 idle」，多件事一起来就会打架（情绪想低头、动作刚播到一半、道具还在飘）。
现在拆成三层，各有各的所有权：

| 层 | 谁写 | 什么时候结束 | 例子 |
| --- | --- | --- | --- |
| **base**（常驻） | 情绪 | 一直存在，情绪变了才换 | 平静站着 / 害羞捂脸 / 生气鼓腮 |
| **override**（临时） | 动作 | TTL 到期 or 被更高优先级顶掉 | 挥手、吃东西、跳舞、睡觉 |
| **props**（道具） | 情绪/互动 | 自己的 ttl | 头顶飘 ✨💢💤🐟 |
| **gaze**（视线） | 鼠标 | 缓动跟随 | 眼睛往你看的方向偏一点 |

配套三条硬规矩：

- **单写者**：同一时刻只有一个 override，低优先级抢不到就记进 `conflicts`（不排队、不打群架）；
- **看门狗**：override 存在但 2 秒没人动它 → 直接把控制权还给 base（防止某个动作把画面永久占住）；
- **IDLE_TABLE**：发呆时按权重抽小动作（张望 46 / 表情 28 / 嘟囔 22 / 饿了 4 / 赌气 2），3.5~7.5 秒一次。

调试：`window.__whale.rig.debugInfo()` 能看到 `base / override(剩余ms) / props / conflicts`。

### 4. 四区记忆（P1-1）

`js/whale-memory.js`，存在 `localStorage`（key `whale.mem.v2`），四个区：

| 区 | 装什么 | 上限 |
| --- | --- | --- |
| 固定 | 你的名字、喜好、在做的事 | 8 条 |
| 滚动摘要 | 每轮压缩一句「谁说了什么」 | 80 条 FIFO |
| 最近详细 | 最近 5 轮原话 | 5 条 |
| 归档 | 被挤出去的老摘要缩成一行索引 | 不限 |

总字数超 16000 时按「最旧摘要 → 详细区 → 固定区」的顺序丢。

**只把摘要段塞进提示词**（`promptSection()`，≤1200 字，形如「【你记得的事】- 用户叫阿伟 / - 最近聊到：…」），
不塞原话——否则每轮 prompt 都会膨胀，还会把缓存命中打没。

抽取规则（正则，不花钱）：`我叫X` / `你可以叫我X` / `我在做X` / `我喜欢X` / `我讨厌X` / `记住X`。

实测：说一次「我叫阿伟」→ 之后每轮 prompt 都带记忆段，她会回「晚安阿伟，睡个好觉。」；刷新页面记忆还在（localStorage）。

> 好感度**不进提示词**，只在代码里当硬约束（高了更亲近、低了更冷淡）。写进提示词就变成了「她被告知该喜欢你」，反而假。

### 5. DSH 工作状态联动（P1-2）

让她知道你在 DSH（DeepSeek Harness）里干什么：

1. `server.js` 新增 `GET /api/dsh/state`：扫 `%USERPROFILE%\.dsh\sessions\**\session.v4.jsonl.zstd`，
   取最新会话，从**文件尾部**按 zstd 帧头（`28 B5 2F FD`）找完整帧解压，只解尾部够用的几帧（增量读，几百微秒级），
   推导出扁平状态（`status` / `toolName` / `toolKind` / `lastCommand` / `lastFile` / `toolCount` / `waitingApproval` / `todos`），500ms 缓存；
2. `js/whale-dsh.js` 700ms 轮询，300ms 消抖，状态消失后保持 4s，映射成意图：
   `shell|write|read → 敲键盘`、`web → 张望`、`plan → 得意`、`error → 炸毛`、`done → 星星眼`、`waiting → 惊`；
3. 优先级 `waiting > error > done > tool_* > thinking > idle`，动作走 override 层（4s TTL，自动回 base）。

**默认是关的**（`config.js` 的 `dsh.enabled`），点顶栏 🖥️ 打开，或加 `?dsh=1`；读不到会话文件就静默，不会报错、
不影响聊天。只读本地文件，不外传。

自测：`node tools/test-dsh-state.mjs`（含路径穿越 `../../server.js` 之类负向用例）。

### 6. 气泡调度（P1-3）

同一时刻只该说一句话，所以气泡改成队列：

- **优先级**：正式回复 30 > 互动反应 20 > 待机闲话 10/12；
- 回复要出来时直接清空队列（正事优先），闲话要排队且上限 6 条、最近 5 条不重说；
- 闲话过三道闸：**夜间静默**（23:00–5:59，可配）、刚说完话 15s 内不说、DSH 正在干活时冷却放宽到 90s；
- 每条台词绑自己的气泡时长（`hold`），不再统一 5.2s。

因此现在的节奏是：聊得越多她话越少，你在忙她基本不吵，夜里她只回嘴不主动搭话。

## 换成你自己的形象

大肥鱼的形象素材来自 `YunYueSama/codex-deepseek-pet`（见 CREDITS）。要换成你自己的角色，素材层这样换：

1. 把你的帧动画做成**同样风格的图集**（一张大图切网格，帧内脚底对齐、水平居中）；
2. 写一份新的 `rig.json`：`{ atlas: { 名字: { file, cell, cols, rows, bbox } } }`；
3. 在 `whale-render.js` 的 `CLIPS`（动作帧序列）和 `POSES`（姿势/表情单帧）里指向新图集；
4. 改 `config.js` 的 `whale.name` 与 `persona/` 四件套；情绪表 `moods.js` 一般不用动。

## 接上真模型（已经接好了；换 key / 换模型只改一个文件）

调用链是 **网页 → `server.js` 的 `/api/chat` 代理 → DeepSeek**。代理存在的意义有两个：
key 只留在服务端（不会出现在网页源码里），顺便绕开浏览器跨域。

### 1. 填 key

复制 `config.local.example.json` 为 `config.local.json`，填自己的 key：

```json
{
  "apiKey": "sk-...",
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-flash",
  "thinking": "off",
  "json": true,
  "maxTokens": 400,
  "timeoutMs": 20000
}
```

这个文件**每个请求都会重读**：改 key / 换模型 / 调温度都不用重启服务，刷新网页就生效。
`server.js` 启动时那行 `LLM: 已接入 deepseek-flash` 只是当时的快照。

### 2. 选模型（同一句话实测）

| 模型 | 第一个字 | 整句说完 | 说明 |
| --- | --- | --- | --- |
| `deepseek-flash` | ~0.5~0.7s | 0.8~1.5s | **默认推荐**，快，够会聊 |
| `deepseek-v4-pro` | ~1s | 2~3s | 更细腻，但慢一倍左右，长聊可用 |

（浏览器里实测：请求发出 0.17s 收到响应头 → 0.62s 第一个正文 token → 0.70s 气泡出现第一个字 → 0.78s 整句说完。
人设提示词 2288 字 / 约 1380 token，提示词越长首字越慢。）

> 老配置里写的 `deepseek-chat` 在这个账号上**不存在**（会 400）。可用的就上面两个，
> 用 `curl https://api.deepseek.com/models -H "Authorization: Bearer sk-..."` 能自己核对。

### 3. 流式输出（默认开启）

- **服务端**：把上游的 SSE 原样透传（`Content-Type: text/event-stream`），不攒完整包，
  所以模型吐第一个字，浏览器就收到了（服务端日志 `[llm] stream … 首字节 240ms` 是响应头到达，
  模型真正吐出第一个正文 token 再花约 0.4s）；
- **前端**：`askLLMStream()` 一边收一边解析**半截 JSON**，`extractSay()` 用正则把已经到达的
  `say` 文本实时写进气泡；等整包收完，再按 `mood` 切情绪、播动作、开口型；
- 想关掉：`config.js` 里设 `llm.stream: false`，退回一次性返回（回复会先顿一下再整段出现）。

### 4. 两个兜底（都实测踩过坑）

1. **上游嫌 `response_format` 不合法（400）** → 去掉 JSON 约束重试一次；
2. **模型偶发"沉默"**：HTTP 200、`finish_reason: stop`，但 `content` 只有一串空格。
   这种情况同一份请求重发还是沉默，所以必须**换问法**：去掉 JSON 约束 + 追一条
   「上一条回复是空的，现在必须开口」的 system 消息再问。流式里一个正文字都没收到时，
   会自动退回非流式走这套重试；还不行才回落本地台词。

### 5. 人设怎么进模型

`persona/system-prompt.md` 全文当 system 提示词，要求模型输出：

```json
{"say": "要说的话", "mood": {"label": "calm", "intensity": 2, "valence": 0, "arousal": 0.3, "cause": "被夸了"}}
```

模型负责"说什么 + 这一句的情绪倾向"，状态机负责"情绪怎么累积、动作怎么演"。
`label` 不在十种情绪里时（实测出现过 `empathetic`），按 valence/arousal 就近映射到最接近的一种。
没填 key、断网、超时，都会自动回落内容层 + 台词库，照样能聊。

### 6. 自己验证代理

```bash
curl -N -X POST http://127.0.0.1:5173/api/chat \
  -H "Content-Type: application/json" \
  -d '{"stream":true,"messages":[{"role":"user","content":"你好"}]}'
```

看到一串 `data: {…}` 就是流式正常；`/config.local.json` 直接访问是 404（私密文件拦截）。

### 7. 换 key / 检查 key（key 泄露了就走这一步）

**只需要动 `config.local.json` 一个文件**：网页、代理、人设、模型参数都不用碰，也不用手动重启（代理每个请求都重读它）。

双击 **`换key.bat`**：

1. 脚本先打开 https://platform.deepseek.com/api_keys ，点 `Create new API key` 生成新的；
2. 回到窗口把新 key 粘进去（**不回显**，只显示 `*`）；
3. 脚本先用一次 1 token 的请求验证它真能用，**通过了才写入**——401（无效）、超时、断网都不会写，服务不会因为你粘错而挂掉；
4. 写完网页刷新即生效。收尾：回控制台把旧 key 删掉。

不想双击也行，命令行等价：

```bash
node tools/set-key.js            # 交互式换 key（隐藏输入 + 联网验证 + 原子写入）
node tools/set-key.js --check    # 只检查现在的 key 还能不能用，不动任何文件
node tools/set-key.js --env      # 从环境变量 DEEPSEEK_API_KEY 读（自动化用）
```

几条已经做好的保护：

- key 只存 `config.local.json`，**不在网页源码里**（网页一律走 `/api/chat` 代理），服务端日志和自检报告里也只会出现打码指纹（`sk-…5748`）；
- 静态服务器会拦截 `/config.local.json`（直接访问 404），别人开你的 5173 端口也拿不到；
- `.gitignore` 已排除 `config.local.json` / `*.local.json`，将来 `git init` 不会误提交；
- `--check` 打印打码指纹，用来确认"现在跑的是哪一把"；换完想核对，`node tools/set-key.js --check` 一次就知道。

## 换成自己的声音（M2，无需 GPU）

`config.js` 的 `tts` 有两种模式：

```js
tts: { enabled: true, mode: "system" }                       // 浏览器系统 TTS，占位
tts: { enabled: true, mode: "http", url: "http://127.0.0.1:9880/tts" }  // 转发到你的 TTS 服务
```

`http` 模式会 POST `{ text, mood, rate, pitch }` 拿回音频流直接播——所以只要起一个本地 TTS 服务，
前端一行不用改。**没有 GPU 的情况下，音色克隆建议走云端**：MiniMax、火山引擎声音复刻、阿里 CosyVoice，
延迟通常 < 1s，能撑实时对话；本地 GPT-SoVITS 在 CPU 上太慢。

## 想升级成真 Live2D

`docs/live2d-rig-guide.md` 是完整制作包：分层 PSD 清单、参数表、10 个表情的 exp3 配方、
Cubism Editor 的 9 步流程、以及"做出来之后怎么接回本项目"（写一个同接口的 `Live2DRig` 替换图集渲染器，
情绪引擎和人设不用动）。

## 下一步路线

- **M2 语音**：录音 → ASR（浏览器原生 / faster-whisper）→ 回复 → 自己的音色 TTS → 口型同步；支持打断
- **M3 记忆**：四区长期记忆**已做**（见上面第 4 节）；剩下情绪面板的历史曲线（现在只有罗盘 + 时间线）、跨设备同步
- **M4 更真**：真 Live2D 模型、情绪 TTS（同一句话不同情绪不同语气）、文本 bot 适配器（QQ/飞书等）

## 署名

形象素材与人设的二创规则见 `CREDITS.md`：原画来自 `YunYueSama/codex-deepseek-pet`，
需保留署名并说明修改。当前项目**零第三方运行库**（纯 Canvas 2D）。
