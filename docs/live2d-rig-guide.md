# 把「大肥鱼」做成真正的 Live2D 模型（制作包）

> 现在 `whale.html` 里跑的是**伪 Live2D**：原画序列帧 + 程序化呼吸/眨眼/摇晃。
> 它长得像 Live2D、接口也按 Live2D 的用法设计，但**不是 .moc3**。
> 这份文档是"想升级成真模型时该怎么做"的作业清单——拆层、参数、表情、导出、接回本项目。
> 真 .moc3 只能由 Cubism Editor 产出，任何脚本都变不出来；但剩下的活都可以省。

## 0. 先判断：要不要升级

| | 伪 Live2D（现在） | 真 Live2D（.moc3） |
| --- | --- | --- |
| 素材要求 | 已有序列帧就行 | 需要**分层 PSD**（头发/眼白/瞳孔/嘴/身体分开） |
| 表情表现 | 只能切"整套表情帧"，不能中途混合 | 眉/眼/嘴/头的任意组合，无限表情 |
| 跟随鼠标/视线 | 只有整体摇晃 | 头、瞳孔真跟人走 |
| 制作成本 | 0（已完成） | 拆层 1~2 天 + 绑定 1~3 天（熟手） |
| 运行开销 | 极低（Canvas 2D 贴图） | 中（WebGL） |

**结论**：只想"看着像就行" → 用现在这套已足够。
想要"眼神跟着你走、表情能半笑半怒" → 做真模型，按下面清单来。

## 1. 准备

1. **Cubism Editor**（免费版即可，个人/小规模商用许可免费）
   https://www.live2d.com/cubism/  → 下载 Cubism Editor
2. **分层 PSD**（关键）。现在仓库里的原画是**已经合并的成品帧**，不能直接拆。
   要么拿到画师的原始分层文件，要么按下面清单重绘。

## 2. 分层清单（大肥鱼）

按从后到前的顺序，每个图层单独一层，**不要合并**：

| 组 | 图层名 | 用途 |
| --- | --- | --- |
| 背景附件 | `tail` 尾巴、`fin` 耳鳍 | 摆动 |
| 后发 | `hair_back` | 随身体晃动 |
| 身体 | `body` 身体+`dress` 裙子+`apron` 围裙 | 整体呼吸/倾斜 |
| 手臂 | `arm_L`、`arm_R`（可再拆 `hand`） | 挥手/摆臂 |
| 头部 | `head`（空变形器也行） | 头整体倾斜 |
| 脸 | `face`、`blush` 腮红 | 表情底色 |
| 眉 | `brow_L`、`brow_R` | 情绪主通道 |
| 眼 | `eye_white_L/R`、`pupil_L/R`、`eyelid_L/R`（上眼睑） | 睁闭、视线 |
| 嘴 | `mouth`、`teeth`、`tongue` | 口型（说话）、笑/撇嘴 |
| 前发 | `hair_front`（含呆毛 `ahoge` 单独一层） | 二次元动态的灵魂 |
| 配饰 | `bow_L/R`、`ribbon` | 跟随 |

小技巧：**眼睛和嘴一定要拆开**，这两个决定"活"。头发前后分开，前发单独一层方便加物理。

## 3. 参数表（照抄进 Cubism 即可）

### 标准参数（必须做）

| ID | 范围 | 作用 |
| --- | --- | --- |
| `ParamAngleX` | -30..30 | 头左右转 |
| `ParamAngleY` | -30..30 | 头上下 |
| `ParamAngleZ` | -30..30 | 歪头 |
| `ParamEyeLOpen` / `ParamEyeROpen` | 0..1 | 睁眼（0=闭） |
| `ParamEyeBallX` / `ParamEyeBallY` | -1..1 | 瞳孔视线 |
| `ParamBrowLY` / `ParamBrowRY` | -1..1 | 眉毛上下（怒气/难过） |
| `ParamBrowLForm` / `ParamBrowRForm` | -1..1 | 眉毛形状（-1 皱眉） |
| `ParamMouthOpenY` | 0..1 | 张嘴（说话口型） |
| `ParamMouthForm` | -1..1 | 嘴角（-1 撇嘴 / 1 微笑） |
| `ParamCheek` | 0..1 | 腮红 |
| `ParamBodyAngleX` / `ParamBodyAngleZ` | -10..10 | 身体倾斜 |
| `ParamBreath` | 0..1 | 呼吸（自动循环） |

### 大肥鱼专用参数（可选，做出来效果好很多）

| ID | 说明 |
| --- | --- |
| `ParamTailSwing` | 鲸尾摆动（-1..1） |
| `ParamFinFlap` | 耳鳍扇动 |
| `ParamAhogeSwing` | 呆毛晃动（物理驱动） |
| `ParamPearlShine` | 围裙上小鲸鱼的高光（兴奋时亮） |
| `ParamSquash` | 整体挤压（落地/被摸头） |

## 4. 十个情绪 → 表情文件（.exp3）

在 Cubism 里做好表情（Expressions），文件名建议直接用情绪 key，方便项目直接映射：

| 情绪 key | 表情 | 主要参数 |
| --- | --- | --- |
| `calm` | 平静 | 全默认 |
| `happy` | 开心 | `ParamMouthForm=0.8`, `ParamEyeLSmile=0.8`, `ParamCheek=0.3` |
| `excited` | 兴奋 | `ParamMouthOpenY=0.4`, `ParamBrowLY=0.6`, `ParamCheek=0.6`, `ParamPearlShine=1` |
| `shy` | 害羞 | `ParamCheek=0.9`, `ParamEyeBallY=-0.4`, `ParamAngleZ=8` |
| `sad` | 低落 | `ParamBrowLY=-0.6`, `ParamBrowLForm=-0.4`, `ParamMouthForm=-0.6` |
| `hurt` | 委屈 | `ParamBrowLY=-0.8`, `ParamMouthForm=-1`, `ParamEyeLOpen=0.7`, `ParamCheek=0.3` |
| `annoyed` | 烦躁 | `ParamBrowLForm=-0.6`, `ParamMouthForm=-0.5`, `ParamEyeBallX=0.5` |
| `angry` | 生气 | `ParamBrowLForm=-1`, `ParamBrowLY=-0.5`, `ParamMouthOpenY=0.3`, `ParamAngleZ=-6` |
| `surprised` | 惊讶 | `ParamEyeLOpen=1.6`, `ParamMouthOpenY=0.7`, `ParamBrowLY=0.8` |
| `bored` | 无聊 | `ParamEyeLOpen=0.55`, `ParamMouthForm=-0.3`, `ParamAngleZ=4` |

## 5. 制作步骤

1. **导入 PSD**：Cubism Editor → 新建模型 → 导入分层 PSD，确认每层位置正确。
2. **建变形器**：整个角色一层 `D_Root` → 下面 `D_Head`、`D_Body`、`D_ArmL`、`D_ArmR`。
   变形器是"骨架"，参数只驱动变形器，不直接驱图层。
3. **蒙皮**：给每个图层铺网格（发丝可以稀一点，脸和眼睛密一点）。
4. **绑参数**：选中变形器 → 在参数面板给关键帧（例如 `ParamAngleX` = -30 时头往左偏、=30 时往右偏）。
   建议顺序：头 → 眼 → 眉/嘴 → 身体 → 头发/尾巴（后两个主要靠物理）。
5. **加物理**：`physics3.json` 里给前发、呆毛、尾巴、裙摆做摇摆（Cubism 自带物理模拟）。
6. **做表情**：Expressions 面板按第 4 节建 10 个表情，每个只改几个参数。
7. **做动作**：至少 3 个 Motion（idle 呼吸循环 / 挥手 / 点头），其余动作可以继续用伪 Live2D 的序列帧叠着播。
8. **导出**：`文件 → 导出 → 嵌入文件`，得到 `dafeiyu.model3.json` + `.moc3` + `textures/` + `physics3.json` + `expressions/*.exp3.json` + `motions/*.motion3.json`。
9. **自检**：导出后确认 `model3.json` 里引用的每个文件（`.moc3` / `textures/` / `physics3.json` /
   `expressions/*.exp3.json` / `motions/*.motion3.json`）都真实存在、路径大小写一致——缺一个，网页里就是空白。
   然后把整个文件夹放进 `assets/dafeiyu/`。

## 6. 接回本项目

真模型做出来后，接到 `whale.html`（保持大肥鱼的 UI 和人设）：

> 项目里**不再带** Live2D 运行时（原先给官方样例角色用的 pixi.js / pixi-live2d-display / Cubism Core 已随示例页移除）。
> 需要先补回来：`vendor/pixi.min.js`（6.x）、`vendor/live2dcubismcore.min.js`、
> `vendor/pixi-live2d-display.cubism4.min.js`（注意必须是 cubism4 那个完整 UMD 构建），
> 并在 `whale.html` 里按这个顺序加载：cubism core → pixi → pixi-live2d-display。

**写一个适配类，替换掉图集渲染器**
`js/whale-render.js` 的 `WhaleRig` 只需要满足 5 个方法，写一个适配类即可：

```js
class Live2DRig {                    // 与 WhaleRig 同接口
  async load() {}                    // Live2DModel.from(...)
  play(name, opts) {}                // model.motion(name)
  pose(name, opts) {}                // model.expression(name)
  idle(opts) {}                      // model.motion('idle')
  update(dt) {} draw() {}            // pixi ticker 自己跑，这里空实现
  get speaking() {} set speaking(v) {}  // 口型：v=true 时驱动 ParamMouthOpenY
}
window.WhaleRig = Live2DRig;         // 然后在 whale.html 里换成加载 pixi
```

因为 `whale-app.js` 只依赖 `play / pose / idle / update / draw / speaking` 这几个接口，
**换渲染层不需要动情绪引擎和人设**。这也是当初把它写成"伪 Live2D、接口对齐"的原因。

## 7. 工作量参考

| 环节 | 熟手 | 新手 |
| --- | --- | --- |
| 拆层/重绘 PSD | 4~8h | 1~2 天 |
| 网格 + 变形器绑定 | 6~12h | 2~3 天 |
| 物理 + 表情 + 动作 | 3~6h | 1 天 |
| 接入调试 | 1~2h | 半天 |

如果只是自用，**建议先不升级**：现在这套已经能表达 10 种情绪、能眨眼呼吸摇晃，情绪价值已经到位；
等哪天觉得"她眼神不跟着我"很难受，再按这份清单做。
