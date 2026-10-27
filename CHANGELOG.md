# 更新记录

格式：日期 · 版本 · 一句话。每条下面写「改了什么 / 怎么验证的 / 怎么关掉」。

## 2026-10-27 · v0.3 · P0/P1 全部落地（这一版）

六件事：回复长度双保险、表情包、动作三层、四区记忆、DSH 工作状态联动、气泡调度。
另有流式输出收尾与 token 花费卡在前一版已完成。

### 1. 回复长度双保险（P0-1）
- `buildPrompt()` 重组为：静态人设 → 记忆摘要 → 表情包目录 → **本轮硬规矩**（放最后，指令权重更高）。
- 动态上限 `currentLimit(mood, text)`：取按情绪、按场景的较小值；兴奋 60 / 开心 44 / 平静 36 / 难过 26 / 委屈 26 /
  生气 30 / 你只发两三个字 16 / 深夜 26。
- `clampSay()` 超限截到最近句末并补「…」；`splitForBubbles()` 超两句拆两条气泡（间隔 700ms）。流式时边收边截。
- 验证：CDP 真 LLM 三轮回复 11 / 15 / 10 字；单测 `clampSay(40 字, 24)` → `我跟你讲啊这个事情其实特别复杂。…`（cut=true）。
- 关掉：`config.js` → `reply.enabled=false`。

### 2. 表情包（P0-2）
- 新增 `assets/stickers/default/`：14 张 300px webp（393.8KB）+ `manifest.json`（id / name / meaning / tags / mood / scene / weight）+ `preview.png`。
- 新增 `js/whale-stickers.js`：load / all / byId / validate / pickFor / catalogText / count。
- 三条触发路径：模型在 JSON 里给 `sticker` 字段（`validate()` 只认目录内 id）；`autoChance=0.34` 概率自动补（带冷却）；顶栏 🎨 面板手动发。
- 落点：右下 `#stickerPop` 弹 3.2s；对话记录里留一张（`.msg.sticker`）。气泡可带图（`.bubble.has-img`）。
- 新增 `tools/verify-stickers.mjs`：查 webp 真实宽高/字节/重复 id/目录未登记文件 → `✅ 14/14 ok`。
- 验证：三轮真 LLM 对话触发 2 张；catalogText 已进 prompt。

### 3. 动作三层（P0-3）
- `js/whale-render.js` 重构为四层：**base**（情绪常驻）/ **override**（动作，带 TTL 与优先级）/ **props**（头顶道具）/ **gaze**（视线跟随鼠标）。
- 单写者模型：同时只允许一个 override，低优先级记入 `conflicts`；**2 秒看门狗**无人续期就把控制权交还 base。
- 待机抽签 `IDLE_TABLE`：张望 46 / 表情 28 / 嘟囔 22 / 饿了 4 / 赌气 2，每 3.5~7.5 秒一次。
- 交互改为走三层：点头像→害羞/恼 + wave；喂食→eat + 🐟 道具；睡觉/唤醒→sleep/wake 带长 TTL。
- 调试：`window.__whale.rig.debugInfo()` 看 base / override 剩余 / props / conflicts。

### 4. 四区记忆（P1-1）
- 新增 `js/whale-memory.js`，localStorage key `whale.mem.v2`：固定（8）/ 滚动摘要（80 FIFO）/ 最近详细（5）/ 归档（不限）。
- 总字数 16000 上限，超了按「最旧摘要 → 详细区 → 固定区」丢；只把 `promptSection()`（≤1200 字）注入提示词。
- 抽取规则（正则、不花钱）：我叫X / 你可以叫我X / 我在做X / 我喜欢X / 我讨厌X / 记住X。每 10s flush 一次。
- 好感度**故意不进提示词**，仍只当代码硬约束。
- 验证：说「我叫阿伟」→ 后续 prompt 均含记忆段，回复「晚安阿伟，睡个好觉。」；刷新页面记忆仍在。

### 5. DSH 工作状态联动（P1-2）
- `server.js` 新增 `GET /api/dsh/state`：读 `%USERPROFILE%\.dsh\sessions\**\session.v4.jsonl.zstd`，从尾部按 zstd 帧头
  `28 B5 2F FD` 找完整帧增量解压，推导 `status / toolName / toolKind / lastCommand / lastFile / toolCount / waitingApproval / todos`，500ms 缓存。
- 新增 `js/whale-dsh.js`：700ms 轮询、300ms 消抖、状态消失保持 4s；意图映射 shell|write|read→敲键盘、web→张望、
  plan→得意、error→炸毛、done→星星眼、waiting→惊；优先级 waiting>error>done>tool_*>thinking>idle；动作走 override 层 4s TTL。
- 默认**关**。打开：顶栏 🖥️，或 `?dsh=1`；`?dsh=0` 强制关；`config.js` 的 `dsh.enabled`。
- 新增 `tools/test-dsh-state.mjs` 自测（含路径穿越负向用例）。
- 验证：实测读到本机会话 `status=tool, toolKind=shell, toolCount=541, todos 0/7`。

### 6. 气泡调度（P1-3）
- 气泡改成队列：正式回复 30 > 互动反应 20 > 待机闲话 10/12；回复出现时清空队列。
- 闲话上限 6 条、最近 5 条不重说；三道闸：夜间静默 23:00–5:59、说完 15s 内不说、DSH 忙时 90s。
- 每条台词自带 `hold` 时长，不再统一 5.2s。

### 7. 其它
- `js/whale-app.js` 新增 `?dsh=1` / `?dsh=0` 参数；`window.__whale` 增导出 `stickers / memory / promptNow / dsh / clamp / split / limit`。
- `whale.html` 顶栏加 🎨（表情包）与 🖥️（DSH）两个按钮，新增 `#stickerPanel`、`#stickerPop` 节点。
- 脚本加载顺序：config → moods → whale-usage → whale-memory → whale-stickers → whale-render → whale-talk → whale-dsh → whale-app。
- README 重写「这一版新加的六件事」整章 + 能力表 + 目录树 + 调试参数。

### 文件清单（本版新增/大改）
```
js/whale-memory.js     新增   7.3KB   四区记忆
js/whale-stickers.js   新增   5.1KB   表情包
js/whale-dsh.js        新增  10.2KB   DSH 状态前端
js/whale-app.js        大改  56.8KB   长度/气泡/贴纸/三层/DSH/参数
js/whale-render.js     大改  19.2KB   四层渲染与看门狗
js/whale-talk.js       改    25.7KB   表情包目录进 prompt、长度规矩
server.js              改    31.0KB   /api/dsh/state、流式与 usage 收尾
whale.html/whale.css   改     4.7/14.2KB  两个按钮、面板、带图气泡
assets/stickers/default/  新增  14 张 webp + manifest + preview（393.8KB）
tools/verify-stickers.mjs / tools/test-dsh-state.mjs  新增  自测脚本
README.md / CHANGELOG.md  改/新增
```

### 已知未做
- 真 Live2D 模型（仍是图集 + 骨骼参数，见 `docs/live2d-rig-guide.md`）；
- 语音（M2：ASR / 自有音色 TTS / 口型）仍只有浏览器 Web Speech 的示意；
- 情绪面板只有罗盘 + 时间线，没有历史曲线/跨设备同步；
- DSH 联动只读本机会话文件，不区分「哪个窗口」。
