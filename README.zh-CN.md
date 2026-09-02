# 🎨 dsh-genui

<div align="center">

[English](./README.md) · **简体中文**

<br>

[**打开在线产品站**](https://omdsh-dev.github.io/dsh-genui/) · [**看真实演示**](#观看真实界面) · [**安装到 DSH**](#-快速开始)

</div>

> 让模型的回答长出界面——文字还在，可交互的 UI 已经能用。
>
> 🔌 生态：仓库已挂 `#dsh` · `#dsh-plugin` topic，欢迎 @dsh-plugin 收录。

`dsh-genui` 把模型回答变成**安全、可交互的 DSH 界面**。你问「这个月订单怎么样」，回答除了文字，还可以直接带上可排序的数据面板、原生音视频、可拖动的函数图、本地判题或常驻会话面板。

## 先看真实证据

| 你想做什么 | 直接看这里 | 可以确认什么 |
|---|---|---|
| 先看完整 DSH 流程 | [40 秒真实录屏](#40-秒完整演示) | 组件确实出现在 DSH 的真实对话里。 |
| 看具体界面是什么样 | [三类真实输出](#一条-dsh-回答里的三类真实输出) | 监控、函数绘图和可组合的布局组件。 |
| 立刻在自己的 DSH 里试 | [快速开始](#-快速开始) | npm 公开包安装、验证提示词与激活检查。 |
| 学会 JSON 界面描述 | [组件语法](./SKILL.md) | 受白名单约束的 `dsh-ui` 组件规范。 |

## 观看真实界面

> **不是概念图。** 本节的录屏与截图均来自 `dsh-genui` 在 DSH 界面中的实际渲染；先看它真正长什么样，再决定是否安装。

### 40 秒完整演示

<div align="center">

https://github.com/user-attachments/assets/f5db33ec-7471-4d4a-a85b-79c9962ab4ef

</div>

<p align="center">
  <a href="./assets/demo.mp4"><img src="./assets/demo-thumb.png" width="92%" alt="dsh-genui 完整演示录屏封面"></a>
  <br><em>若 GitHub 播放器不可用，点击封面即可下载原始 MP4。</em>
</p>

录屏依次经过回答内嵌面板、表单、函数绘图、Mermaid 与面向 3D 的组件。播放器不会自动播放；若没有加载，请打开[原始 MP4](./assets/demo.mp4)，四幕提示词见 [demo-prompts.md](./demo-prompts.md)。

### 一条 DSH 回答里的三类真实输出

#### 1. 监控面板就是回答的一部分，不是另开一个仪表盘

<p align="center">
  <img src="./assets/showcase-panel.png" width="92%" alt="真实 DSH 对话中渲染的 dsh-genui 监控面板">
  <br><em>真实输出：刷新/重置、时间范围、统计卡、图表和服务表都活在助手回答里。</em>
</p>

#### 2. 改参数时，函数图在本地即时重绘

<p align="center">
  <img src="./assets/showcase-plot.png" width="76%" alt="带可拖动参数滑块的真实 dsh-genui 函数图">
  <br><em>真实输出：`plot` 绘制曲线；拖动滑块、重置和动画控制都直接更新图形。</em>
</p>

#### 3. 布局原语可以组成有层级的工作界面

<p align="center">
  <img src="./assets/showcase.png" width="76%" alt="真实 dsh-genui 排版和卡片组件组合">
  <br><em>真实输出：文字、网格、卡片、行列原语可组合成模型能够声明的界面层级。</em>
</p>

---

## ⚠️ 先看这里：双通道渲染（无需修改宿主源码）

本插件自带**两套渲染通道**；宿主激活浏览器模块后，插件会自动选择：

- **Registry 通道**：宿主提供 `fence-registry` 扩展点（新版 dsh 构建）时，围栏经宿主流式渲染管线注册，行为与宿主无缝；
- **DOM 通道**：宿主没有该扩展点（包括原版 DSH 与旧版构建）时，插件观察会话 DOM 自行挂载渲染树。自 0.7.2 起**支持流式渲染**：模型写到哪渲染到哪，首个完成的组件立即出现，不用等整段回复写完。自 0.8.3 起围栏发现**多表面兼容**：同时匹配标准 `md-code-block` 表面、部分宿主构建使用的 deepsuite 风格 `.code-block` / `.code-block-small` 表面，并以「label+`<pre>`」结构兜底——任何 banner 标注 `dsh-ui` 且含 `<pre>` 正文的元素都能被识别。即使你的 dsh 构建用了别的类名，围栏照常渲染（控制台会有一条一次性提示说明宿主 DOM 发生漂移）。

无论走哪条通道，组件、交互、面板、持久化行为完全一致。

本仓库已经包含两条渲染通道、服务端插件和浏览器构建产物；宿主仍负责**激活客户端模块**，并提供 `slots` 与 `sessions` 服务。`client.js` 返回 200 或出现在 ModuleLoader 缓存里，只能证明文件下载成功；真正激活后一定会打印 `[genui] client active; fence-channel=registry|dom`。没有这行时应先核对包名/网页配置/宿主激活链，`data-streaming`、`data-chat-anchor-key` 等页面属性只是可选信息，不是安装前提。

---

## ✨ 装之前 vs 装之后

| 普通回答 | 装了 dsh-genui |
|---|---|
| "本月收入 ¥128,430，环比 +12.4%，建议关注转化率。" | 一行分析 + 旁边直接渲染：收入/订单/转化率三张统计卡、趋势图、进度条 |
| 想再看别的？再打一段字问一遍 | 面板上就有「刷新」「切换视图」按钮，点一下，模型更新数据 |

## 🚀 快速开始

前置条件，缺一不可：

1. **dsh 已安装**（开源版任意构建均可——插件启动时自动选择渲染通道，见上文「双通道渲染」）
2. **`pnpm` 在 PATH 上**：`dsh plugin` 命令依赖它。没有就 `corepack enable`（或 `npm i -g pnpm`），然后**新开一个终端**，确认 `pnpm -v` 有输出

安装并在 DSH 中激活（一行命令，自动带上全部依赖）：

```sh
# npm 公开包安装（无需 npm 账号）
dsh plugin --profile web add @changfenhuang/dsh-genui
```

如果只想把它作为 Node 依赖加入现有项目：

```sh
npm install @changfenhuang/dsh-genui
```

> `npm install` 只添加依赖，不会把插件注册到 DSH；在 DSH 中使用时仍应执行上面的 `dsh plugin add`。

> ⚠️ **别用 `link:` 装一个刚 clone 的目录**——`link:` 不会安装插件的依赖（mermaid / three / react），装完渲染器会挂。正常安装请使用上面的 npm 命令；只有本地开发迭代才用 `link:`（见下文）。

### 从旧 `@omdsh-dev` 包名迁移

如果你在 v0.9.2 之前通过 `github:omdsh-dev/dsh-genui` 安装过，pnpm 可能仍把依赖保存在旧的 `@omdsh-dev/dsh-genui` 键下，但仓库当前声明的包名已经是 `@changfenhuang/dsh-genui`。加载器按 profile 的依赖键解析插件，后续重装时就可能报 `Cannot find package '@changfenhuang/dsh-genui'`。请用当前包名重新添加一次：

```sh
dsh plugin --profile web remove @omdsh-dev/dsh-genui
dsh plugin --profile web add @changfenhuang/dsh-genui
```

这次迁移只针对改名前留下的 GitHub 源安装。此后新装统一使用上面的 npm 命令，并采用当前依赖键。

### 60 秒验证安装

命令完成后，重启 dsh web 并对浏览器硬刷新。在**新**会话中输入：

```text
用 dsh-ui 画一个带可排序服务表的统计看板。
```

正常情况下，回答会原地变成仪表盘，而不是显示成代码块。想做最明确的技术确认时，打开浏览器控制台：成功激活会打印 `[genui] client active; fence-channel=registry|dom`。

### 开发者迭代（link 模式）

```sh
cd dsh-genui
pnpm install
dsh plugin --profile web add link:$PWD
```

## 🧩 能力地图

| 界面方向 | 第一次怎么试 | 可以直接观察到的行为 |
|---|---|---|
| 数据 | 让它做订单或服务监控看板 | `stat`、`table`、`chart`、`progress` 直接出现；已支持的数值表格按数值排序。 |
| 媒体 | 让它引用一段音频或视频 | 浏览器可访问的媒体直接内嵌播放，带封面/比例和失败状态。 |
| 探索 | 让它用 `plot` 画带参数的函数 | 拖动滑块，本地立即重绘曲线。 |
| 反馈 | 让它出一道小测 | 判题和解析在本地完成；需要模型参与的下一步才使用 `action`。 |
| 工作区 | 使用 `/panel` 或 `panel: true` | 常驻、可调高的会话 dock 在原地更新。 |

下面是完整能力说明。所有行为都受白名单 `dsh-ui` 规范约束；JSON 写法请看 [SKILL.md](./SKILL.md)。

- **回答即界面**：组件嵌在回答里，边生成边出现，不用等整段写完
- **30+ 组件**：卡片、表格、图表、表单、标签页、折叠面板、文件树、时间线、diff……
- **原生音视频**：浏览器可访问的 http(s) 或同源相对地址直接嵌入回答；用户主动控制播放，视频支持封面与画面比例，失败时原位提示
- **ECharts 集成**：`echart` 节点渲染完整的 ECharts 图表，自动适配主题色、提示框和图例。两种模式：**预设简写**（`preset: 'bar' | 'line' | 'area' | 'pie' | 'scatter'` + `data`/`series`）可从 `chart` 节点快速升级；**完整选项**（`option` 字段）支持自定义图表类型、dataZoom、visualMap 等高级 ECharts 功能。echarts 引擎（~1 MB）按需懒加载——主包不含引擎，没有 `echart` 节点的对话不会下载它- **函数图**：`plot` 画曲线，参数滑块拖动实时重绘，支持自动动画

- **测验**：`quiz` 点选判题 + 解析 + 重试；带 `action` 时答案同时回传模型（判题仍本地即时）
- **本地判卷（交卷）**：多道选择题 = 每题的 `radio` 加 `group` + `answer`（正确答案）+ `explanation`（解析），再加一个 `submit` 交卷按钮——用户全部选完点一次，**分数、每题对错、解析当场在 UI 里出现，零模型往返**；题目随即锁定，「重新作答」本地重置（可选 `resetAction` 通知模型）。题目没带答案时才退回聚合 action（`fields` 收集所有带 `id` 的输入）
- **状态持久化**：答案、交卷锁定、输入值按「会话 + 内容指纹」自动保存——刷新页面/重开会话原样恢复，重渲染相同内容保留用户状态，新内容自动从头开始；上限 200 块 LRU 淘汰
- **表单语义**：`input` 回车 / `textarea` Ctrl+Enter 即时提交（`submit:true`），不用等失焦；带 `id` 的字段值进 submit 的 `fields` 收集
- **秘密禁令**：GenUI 不得索取密码、API Key、访问令牌、恢复码或其他秘密；密码输入即使出现也保持打码、不持久化、不进表单收集
- **本地优先原则**：UI 自己能完成的状态变化（判卷、判题、重置、展开、选中）一律本地即时完成；action 只用于必须模型参与的事（生成新内容、执行工具、下一步建议）
- **诚实交互**：交互组件必须带 `action`；不带 `action` 的按钮渲染为禁用态（消灭"看着能点、点了没反应"的假按钮）；带 `action` 的按钮点击后立即显示「已触发」本地反馈（只证明本地事件已触发，不代表模型已收到）
- **事件循环**：按钮/开关/输入/下拉/复选/单选/文本域/测验带 `action`，点击/失焦回传模型，模型更新界面；同名 action 300ms 尾沿防抖，连点合并为一次（最后一次的值生效）
- **工具通道**：`render_ui` 工具把同一份 spec 渲染成工具行卡片（交付物型 UI 走工具、回答型 UI 走围栏）
- **会话面板**：composer 上方常驻 dock，`render_ui` / `panel: true` 围栏原地更新同一块界面；`/panel` 命令客户端直开（`/panel <指令>` 转模型定制、`/panel clear` 清空）；顶边框可拖拽调高；`append: true` 增量合并——同名标签页追加内容、新标签页新增；整面板默认最多 200 节点 / 200 条追加，达到上限后模型应发送 `replace` 重建
- **自愈与上限**：每个围栏过规格守卫——坏节点静默丢弃、数值钳位、字符串截断，整树 ≤200 节点 / 8 层嵌套，病态 spec 不会拖垮界面
- **图错误自愈**：mermaid 渲染失败自动修复重试（剥反引号、引号化中文/空格标签、去 `<br/>`），仍失败才降级源码；错误图永不直接上屏
- **可访问性**：tabs/折叠/开关/进度条带完整 ARIA 与键盘导航（方向键切页、Home/End 跳转）
- **零打扰**：不装插件时围栏只是代码块，不报错、不污染会话

## 🏆 新手引导：模板中心与探索成就（0.9.4+）

- **模板中心**：会话面板 dock 顶部的「模板」按钮——11 个分类示例（仪表盘/方案对比/上手流程/随堂测验/趋势图/标签页/清单/FAQ/架构图/3D/文件树），点击即内嵌预览（示例由 GenUI 本身渲染），「试用」一键把指令插入输入框、发送即让模型生成；「复制指令」可带走。
- **探索成就**：同一 dock 的「成就」按钮——12 个成就（初次相见 → 蓝图之魂），按渲染/交互/面板/模板埋点计数，解锁弹 toast，成就页由 `dsh-ui` 渲染自己的列表；只存计数（localStorage），绝不读取消息内容；隐藏成就（传说）解锁前显示「？」。
- **首次提示**：第一块面板出现时显示 6 秒一次性提示（指向「模板」按钮），不打扰式引导。

组件 JSON 语法见 [SKILL.md](./SKILL.md)。宿主提供公开 skill registry 时，插件会自动注册内置 `genui` skill，因此新会话无需向 `~/.dsh` 复制文件即可获得完整组件与字段目录。

`chart` 保持三种图形的紧凑渲染器：使用 `kind: 'bars' | 'line' | 'donut'`，且 `data[].value` 必须是有限数字。`validate_dsh_ui` 会明确报告误用的 `variant`、不支持的 kind 和非法数据字段；`render_ui` 对同样错误直接失败，不再静默渲染默认柱图。未知扩展字段仍允许存在。

## 📄 示例

模型输出这段围栏（写给浏览器看的，你不用读懂）：

```dsh-ui
{"title":"订单概览","items":[
  {"type":"stat","label":"总收入","value":"¥128,430","delta":"+12.4%"},
  {"type":"stat","label":"订单数","value":"1,024","delta":"-3.1%"}
]}
```

你看到的是两张统计卡片。

### ECharts 示例

```dsh-ui
{"title":"Q1 收入","items":[
  {"type":"echart","title":"月度收入","preset":"bar","data":[
    {"label":"1月","value":98},
    {"label":"2月","value":112},
    {"label":"3月","value":128}
  ]}
]}
```

你看到的是一张带提示框和坐标轴的主题色柱状图——由 ECharts 渲染，按需懒加载。

## 🔧 原理

模型把界面描述写成 JSON 放进 `dsh-ui` 围栏，浏览器端渲染器（`src/client`）通过主仓 `fence-registry` 接口认领这门语言并渲染。组件是白名单的，模型塞不进 HTML/脚本；函数表达式走独立解析器，不用 eval。

主渲染包保持轻量（≈110 KB min / 28 KB gzip），mermaid、three.js 与 echarts 引擎单独打包为按需资产（首次用到时经插件自注册的 HTTP 路由加载），启动时只下载渲染核心。

## ❓ 常见问题

- **显示成代码块？** 先在浏览器控制台找 `[genui] client active; fence-channel=registry|dom`。没有这行，即使 `client.js` 返回 200，也只是下载了文件、没有激活：请对齐网页配置依赖名、`package.json.name`、`cordis.patch.yml`、ModuleLoader id 和配置中的 bundle 名。出现这行后再查围栏标签/正文；宿主没有 registry 时会自动走 DOM 通道。
- **渲染 dsh-ui fence 时聊天界面白屏？** dsh 版本太旧——先更新 dsh 再重装插件。
- **`dsh: pnpm not found on PATH`？** 装 pnpm 后**新开终端**再试（`corepack enable` 或 `npm i -g pnpm`）。
- **npm 安装返回 404？** npm 包是公开的，无需登录。先执行 `npm view @changfenhuang/dsh-genui version` 核对包名与公共 registry；若新版本刚发布仍返回 404，稍后重试。
- **装了但 scene3d/mermaid/echarts 不渲染？** 引擎（mermaid / three / echarts）不再内联进 client.js——它们在首次用到时按需加载（`/plugins/@changfenhuang/dsh-genui/assets/*.js`，插件自带 HTTP 路由托管）。先重启 dsh web + 硬刷新（Cmd+Shift+R）；仍不渲染就卸掉重装（`dsh plugin --profile web remove @changfenhuang/dsh-genui` 后再 add）。旧版宿主缺少资产路由时会降级显示源码/加载失败提示，更新 dsh 即可。
- **模型不主动输出？** 重启后新会话生效；或直接说"用 dsh-ui 输出"。
- **clone 后没有 lib/？** `pnpm install && pnpm run check` 自己构建。

## 🧑‍💻 开发

```sh
pnpm install
pnpm run check   # 类型检查 + 全量测试 + 构建
```

### 真机 e2e

真实链路验证：起一个临时 dsh web → 装上插件 → 浏览器里发消息让模型输出 `dsh-ui` fence → 断言渲染 → 点击 action 按钮 → 断言模型响应（事件循环闭环）：

```sh
DEEPSEEK_API_KEY=sk-... node scripts/e2e.mjs          # link 安装当前工作区
```

前置：`dsh`/`pnpm` 在 PATH、`DEEPSEEK_API_KEY`、主仓 web 构建产物（playwright 从主仓解析）。PASS 时保存 `e2e-final.png` 截图。

### 视觉 e2e（无需模型 key）

样式/组件迭代用：起真实 dsh web + link 安装插件 → 通过 DOM 通道注入组件画廊围栏 → headless Chrome 全页截图 + 本地交互（表格排序 / 判题 / 目录折叠 / 数值对齐）硬断言，不需要任何模型额度：

```sh
npx tsx scripts/e2e-visual.mts          # → .e2e-artifacts/gallery.png + interactions.png
npx tsx scripts/e2e-visual.mts --keep   # 保留 scratch DSH_HOME 便于排查
```

可覆盖：`--port 3098`、`--out <dir>`、`DSH_BIN`（默认 npm 生产模式 `~/node_modules/.bin/dsh`）、`PLAYWRIGHT_PATH`（默认全局 playwright-core）。

## 🗺️ Roadmap（已评估项）

| 方向 | 结论 | 理由 |
|---|---|---|
| 增量 patch（模型只发 diff 不重发全量 spec） | 不做 | fence 一次 200–800 token，重发代价极小；patch 协议的教学成本与出错率不值得。若未来出现秒级自动刷新面板再议 |
| action 防抖/去重 | ✅ 已做（300ms 尾沿，按 action 名独立） | 连点刷屏是真实摩擦，收口点一处改动 |
| 跨会话状态持久化（回放恢复 tabs/开关） | 不做 | 回放重置是更正确的默认行为（模型已用新 fence 更新过界面）；流式期间状态天然保留 |
| MCP 适配器 / 独立画廊页 / i18n | 不做 | 无跨工具需求信号；画廊素材已被 `gallery.ts` + demo-prompts + README 截图覆盖；内置文案仅 6 处 |

单元测试和构建直接使用锁定的 dsh rc.8 发布包；只有源码级或端到端检查才需要设置 `DSH_ROOT`。

## 🔗 友情链接

- [Linux.do](https://linux.do)

---

📄 License: MIT
