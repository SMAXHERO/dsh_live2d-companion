# 署名与授权（CREDITS）

本项目**只有一个角色：大肥鱼**。下面两条素材线分别有不同的授权，用之前请对号入座。

## 1. 大肥鱼的形象素材（原画 / 动作帧）

- 来源：**YunYueSama / codex-deepseek-pet**
  https://github.com/YunYueSama/codex-deepseek-pet
- 授权：**大肥鱼项目署名许可 1.0**（该仓库自带许可，要求署名并说明修改）
- 本项目做了哪些修改：
  1. 把仓库里按动作分文件的多帧原画（idle-front / actions / expressions / dense-* / story-* / motion-turn）
     解析成**图集网格**，并生成 `assets/whale/rig.json` 描述每张图的 cell 尺寸、行列数与脚底锚点；
  2. 用这些帧拼了一条**动作时间轴**（挥鳍 / 吃鱼 / 跳 / 跳舞 / 睡 / 醒 / 溜走 / 哼歌 / 转身），
     时间取自原项目 `src/renderer/motion.js`；
  3. 作为**参考**给每个动作/表情帧标了语义（哪一帧是"害羞"、哪一帧是"鼓腮生气"），写在
     `js/whale-render.js` 的 POSES 表里；
  4. 在此基础上新增：程序化呼吸/眨眼/摇晃/落地挤压/说话抖动（伪 Live2D 骨架）、
     情绪状态机、内容层对话引擎、人设与台词库、网页界面。
- 原画版权仍归原作者所有。**再分发或商用请先读原仓库的许可条款**，并保留本文件的署名。

## 2. 人设与台词（本项目原创）

- `persona/persona.json`、`persona/lines.json`、`persona/system-prompt.md`、`persona/大肥鱼.persona.yaml`
- 基于上面那份形象素材的性格设定做的二次创作，台词为本项目原创。沿用同一条署名要求：署名 YunYueSama。

## 3. 第三方运行库

**当前没有第三方运行库。** `whale.html` 是纯 Canvas 2D + 本项目自己的 JS，零依赖、离线可跑。

（早先用于"官方 Live2D 样例角色"的那套 pixi.js / pixi-live2d-display / Cubism Core 连同 haru 样例模型
已随该示例页一起移除；将来若把大肥鱼做成真 Live2D 模型，需要按 `docs/live2d-rig-guide.md` 重新引入。）

## 4. 本项目代码

`whale.html` / `whale.css` / `js/*.js` / `config.js` / `server.js`
为自用而写，没有附加限制；如要开源请自行选择许可，并保留上面第 1、2 条的署名。
