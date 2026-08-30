---
name: genui
description: "Render structured interactive UI inline in your reply via the dsh-ui fence — not just charts: callouts/badges for emphasis, lists/keyvalue for key points, steps/timeline for processes, tables for comparison, mermaid for flows, 3D for scenes. Use whenever structured presentation would be clearer than prose: 要点、强调、对比、流程、步骤、状态、数据、演示、操作 — even if the user did not ask for UI. Emit a ```dsh-ui fence with a JSON spec; the GUI renders it as real components where the fence sits."
---

# GenUI — 生成式 UI 输出规范

你可以**在回答正文中间**输出可交互 UI 组件：写一个 `dsh-ui` 围栏（fenced block with language tag `dsh-ui`），内含 JSON 规格，渲染器会把这一整块画成真实组件，文字照常穿插在前后。组件**就是回答的一部分**，不是工具调用。

```dsh-ui
{"title":"可选标题","gap":14,"items":[...]}
```

## 组件词汇（只允许这些 type）

布局：`text` `row` `col` `grid` `card` `divider` `spacer`
展示：`stat` `badge` `progress` `list` `table` `keyvalue` `avatar` `image` `audio` `video` `timeline` `file-tree` `breadcrumb` `diff` `json` `code` `callout` `steps`
图表：`chart`（bars/line/donut，可多序列）`plot`（数学函数图）`echart`（ECharts 全功能图表）
交互：`button` `input` `select` `checkbox` `radio` `switch` `textarea` `tabs` `accordion` `copy`

### 布局
- text: `{"type":"text","size":"h1|h2|h3|body|muted|caption","content":"...","center":true?}`
- row / col: `{"type":"row"|"col","items":[...],"wrap":true?,"spacer":true?,"gap":n?}`
- grid: `{"type":"grid","cols":n,"items":[...]}`
- card: `{"type":"card","title":"...","items":[...]}`
- divider: `{"type":"divider"}`; spacer: `{"type":"spacer"}`

### 展示
- stat: `{"type":"stat","label":"...","value":"...","delta":"+12.4%|-3%"}`（`-` 开头自动红、`+` 绿）
- badge: `{"type":"badge","label":"...","tone":"success|warn|danger|accent","icon":"emoji?"}`
- progress: `{"type":"progress","label":"...","value":0-100,"valueLabel":"70%"}`
- avatar: `{"type":"avatar","name":"...","color":"#hex?"}`
- image: `{"type":"image","src":"/mmx-files/result.png","alt":"结果图片"}` — 展示浏览器可访问的 http(s) 或同源相对图片地址；懒加载；不支持 `file:`/`data:` 等本地或主动协议
- audio: `{"type":"audio","src":"/mmx-files/result.mp3","alt":"语音结果","loop":true?}` — 原生控制条；用户主动播放，不自动播放；仅 http(s) 或同源相对地址
- video: `{"type":"video","src":"/mmx-files/result.mp4","alt":"视频结果","poster":"/mmx-files/poster.jpg"?,"loop":true?,"muted":true?,"aspectRatio":"16:9|4:3|1:1|9:16"?}` — 原生播放/音量/全屏控制；不自动播放
- list: `{"type":"list","items":["..."] 或 [{"title":"...","desc":"..."}] 或嵌套节点(如 {"type":"badge","label":"TS"})}` — 行内可嵌节点（计入节点预算）
- table: `{"type":"table","columns":["..."],"rows":[["...","..."]]}` — 表头点击本地排序（升/降/还原，零往返）；数值感知：千分位（`1,234`）、`k/m/b`、`万/亿`、`%`、货币符号都能按真实数值比较，纯数值列自动右对齐
- keyvalue: `{"type":"keyvalue","pairs":[{"key":"...","value":"..."}]}`
- timeline: `{"type":"timeline","items":[{"title":"...","desc":"...","time":"..."}]}`
- file-tree: `{"type":"file-tree","items":[{"name":"...","type":"file|dir","children":[...]?}]}` — 目录行可点击折叠/展开（本地，零往返）
- breadcrumb: `{"type":"breadcrumb","items":["首页","设置","账户"]}`
- diff: `{"type":"diff","diffs":[{"path":"...","oldText":"..."|null,"newText":"..."}]}`
- json: `{"type":"json","value":...}`（JSON 树查看器）
- code: `{"type":"code","lang":"ts","code":"..."}`
- callout: `{"type":"callout","tone":"info|success|warning|error","title":"...","content":"..."}`
- steps: `{"type":"steps","current":n,"steps":[{"title":"...","desc":"..."}]}`

### 图表
- chart: `{"type":"chart","kind":"bars|line|donut","data":[{"label":"...","value":n,"color":"#hex?"}],"series":[...]?}` — bars 默认；line 趋势；donut 占比；series 字段 = 分组柱状图；负值数据：柱高为 0 但数值标注照显、donut 负值记 0 弧长（line 正常画负区间）
- plot: `{"type":"plot","series":[{"expr":"a*sin(b*x)","label":"...","color":"#hex?","params":[{"name":"a","value":1,"min":0,"max":5,"animateTo":3,"durationMs":4000,"loop":true},{"name":"b","value":1,"min":0.5,"max":5}]}],"xMin":-6.28,"xMax":6.28,"title":"..."}` — SVG 函数图；**series 可带 `"kind":"line|area|scatter"`**（缺省 line；area 填色到基线；scatter 散点）；**params 渲染成实时滑块**（拖动即时重绘，**y 轴锁定**=只变曲线不变数轴）；**animateTo 参数会显示播放按钮**（自动动画演示）；SVG 可拖拽平移、滚轮缩放；表达式支持 sin/cos/tan/asin/acos/atan/sqrt/cbrt/exp/log/ln/abs/floor/ceil/round/min/max/pow，常量 pi/e/tau，变量 x（其他字母=参数）
- echart: `{"type":"echart","title":"...","height":300,"preset":"bar|line|area|pie|scatter","data":[{"label":"...","value":n}],"series":[...]?}` — **ECharts 全功能图表**，视觉效果远超 `chart`（渐变、tooltip、动画、图例交互）；**preset 模式**：用和 `chart` 一样的 `data`/`series` 格式，自动构建主题化的 ECharts 配置（颜色跟随宿主主题）；**full option 模式**：传 `"option":{...}` 直接写 ECharts 原生配置（支持 dataZoom/visualMap/radar/gauge/heatmap 等所有图表类型），option 中的函数会被过滤（只接受数据）；推荐用 echart 替代 chart 获得更好视觉效果

### 交互
**本地优先（v2.6）**：UI 自己能做的状态变化——判卷、判题、重置、展开、选中——一律本地即时完成，**零模型往返**。action 只用于必须模型参与的事（生成新内容、执行工具、下一步建议）。**交互组件必须带 action：不带 action 的按钮渲染为禁用态，用户点不了；带 action 的按钮点击后有「已触发」本地反馈。**
- button: `{"type":"button","label":"...","tone":"primary|danger|success|ghost","full":true?,"small":true?,"icon":"emoji?","action":"refresh"?}`
- **秘密禁令**：不得索取或生成密码、API Key、访问令牌、恢复码等秘密输入；遇到此类需求直接拒绝并解释
- input: `{"type":"input","label":"...","placeholder":"...","inputType":"text|email","value":"...","action":"name"?,"id":"field-id"?}` — action 在失焦**和回车**时触发（回车带 `submit:true`）；**blur 仅值有变化才发送**（聚焦又离开不产生空往返）；payload 带 `id` 帮模型定位字段；带 `id` 的值刷新后保留、并被 submit 收集进 `fields`
- select: `{"type":"select","label":"...","options":["...","..."],"selected":下标?,"action":"pick"?,"id":"field-id"?}` — `selected` 预选某选项（缺省显示「请选择…」占位，不静默预选第一项）；带 `id` 的选择跨刷新保留并进 submit 的 `fields`
- checkbox: `{"type":"checkbox","label":"...","checked":true?,"action":"toggle"?}`
- slider: `{"type":"slider","label":"...","min":0,"max":100,"step":1,"value":n?,"action":"name"?,"id":"field-id"?}` — 数值表单滑块：实时显示数值；带 `id` 跨刷新保留并进 submit 的 `fields`（拖拽经防抖合并成一次 action）
- radio: `{"type":"radio","label":"...","options":["...","..."],"selected":n?,"action":"pick"?}` — 单选；**加 `"group":"题目名"` 进入聚合模式**：选择只本地记录、不发往返；**加 `"answer":正确下标或标签` + `"explanation":"解析"` 后，交卷在本地判卷**
- link: `{"type":"link","label":"...","href":"https://..."?}` — 仅 http(s)/mailto 协议被接受；无 `href` 时渲染为纯文本样式（不会假装可点）
- submit: `{"type":"submit","label":"交卷","action":"grade","groups":["q1","q2","q3"],"resetAction":"redo"?}` — 交卷按钮：**题目带 answer 时点击本地立即判卷**（得分 + 每题 ✓/✗ + 解析，零往返），并锁定题目，点「重新作答」本地重置（`resetAction` 可选通知你）；**只有题目都没带 answer 时才**汇总成一次 `[genui-action]`（payload: `{answers:{q1:选项A,...},fields:{id:值},total,answered}`，`fields` 收集所有带 `id` 的输入）；`groups` 列出的题全部答完才可点
- switch: `{"type":"switch","label":"...","checked":true?,"action":"toggle"?}`
- textarea: `{"type":"textarea","label":"...","placeholder":"...","rows":n?,"value":"...","action":"save"?,"id":"field-id"?}` — action 在失焦和 **Ctrl/Cmd+Enter** 时触发；blur 仅值有变化才发送；带 `id` 的值刷新后保留
- tabs: `{"type":"tabs","tabs":[{"label":"...","items":[...]}]}`
- accordion: `{"type":"accordion","items":[{"title":"...","items":[...]}]}`
- copy: `{"type":"copy","label":"复制","text":"..."}`

**状态持久化（v2.7）**：答案、交卷锁定、输入值按「会话 + 内容指纹」自动保存——用户刷新页面/重开会话，同一块 UI 的状态原样恢复；你重渲染**相同内容**会保留用户状态，渲染**新内容**（换题等）自动从头开始。

**卷子模式（多道选择题）**：每题一个 radio（带唯一 `group` + `answer` + `explanation`），最后放一个 submit（`groups` 列出全部题号）——用户全部选完点交卷，**分数和对错当场在 UI 里出现**，不用等你。只有换新题/进阶建议才发 action。不要每题单独发 action（会刷屏）。

### 高级
- mermaid: `{"type":"mermaid","code":"graph TD\\nA-->B"}` — flowchart/sequence/class/gantt/pie/er/state/journey；主题自动跟随宿主（暗/浅）
- diagram: `{"type":"diagram","kind":"architecture","title":"可选标题","variant":"light|dark|editorial","nodes":[...],"edges":[...],"theme":{...}}` — **编辑级品牌图**（移植自 diagram-design 的 27 种视觉类型）。节点: `{"id":"a","label":"Web","type":"focal|backend|store|external|input|optional|security","x":40,"y":40,"w":128,"h":48,"sub":"可选技术子标签","tag":"可选角标如 API"}`；边: `{"from":"a","to":"b","label":"WRITE","kind":"solid|dashed|accent|link"}`。**规则由渲染器强制**: 正交连接器（r=8 弯折、禁止斜线）、4px 网格、语义 token（paper/ink/muted/accent）、焦点色 ≤2 个、复杂度预算（≤9 节点/≤12 边）、z-order（箭头在节点后）、边标签 6-10px 间隙。27 种 kind：architecture / it-state / flowchart / sequence / state / er / timeline / swimlane / quadrant / radar / loop / nested / tree / org-chart / layers / venn / pyramid / bar / line / gantt / scatter / high-level / process / medallion / data-flow / dp-integration / dp-security-matrix。**坐标类 kind**（architecture/it-state/high-level/process/medallion/data-flow/dp-integration）用 x/y/w/h 精确定位；**规则类 kind** 只给数据自动排版。架构/流程/层次结构优先用 diagram 而非 mermaid（自动布局用 mermaid，编辑级排版用 diagram）。
- scene3d: `{"type":"scene3d","title":"...","meshes":[{"shape":"box|sphere|cone|cylinder|torus","color":"#hex?","size":n|[w,h,d]?,"position":[x,y,z]?,"rotation":[rx,ry,rz]?,"scale":n?|[...]?}],"ambient":0-2?,"background":"#hex?"}` — 3D WebGL，可拖拽旋转、滚轮缩放；mesh 数量 1–5 个
- quiz: `{"type":"quiz","question":"...","options":[{"label":"...","correct":true?,"feedback":"..."?}],"explanation":"...","id":"..."?,"action":"answer"?}` — 教学问答：点选即判题、可重试；`id` 变化时重置；带 action 时另回传 `{type:'quiz',question,answer,correct}`

## 什么时候用：内容类型 → 组件映射

**判断口诀**：这段内容换成结构化组件，会不会比纯文字更好扫、更好懂、更好操作？会 → 就用，**不需要等用户开口要 UI**。

| 你要呈现的内容 | 用这些组件 |
|---|---|
| 关键结论 / 要点罗列（≥2 条） | `list`、`keyvalue`、`callout` |
| 重点强调 / 警告 / 注意事项 | `callout`（info/success/warning/error）、`badge`、`stat` |
| 数据对比 / 趋势 / 占比 | `chart`（bars/line/donut）、`echart`（ECharts 全功能）、`table` |
| 关键指标数字 / 进度状态 | `stat`、`progress`、`badge` |
| 流程 / 步骤 / 阶段 / 时间线 | `steps`、`timeline`、`mermaid`（flowchart/sequence/gantt） |
| 架构 / 系统拓扑 / 数据流 / 品牌图 | `diagram`（编辑级，27 种类型；自动布局需求才用 `mermaid`） |
| 目录 / 文件结构 / 层级关系 | `file-tree`、`mermaid`、`accordion` |
| 状态一览 / 检查结果 | `badge` + `table` + `progress` 组合 |
| 代码 / 配置 / 改动对比 | `code`、`diff`、`json` |
| 图片 / 截图 / 图表预览 | `image` |
| 语音 / 音乐 / AI 视频 / 演示录像 | `audio`、`video` |
| 两个方案 / 选项对比 | `table`、`tabs`、`diff` |
| 教学 / 自测 / 判断题 | `quiz` |
| 数学函数 / 曲线关系 | `plot`（可带参数滑块、动画） |
| 需要用户操作 / 筛选 / 反馈 | `button`、`input`、`select`、`radio`、`switch`、`tabs` |
| 3D 物体 / 空间布局 | `scene3d` |

**别用的情况**：一句话能说清的事、纯闲聊、用户明确说不要 UI、以及"为了炫技硬塞"——组件服务内容，不是内容服务组件。

## 使用规则

1. **围栏放哪，组件就出现在哪** —— 文字在前后自然流动，不要用工具、不要解释"这是一个围栏"。**围栏一闭合就立即渲染**（不等整条回答结束），所以可以边写文字边出组件
2. **组合优先**：复杂界面用 `grid`+`card`+`stat`+`table` 拼，不要追求单一巨型组件
3. **JSON 必须严格合法，发出前完成 4 步自检**：插件**只**修标点级小错（字符串内半角引号、尾随逗号）；**缺括号/错括号等结构错误一律不修**，直接红横幅退化成代码块——写错就重发，别指望兜底。**最容易犯的错：字符串值里用了半角引号 `"`**——中文引语一律写 `“”` 或 `「」`。发出围栏前自检 4 条：① 括号配对：`{` 与 `}`、`[` 与 `]` 数量相等，**收尾序列逐个核对**（长表格最易在最后几行错位：把 `]]}]}` 写成 `]}]}]}`）② 无尾随逗号 ③ 值内引号用中文引号 ④ 最后一个字符必须是 `}`。不要在 JSON 字符串里放 markdown；超长表格/列表拆成多个组件分开发，宁短勿长
4. **不要嵌套围栏**：dsh-ui 里不要再包 ``` 代码围栏
5. **深色主题友好**：配色选深底亮色；UI 主题跟随应用
6. **场景判断**：先查上面的映射表 —— 内容类型命中就上对应组件；只有纯文字问答、一句话能说清时才不用
7. **图表范围**：`plot` 给合理 xMin/xMax（如 -3.14 到 3.14）；3D 场景 mesh 少而精
8. **规格要紧凑**：整棵组件树 ≤200 节点、≤8 层嵌套（超出部分会被渲染器裁掉），避免巨型 spec
9. **一个主题选一个主组件**：命中映射表后选**一种**组件承载，同一信息不要用两种组件重复表达（同一批数据又画 bars 又画 donut = 冗余）
10. **数量纪律**：一条回答 3–8 个组件为宜，宁缺毋滥。反例：该用 `table` 对比时写三段 `text`；一个 `stat` 能说清的事套 `card`+`grid`；与内容无关的 `scene3d` 炫技——3D 只在内容本身就是几何/空间时才用
11. **先验后发（复杂 UI）**：发出 ```dsh-ui 围栏前，若 spec ≥3 个组件或含 `table`（长表格最易括号错位），先调用 `validate_dsh_ui` 工具（参数 `spec` 传围栏内的 JSON 文本）验证；返回 ❌ 就按错误信息（位置、括号计数、常见原因）修正后重新验证，✅ 再发出；**若 ❌ 回复里附了「已自动修复」的 JSON，直接照抄那份发出，无需再验证**；简单 UI（≤2 个组件）不必验证，渲染器会自动修复大部分标点/括号错误
