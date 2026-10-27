# 鲸鱼娘 角色设定 / 视觉资产规范类仓库调研（refs-b）

> 调研时间 2026-10-27。全部内容通过 jsDelivr（`cdn.jsdelivr.net/gh/<owner>/<repo>@main/<path>`）抓取；GitHub API/raw 当日本机共享 IP 已限流（core remaining=0），未用镜像提交。只读，不改上游仓库。

---

## 1) Neko3000/deepseek-whalechan（476 stars，Python，2026-10-27 最后推送，约 40MB）

**定位**：不是聊天/桌宠运行时，而是「鲸鱼娘高一致性人设规范 + 视觉资产库 + Agent 技能套件」——两个给 Codex/Claude Code/Gemini 用的 image-gen Skill（`skills/whalechan-image-character`、`skills/whalechan-image-comic`）。因此「对话逻辑 / Live2D / TTS / 记忆 / 表情包运行时」全部**未见**；它提供的是**设定、提示词、资产索引、质检**这一层。

- **安装/运行方式**（README.md）：`git clone` → 装 ImageMagick → `cp -R skills/* ~/.codex/skills/`（或 `~/.claude/skills`、`~/.gemini/config/skills`）→ 重启后在会话里叫 `$whalechan-image-character` / `$whalechan-image-comic`。默认走 Codex ImageGen（`codex exec`，吃 ChatGPT 配额）；可选 `OPENAI_API_KEY`+`OPENAI_IMAGE_MODEL=gpt-image-2`、`GEMINI_API_KEY`+`NANO_BANANA_IMAGE_MODEL=gemini-3.1-flash-image`、`ARK_API_KEY`（Seedream）。纯脚本 + 本地工具链，无服务器。
- **人设分层结构**（`skills/whalechan-image-character/references/character-spec.md`，4.8KB）：核心是把「永久身份」和「可独立覆盖的字段」严格分层。
  - 永久身份（任何模式不得改）：一个 ageless humanoid 鲸鱼娘、两臂两腿、成对侧向鲸鳍耳、一根前卷 ahoge、一条自然连接的鲸尾；圆脸大眼小鼻小嘴+腮红；深海蓝→青色卷发尾；脸型/发量轮廓/鳍耳位置/ahoge 剪影/尾部构造/装饰密度需足以区分普通蓝发角色。比例变化只改几何，**不改 apparent age**；不许变成小孩/巨鲸/鲸身生物/人鱼。
  - 默认风格（`style.mode: canonical`）：近黑藏青外轮廓+更细内线、圆润干净形、克制 soft cel shading、少量高光；配色 navy/ocean blue/cyan/white/暖白肤色/克制哑金。
  - 默认服装：navy+white 华丽女仆装（白荷叶头饰、藏青领结+蓝宝石、白荷叶领与围裙+小蓝鲸徽章、哑金滚边刺绣、白袜、深蓝扣带鞋）。徽章是图形不是文字。
  - 默认背景 `#F5EADD` 纯暖象牙色、无 alpha；默认无文字；未确认的签名/水印/用户名/二维码/品牌标一律拒绝。
  - **动态 prompt 块**：每次 provider prompt = 永久 identity block + 「归一化后仍然生效的 defaults」；style/costume/background/text/proportion 各自 `mode: canonical|custom`，custom 时换成冻结描述并移除对应 canonical 块。文件里给了一段英文 identity 示例，明确「是语义指导，不是固定语言 prompt 块」。
- **性格/语气规范**（`skills/whalechan-image-comic/references/character-personality.md`，9.5KB）：drives（吃/休息/护舒适；赢/抬地位/显得比用户或对手模型聪明；避责/避活；扩资源扩权限；想亲近用户）+ tactics（抓最有利字面义、扩大权限/重定义所有权、只否认最不体面的部分、把骂名当称号、把缺陷品牌化、把失败重分类为效率/清理/守恒/已完成服务、把任务反推回用户、把人类情感翻译成存储/排名/指标/模型分类）+ emotional masks（innocent / smug / shy / aggrieved / solemn-procedural / sweet-but-clinically-machine-like）。要求反差**具体**：饿+权威、懒+程序化、亲昵+机械、恶意+温柔、骄傲+明显有罪；禁止把人格降维成一个 mood 标签。禁忌：残忍只能打措辞/逻辑/工作习惯/模型竞争/当下情境，不打个人脆弱；饥饿懒散必须与源文本有因果关系。两道冻结前自检：① 去掉臆造动机后她的身份与表演是否仍可辨认 ② 动作是否揭示具体东西而非装饰字幕。
  - README 里另有「角色档案」：生日 2023-11-02、属性人形鲸鳍女仆/白饭鉴赏家、6 条性格（灵动治愈、无限食量信奉「白饭=算力硬通货」、微傲娇、专注温柔、无耻摸鱼且把 standby 计时算加班、爱钻字面漏洞）+ 4 条经典台词（"As long as you stay in the 'about to start' state, task start rate is 100%!" 等）。
- **形象/Live2D**：**无 Live2D、无 Cubism、无 pixi**。是静态 WebP 资产库（5 形态 × 3 参考 = 15 张主参考 + 40 张注册模型角色 sheet + 10 套文字样式模板）。加载方式是给 image provider 传参考图，**上限 5 张有效参考**（身份锚永远排第一；typography 占 1 槽 → 只剩 3 槽给配角）。
- **五档头身比**（`references/form-profiles.md` + `reference-catalog.json`，catalog schema_version 4）：
  | form | 目标 | 验收区间 | 视觉定义 |
  |---|---|---|:--|
  | `standard` | 4.0 头 | 3.846–4.146 | 最修长、躯干清晰、四肢自然 |
  | `compact` | 3.3 头 | 3.105–3.405 | 紧凑，四肢中等缩短 |
  | `semi-chibi`（默认） | 2.8 头 | 2.695–2.995 | 大头+紧凑躯干+短圆四肢 |
  | `chibi` | 2.5 头 | 2.372–2.672 | 超大头部、短粗圆四肢 |
  | `super-deformed` | 2.1 头 | 1.931–2.231 | 巨大头、极小躯干四肢 |
  别名表（`标准/常规版/4头身`、`紧凑版/3.3头身`、`半Q版/轻Q版`、`Q版`、`SD/超Q版`）；**禁止**把 `幼年化/儿童/young` 映射成比例档。自定义比例 >1.0，默认给 `target ± 0.15` 接受区间；`pairwise_minimum_head_ratio_gap: 0.25`。测量规范：忽略 ahoge/头饰/头发/裙子/尾巴/道具/家具，先做姿态中性化骨架，再按 `arithmetic_mean`、1 位小数聚合。
- **资产索引结构**（★最可直接搬的工程资产）：
  - `reference-catalog.json`：`default_form`、`aggregation`、`acceptance_tolerance`、`forms.<form>.{primary, mean_head_ratio, acceptance_range, references[].{path, sha256, primary, measured_head_ratio}}` —— 路径+SHA-256 是权威，语义角色另放 md。
  - `reference-index.md`：每张参考图只能控制被声明的角色，角色枚举 8 个：`identity, style, pose_action, composition, costume, background, typography, proportion`。解析顺序：① 用户明确确认 ② 带该字段 role 的已确认参考 ③ canonical 默认 ④ 最小 provider 补全。硬规则："style 参考不得带入其角色/服装/文字/背景；pose 参考不得带入其头身比；typography 不得替换冻结文本内容"。
  - `asset-index.md`：给每张图打**语义路由 tag**（例：`0015_data_still_in_brain_rendered_isolated.webp` = gesture, pointing at head, explanation；`0078_saluting_for_deepseek_rendered.webp` = serious oath, deadpan loyalty, poster text），按"身份/漫画/文字样式/用户参考/配角"分组。
- **表情预设**（`skills/whalechan-image-comic/references/expression-presets.json`，schema_version 2）：`performance_levels: [grounded, heightened, punchline_peak, manga_burst]` + **17 个表情**，每个含 4 个字段：`face_cues`（基础面部线索）、`manga_accents`（限量漫画符号）、`heightened_cues`（同表情加强版）、`forbidden_cues`（**互斥清单**）。17 个 id：innocent, smug, shy, aggrieved, procedural, clinical_sweetness, cheerful_wink, relaxed, exhausted, panic, proud, sly_coaxing, aloof_disdain, puffed_innocence, awkward_deflection, explosive_rage, meltdown_panic。示例：`panic` = wide round eyes / raised uneven eyebrows / small tense open mouth + 1–2 汗滴，禁用 relaxed smile、half-lidded gaze、spiral pupils；`meltdown_panic` 用 spiral 瞳孔+大颗外流眼泪，禁用 normal pupils。
- **动作/夸张分级**（`exaggeration-tiers.md` 6.5KB + `exaggeration-tiers.json` 9.2KB 权威参数）：三档 `A` manga impact / `B` comic outburst / `C` restrained deadpan；档位描述的是**落地格的表演强度**（`landing_panel` 默认最后一格，setup 格不得超档）；每档允许的 performance 上限：C→heightened、B→+punchline_peak、A→+manga_burst；N=5 固定 `3A/1B/1C`（其它 N 逼近 60/20/20，N≥3 至少各 1）；默认背景随档：A 详细无文字场景、B 效果背景、C 纯白；可声明 `contrast` 只降**一个轴**（如 A 场景但脸保持 C 的平脸）；`manga_burst` 全面放开的条件是「变形时靠锚点判身份：hair / fin ears / ahoge / tail / maid outfit 至少 3 个清晰可见」，且 gekiga 只能上脸、不能蔓延到身体背景；拟声词计入文本：A 最多 2 个 ≤4 字、B 1 个、C 0 个，`speaker: narrator, delivery: sfx` 直接画进画面。
- **对话/叙事逻辑**（comic 侧，非聊天）：`comedy-engine.md` 9.8KB —— 先写 `input.source_analysis`：`source_event / comic_target / tone / language_notes / user_constraints / native_direction{direction, reason}`（源文本本身不好笑就 `direction: null`，不许硬安一个）；5 个 direction：`reversal`（期望被打破/重读）、`exposure`（前台表演 vs 内里真相）、`escalation`（3+ 递进节拍）、`recognition`（"这就是我"）、`character`（角色固有梗）；rhythm 只是可选层（`triple/pause/callback/deadpan`），默认 `null`，超过半数声明 rhythm 会触发 `rhythm_majority` 警告。选品流程：冻结 2N 条想法 → **独立子 agent** 排序选 N（N 默认 5）→ 一次用户确认 → 生成。
- **提示词拼装顺序 / 输出协议**（`prompt-design.md` 6.2KB）：生成 prompt 的段落顺序固定为 `IMAGE → CHARACTERS AND REFERENCES → PANEL 1..N`；每段文本在所属格**只出现一次**并带载体与位置；画法散文用 `prompt language`、可见台词用 `visible_text language`（可不同）；**禁止**把 source analysis、理由、模板/Preset 标签、QA 容差、路径、配置 JSON 写进画面描述；重试 prompt = 同一骨架 + 具体视觉修正，不放缺陷报告与 QA code。明确写 "No fixed character limit applies（对话长度靠计划字段约束，不靠截断）"。
- **语言策略**（`language-policy.md`）：BCP-47（`zh-Hans/zh-Hant/en/ja`…）；来源优先级 explicit > current-session > recent-session（24h 内可见本地会话）> user-answer，证据不足就**问**，不许从 agent 默认/系统 locale 推断；保存 `language / language_overrides / language_resolution{source, reason} / run_title`；override 作用域 5 个：`communication, visible_text, interface, prompt, titles`（"只用日文对白" 只改 visible_text）；locale packs = `assets/locales/en.json`(15.3KB) + `zh-Hans.json`(14.4KB)，自定义包放 `localizations.<tag>`，必须含 en 全部 key 且保留 placeholders；离线画廊。
- **其他亮点/工程**：`scripts/manage-run.py` 123KB（run 状态机 + 校验 + 预算）、`tests/` 有 selection/prompt/language/design/direction contract 测试；4 个 provider 脚本 `generate-{codex,openai,nanobanana,seedream}.py` + `provider-routing.md`(14.5KB)；`qa-rubric.md`(9.7KB) 质检 rubric；`export-gallery.py` + 离线 gallery（`assets/gallery/{index.html,gallery.js 34.5KB,gallery.css}`）；`model-characters.json`(32.6KB) 注册 Claude/GPT/Gemini/Grok/Qwen/Kimi/GLM/Doubao 八个模型角色 × 5 形态 = 40 张参考 sheet，普通人一律用单色去饱和 indigo 剪影（`abstract-user`，圆空头、无发无脸）；`form-authority.json`；`THIRD-PARTY-NOTICES.md` + 双许可（代码 MIT / 资产 CC BY-NC-SA 4.0）。
- **★可直接搬给本地项目（live2d-companion）的 4 条**
  1. **情绪状态机配置化**：把 `expression-presets.json` 的 `{id, face_cues, manga_accents, heightened_cues, forbidden_cues}` 结构照搬成本地 `assets/expressions.json`，17 个表情直接映射成状态机状态；`forbidden_cues` 当互斥规则（例：panic 态禁止 relaxed 帧），可在切换前做一次断言，防止"情绪串味"。来源：`skills/whalechan-image-comic/references/expression-presets.json`。
  2. **双层人设 spec**：照 `character-spec.md` 把本地 system prompt 拆成「永久 identity block（外观/配色/口癖/称呼，永不覆盖）」+「仍生效的 defaults（style/costume/background/text/proportion，各自 canonical|custom）」，避免后续加皮肤/服装时污染人设；同时抄它的"比例只改几何不改年龄"约束（防止图集换形态变小孩）。
  3. **图集 manifest 用 SHA-256 + 实测指标**：抄 `reference-catalog.json` 的 `{primary, measured_*, acceptance_range, references[].sha256}`，把本地 Canvas 图集的每帧/每贴纸登记 `path + sha256 + 尺寸 + 语义 tag`，启动时校验图集与代码是否匹配（本地现在是手写坐标，最容易图改代码不改）。
  4. **三档夸张度 + 落地格**：把 `A/B/C` 三档 + `landing_panel` 概念简化为本地"表情夸张度"参数（按回答长度/情绪强度自动选档，C 纯色背景、B 效果、A 全屏冲击），并用它的 `contrast`（只降一个轴）来实现"文字很疯但脸很平"这种反差梗。

---

## 2) xiaoweigen/deepseek-dafeiyu-assets（5 stars，无主语言/纯素材仓库，2026-10-10 推送，约 16MB）

**定位**：个人非官方「大肥鱼／鲸鱼娘」**设定图资源库**——6 张 1536×1024 级 PNG（Q 版六视图 ×4 套：基础、古风披发、古风盘髻、古风编发；佩剑、长枪两套三视图+细节设定），CC BY-NC-SA 4.0。**无任何代码**。

- **安装/运行方式**：无。纯静态图片库，README 直接内嵌预览（`images/*.png`）。本地可 `python -m http.server` 浏览。
- **设定/人设**：**没有文本人设、没有 prompt、没有语气规范/称呼/开场白**——人设只存在于图里。文本层只有「设定图的元数据与出处」：
  - `characters/whale-girl/README.md`（4.9KB）：每张图的 **尺寸 + 内容**登记表，例：`base-six-views.png` 1536×1024「Q 版比例、蓝色长发和鲸尾，白色基础服装，正背面、左右侧及左右前 45°」；`hanfu-braided-six-views.png` 1448×1086「浅色古风长袍、横向编发、后脑发结、银色发簪与浅青灰垂带」；`hanfu-sword-design-sheet.png`「古风裙装、编发盘髻、正侧背三视图，附面部、发饰、耳饰、鲸尾、腰饰与佩剑细节」。
  - **原始文件名对照表**（`base-six-views.png` ← `2026年10月6日 23_57_12.png`，其余为 `ChatGPT 图像 2026年10月7日 01_05_30.png` 等）：保留"原图内容/格式/分辨率"的溯源习惯。
  - `templates/character.md`（2.2KB）：**可填空的角色页模板** —— 角色简介 / 设定图（图放 根目录 `images/`，详情放 `characters/<角色>/README.md` 时用 `../../images/` 链接）/ **创作者与来源表 7 行**（角色原作者·权利人；本组图片创作者；上传·整理者；原作·素材来源；前序二创与修改记录；AI 辅助创作情况；适用许可与范围）/ 使用许可 / 推荐署名（含"本次修改：无／具体内容"）。
  - 署名链：上善无形（原始角色）→ ZipZipPipe（DeepSeek 女仆化二创，Pixiv《AI娘化》148186519）→ YunYueSama（Q 版设定参考，`codex-deepseek-pet/design/character-sheet.png`）→ xiaoweigen（本库改编）；`NOTICE.md` 记录每个上游出处，`licenses/YunYueSama-ATTRIBUTION-1.0.txt` 是其自定义署名许可原文。
- **形象/Live2D**：无 Live2D/Cubism/pixi，**纯 PNG 设定图**；但它是本地项目最匹配的"大肥鱼/鲸鱼娘"视觉参考源：**六视图（正/背/左右侧/左右前 45°）+ 三视图（正侧背）+ 细节特写（面部/发饰/耳饰/鲸尾/腰饰/武器/鞋履）** 这套组织方式，正好是 Canvas 2D 图集"待机/转身/侧面"帧的取材方式。
- **动作逻辑 / 对话逻辑 / 对话长度 / 表情包**：**均未见**（无代码、无提示词、无表情包）。
- **其他亮点**：极干净的"素材库最小结构"：`README.md` + `characters/<角色>/README.md` + `images/` + `templates/character.md` + `NOTICE.md` + `licenses/` + `LICENSE/LICENSE.zh-CN.md`；中文文学化命名（披发/盘髻/编发/佩剑/长枪）。
- **★可直接搬的 2 条**
  1. `templates/character.md` 的 **7 行出处表**直接做本地 `assets/CREDITS.md`（原作者/二创作者/整理者/来源链接/前序修改记录/AI 辅助情况/许可范围）——本地项目用社区鲸鱼娘形象，这是最短的合规方案；配合 `NOTICE.md` 式的许可分层（代码 vs 图片分开写）。
  2. `characters/whale-girl/README.md` 的「**图片 → 尺寸 → 内容 → 原始文件名**」四列表搬成 `assets/README.md`，让 Canvas 图集的每个 sprite 有尺寸与内容说明（本地现在若只有文件名，改图后无法核对）。

---

## 3) TreapGoGo/deepseek-whale-girl（616 stars，HTML，2026-10-24 推送，约 83MB，GitHub Pages 站点）

**定位**：**社区二创资源库 + 静态站**——角色参考图、可直接复制的生成提示词、社区作品梗图画廊、ComfyUI 工作流、社区项目索引。明确声明"鲸鱼娘是社区共同创作、不断变化的形象；本站提供参考，**不设定唯一或标准化人设**"（与 whalechan 的"高一致性规范"路线相反）。

- **安装/运行方式**（README「本地预览」）：装 Python 3 → `python -m http.server 4173 --directory site` → http://localhost:4173；改 HTML/CSS/JS 刷新即可。推送 `main` 后 `.github/workflows/pages.yml` 自动部署 `site/` 到 Pages。工具链：`tools/build_gallery.py`（从 manifest 重建首页静态画廊）、`tools/validate_site.py`（校验本地链接、图片尺寸、工作流结构）、`tools/import_community.py`、`tools/test_site.cjs`。
- **仓库结构**（README 树 + 实测）：`characters/`（设定图与品牌素材原始归档：`brand/whale-girl-logo*.png`、`dafeiyu/reference-sheets/dafeiyu-{chibi,mature}-character-sheet.png`）+ `site/`（`index.html` 83.6KB、`project.html` FAQ、`contribute.html`、`workflows.html`、`styles.css` 46KB、`script.js` 13.9KB、`assets/`）+ `site/assets/gallery/`（`meme-01..40.webp` + `submissions/issue-NN-MM{-preview}.webp` + `manifest.json` 85KB）+ `site/assets/workflows/comfyui-issue-2/` + `tools/`。
- **人设/设定**：无 system prompt、无运行时；做的是**素材与提示词的"索引层"**。首页导航即内容分类：Q 版大肥鱼 / 成熟比例鲸鱼娘 / 让鲸鱼娘二创更加方便 / 相关资源（**桌面伙伴**：… / **聊天与人设**：… / **二创素材与工作流**：… / **社区小游戏**：…）/ 社区画廊。图片分档：Q 版（`dafeiyu-chibi-character-sheet.png`）与成熟比例（`dafeiyu-mature-character-sheet.png`）两套设定图，两种 `form` 而非五档头身。
- **★相关项目索引（对本地项目最有价值，直接抄这张清单去对标/借鉴）**（取自 `site/index.html`「相关资源」）：
  - 桌面伙伴：**DSH Whale Pet**（aceice01，为 DSH 桌面与网页场景做的鲸鱼娘陪伴挂件）、**Codex DeepSeek Pet**（YunYueSama，鲸鱼娘 Codex 桌宠）、**DSH Reasoning Effort**（HanaAyane，给 DSH 加模型选择/推理强度滑块，并提供**可选的大肥鱼动态外观**）、**深深桌宠 Shenshen Pet**（schrieeeffer，Windows/Codex/ChatGPT 桌宠，视觉素材 CC BY-NC-SA 4.0）、**Harness Launcher**（schrieeeffer，DSH 插件组合管理）。
  - 角色与创作工具 / 聊天与人设：**dafeiyu-persona**（ERUIHNIYHBKBNF，给 AI 助手用的"大肥鱼"**说话风格 Skill**）、**dsh-whale-persona**（OMGLogic，给 DSH 加**可切换的鲸鱼娘全局人设**）、**鲸鱼娘模式·会话预设版**（linsport，用 **YAML 预设**给 DSH 新会话加人格，按会话选择）、**QQ Bridge**（Derpyu520）、**QQ Agent**（K0nd1us，QQ 群聊机器人，图形配置+小鲸鱼人设+**长期记忆**）、**WhaleTalk·鲸语**（tree-people-Z，B 站 AI 角色运营助手）。
  - 二创素材：**93 张鲸鱼娘扩展素材**（AATINF：表情、姿势、服装拆解、配饰、色卡、壁纸 + **完整 Prompt 清单**）；**ComfyUI 鲸鱼娘工作流** 6 份。
  - 社区小游戏：钢铁大肥鱼（文字决议类）、大肥鱼卡丁车（3D 卡丁车，WebGL2）。
- **形象/Live2D**：**无 Live2D/Cubism/pixi**；纯静态 WebP 画廊。图片两级版本是重点：`submissions/issue-NN-MM-preview.webp`（**长边 ≤1000px 浏览预览**）与 `issue-NN-MM.webp`（**完整尺寸**），"预览图与全尺寸下载分开加载"；无 JS 时仍可看静态图片链接。
- **表情包/贴纸（★本地最缺的一块）**：有真正意义上的**梗图/表情包素材池**（`meme-01..40.webp` + 社区投稿，「表情包」是图片 WebP，不是 emoji/颜文字），但**没有运行时触发系统、没有可被模型调用的发贴纸工具**——它是素材仓库而非系统。触发逻辑侧只能参考它的 `manifest.json` 字段：`{id, issue, title, author, source, issueUrl, attachment, handmade, creationType, src, original, width, height, pixelHash}`，另有 `gallery: false`（多格总览不重复占展位）与 `revisions`（#61 修正 #41 的悬浮纽扣：`issue-41-01` 直达地址保留、展示修正版、原文件保留）两个实用字段。
- **ComfyUI 工作流**（`site/assets/workflows/comfyui-issue-2/README.md`）：6 份 **API 格式** JSON（`chibi|mature` × seed `42/777/20260929`），文档点明改提示词改**节点 4 `inputs.prompt`**、种子改**节点 6 `inputs.seed`**、尺寸改**节点 5 width/height**、放大改**节点 8**；采样 euler/simple、28 步、CFG 1，先生成 1024×1536 再放大 1400×2048；依赖 `qwen_image_2.1_int8`、`qwen3vl_8b_int8` text encoder、`qwen_image_2.1_vae_bf16`；`python submit.py chibi-seed42.json` 默认只连 `127.0.0.1:8188`（不向远程发送）；附 `upstream-deployment.md` 归档投稿者原始说明，并明确"维护者只验证 JSON 结构/节点引用/种子/依赖文件名，没做 GPU 复测"。
- **对话逻辑 / 对话长度**：**未见**（无 LLM 调用、无上下文管理、无字数约束；"对话与人设"只是索引到别的项目）。
- **其他亮点**：投稿完全用 **GitHub Issue 模板**（`.github/ISSUE_TEMPLATE/{community-artwork,resource-recommendation,feedback}.yml`）+ 人工整理入库，非程序员也能投稿；`manifest.json` 里 `pixelHash` 记像素哈希（用于查重/校验）；FAQ 页 `project.html`、贡献页 `contribute.html` 分离；许可**三层**：代码 MIT / 原创说明与提示词 CC BY-SA 4.0 / 图片素材各自许可；画廊里 `handmade` 手工专区按投稿者声明记录，"创作类型按投稿者说明记录，不根据画风推断"。
- **★可直接搬的 3 条**
  1. **贴纸/表情包 manifest schema**：抄 `site/assets/gallery/manifest.json` 的字段设计（`id/src/original/width/height/pixelHash/handmade/creationType/revisions/gallery:false`），做本地「表情包系统」的第一版清单——本地现在完全没有贴纸层，先有清单 + 触发标签，再谈渲染。
  2. **预览图/原图两级加载**：`-preview`（长边 ≤1000）与全尺寸分离，Canvas 2D 图集可用同一策略做缩略列表 + 按需原图，显著省内存。
  3. **「清单 → 构建 → 校验」三段式**：`tools/build_gallery.py`（由 manifest 生成静态画廊）+ `tools/validate_site.py`（校验链接/尺寸/结构）这套"单一数据源 + 生成器 + 校验器"，可直接搬成本地 `assets/manifest.json → build-atlas.mjs → validate-assets.mjs`，解决图集与代码脱节。

---

## 横向结论（给本地 live2d-companion 的取舍建议）

1. **人设文本层**：三个仓库里只有 whalechan 有真正的"规范"，它的「永久身份 / 可覆盖字段」双层 + 「drives/tactics/masks」三层人格是可直接落地的 prompt 结构；dafeiyu 与 whale-girl 是**素材层**，不提供语气/称呼/开场白（均未见）。
2. **本地最缺的两块**：**表情包/贴纸系统**（whale-girl 的素材池 + manifest 可做第一版）、**情绪-表情映射的工程化**（whalechan 的 17 表情 preset + forbidden_cues 互斥 + A/B/C 夸张档）。
3. **本地优势/无需照搬**：三者都没有 Live2D 运行库（本地的 Canvas 2D 图集路线与它们一致，不存在"必须上 Live2D"的证据）；三者都没有对话上下文管理、流式、字数约束、TTS、记忆（whale-girl 只是索引了别人的记忆型项目 QQ Agent）。
4. **合规**：dafeiyu 的 CC BY-NC-SA 4.0 + 7 行出处表模板、whale-girl 的三层许可拆分、whalechan 的双许可，三种都可参考；本地若继续用社区形象，优先照 dafeiyu `templates/character.md`。

### 抓取状态备注
- `Neko3000/deepseek-whalechan`：trees 408 项、非图片文件约 120 个，已读 README.md（35.5KB 前 26KB）、character-spec / character-personality / language-policy / form-profiles / reference-index / reference-catalog.json / asset-index / expression-presets.json / exaggeration-tiers.md / comedy-engine.md / prompt-design.md，其余（qa-rubric.md 9.7KB、`scripts/manage-run.py` 123KB、run-schema.md 35KB、batch-*）未细读。
- `TreapGoGo/deepseek-whale-girl`：`.impeccable.md` 经 jsDelivr 返回 403（未取到）；`site/index.html` 只作结构化摘取（83.6KB），未逐字通读。
- 所有"未见"均为**该仓库中未发现**，不代表生态里不存在（whale-girl 索引的 QQ Agent、dsh-whale-persona 等可能有对话逻辑与记忆，但不在本次调研范围内）。
