# Changelog

## [0.8.5] - 2026-08-16
### 发布
- **发布规范对齐 `plugin_check`（issue #15）**：
  - 新增 bundle 源码入口 `src/index.ts`（`import type {}` 先引入 dsh client runtime 的 cordis Context 增广再重导出 `src/plugin/index`，规避 TS 5.9 从根入口进入时全局增广顺序不稳定的类型错误）；tsdown node 入口改为命名入口 `{ index: 'src/index.ts', invariant: 'src/plugin/invariant.ts' }` 并固定 `entryFileNames`，保持发布布局 `lib/index.js` + `lib/invariant.js` 不变；
  - `tsconfig`：`outDir` 改为 `lib`（与 `main` 的 `lib/` 前缀对齐）、新增 `declarationDir: "lib/types"`（类型输出布局不变）、显式 `types: ["node"]`（devDependencies 同步补 `@types/node`，消除隐式 Node 类型依赖）；
  - `files` 增补 `lib`、`src` 目录声明；新增 `scripts.prepack = pnpm run build`，发布 tarball 前强制重建 lib，clean checkout 可复现发布产物。
  - 已知非本仓库可修项：`plugin_check` 的 org-name 政策目前只放行 `@deepseek-ai/*`/`@dsh-external/*`/`dsh-*`，`@omdsh-dev/dsh-genui` 为社区组织公开发布名，保持不变；其 `missing-peer: cordis` 提示基于旧 cordis 键名，本包实际依赖 `@deepseek-ai/cordis@^4.0.1`，不添加幻影 peer。
### 测试
- 全量 373 项（271 passed / 102 skipped）0 失败；`plugin_check` 从 3 errors / 4 warnings 收敛为 1 error / 1 warning（仅剩上述命名政策与旧 peer 键提示）。

## [0.8.4] - 2026-08-16
### 修复
- **genui 与普通代码块共存时整条消息被吞（issue #13）**：同一消息容器里 `dsh-ui` 围栏和 python/ts/bash 等普通代码块共存时，DOM 通道的结构兜底从普通代码块的 `<pre>` 向上回溯，越过它自己的 `.md-code-block` 把共享的 `.markdown` 根容器误判为「dsh-ui 围栏」→ 整条消息 `display:none`、只剩 GenUI，普通代码块丢失。修复两层：① 兜底循环跳过已由已知表面选择器命中的 `<pre>`（这些块已处理，不再向上回溯）；② 标签判定不认领「属于嵌套已知代码块」的 banner（`owner !== block` 即跳过），共享容器不能再通过嵌套围栏的标签自证。未知类名表面的结构兜底能力保持不变（回归测试覆盖：未知表面 + 已知 python 块并存时仍照常渲染）
### 测试
- 275 → 278（+3 issue #13 回归：dsh-ui + python 并存时 dsh-ui 正常接管、python 与共享根容器不被隐藏/接管且无漂移误报；同根两个 dsh-ui 块各自渲染、面板 fold 以第二个为准；未知表面 + 已知 python 块并存时兜底仍生效）

## [0.8.3] - 2026-08-14
### 修复
- **DOM 通道在异形宿主上静默不渲染（issue #6）**：DOM 通道的围栏发现此前依赖单一表面契约——选择器只认 `.md-code-block`，语言标签只认 banner 里的**叶子 `div`**。部分 DSH 0.1.0-rc.6 部署（deepsuite 风格渲染栈）把围栏渲染成 `.code-block` / `.code-block-small`，标签是 `span`，正文还可能被 content div 包裹 → 插件完全找不到围栏：保持代码块、控制台零报错（与报告完全一致）。修复为**多表面发现**：
  - 选择器并集 `.md-code-block, .code-block, .code-block-small`（最外层去重，修饰类子元素不会双计）；
  - **结构兜底**：任何 banner 叶子元素文本恰为 `dsh-ui`（div/span 均可、且必须在 `<pre>` 正文之外——代码体里出现 `dsh-ui` 字面量不得误判）且含 `<pre>` 的元素都会被识别为围栏表面，未知类名的宿主照样渲染；
  - **漂移诊断**：结构兜底命中未知类名时一次性 `console.warn`（`[dsh-genui]` 前缀，每次安装一条），「静默失败」不再可能无迹可查；
  - 已知类名表面保留完整流式能力（按内容流式接管 + 落定标签复核）；未知类名表面在标签出现（落定）后立即渲染，不丢内容。
### 测试
- 268 → 275（+7 多表面回归：`.code-block` 接管（span 标签 + 包裹正文）/`.code-block-small` 接管/未知类名结构兜底 + 漂移告警恰好一次/代码体含 `dsh-ui` 字面量不误判/嵌套修饰类只接管最外层/同行两个异形围栏各自渲染且身份不折叠/异形表面流式接管与落定复核）；370 全绿

## [0.8.2] - 2026-08-14
### 修复
- **页面刷新后面板 dock 冻结（issue #4）**：宿主 anchor key 格式为 `<kindlen>:<kind><id>`（assistant step 的 id 是 `<turn>:<step>`，如 `14:assistant-step3:0`）。DOM 通道 `anchorSeqOf` 旧实现取 key 里**第一个数字 = kind 名称长度常量**（所有 assistant step 都是同一个值）→ 面板 store 的持久化重放屏障（刷新后 replayBarrier = 持久化 maxSeenSeq = 该常量）拒绝一切新 panel 围栏：dock 停在旧快照、`[genui-action]` 还活着、控制台零日志；清 `localStorage['dsh.genui.panel']` 恢复但刷新复发（与报告完全一致）。修复：`anchorSeqOf` 改从 assistant-step key 解析 `<turn>:<step>`，seq = `turn*1000+step`（随消息顺序严格单调，刷新后新消息必然大于持久化屏障）；非 assistant 行 / 无锚点（Safari）行保留文档序兜底。同类隐患一并修复：`/panel` 本地覆盖的 localBarrier 同样依赖该 seq，此前也会冻结后续更新
- **面板静默拒绝可观测（issue #4 建议 3）**：`applyPanelOperation` 的 barrier 拒绝路径加一次性 `console.warn`（`[genui] 面板操作被重放屏障拒绝…`，每 source 每页面会话一条；预算 overflow 后置 append 拒绝仍走既有的 budget 诊断，不重复告警）；`clearSessionPanel` 同步清理 blocked 诊断集
### 测试
- 263 → 266（+3：DOM 通道刷新回归「turn 2/3 面板 → 模拟刷新 → 历史重放保持旧快照 → turn 4 新围栏更新 dock」（旧代码上该测试失败于 `expected '面板B' to be '面板C'`，精确复现报告症状）/同 turn 内 step 单调性；panel-store 屏障拒绝告警一次/条）；363 全绿

## [0.8.1] - 2026-08-14
### 修复
- **Safari 围栏全部静默丢失（issue #1）**：Safari 宿主渲染消息行时不带 `data-chat-anchor-key`（该属性是 React key 派生值，key 为 undefined 时 React 直接不渲染该属性；Chrome 同页 14 个代码块全有锚点、Safari 0 个）→ DOM 通道 `rowOf` 落空 → 每个 `dsh-ui` 围栏在静默 return 点被放弃，控制台零报错。修复：行解析降级链 `[data-chat-anchor-key]` → `[data-chat-flow-key]/[data-chat-flow-kind]`（宿主同一行 div 上的路由属性，kind 与 key 相互独立、可幸存）→ 代码块自身（身份降级为 `dom:unknown:<序数>`，`contextOf` 的 `?? 'unknown'` 分支本就存在）；`fenceIndexOf` 在无行兜底时改按全文档已落定 dsh-ui 块的序数计数，同行兄弟围栏不会撞同一个 `dom:unknown:N`；`anchorSeqOf` 文档序兜底改用联合选择器（锚点行 + flow 行），无锚点行仍得单调 seq 估计。**所有静默 return 点加一次性 `console.warn`（`[dsh-genui]` 前缀，WeakSet 每块一次，1s sweep 不刷屏）**：无锚点降级、落定空体、落定不可修复体各一条诊断
### 测试
- 258 → 263（+5 DOM 通道 Safari 回归：无锚点行渲染/无行直接挂 body/同无锚点行兄弟围栏身份不折叠（面板 fold 以第二个 replace 为准）/无锚点一次告警且锚点行跨 sweep 静默/落定坏体一次告警）；360 全绿

## [0.8.0] - 2026-08-13
### 发布
- **OSS 开源首发**：DSH 正式开源后 `dsh-genui` 随生态开放——仓库迁移至 `omdsh-dev` 组织并公开（topics 保持 `dsh`、`dsh-plugin`）；包名定为 **`@omdsh-dev/dsh-genui`**（与 GitHub 组织 `omdsh-dev` 对齐；`@deepseek-ai` 为官方 scope，第三方插件不再占用），移除 `private: true`，准备公开发布
- **发布前最终改名**：初版 OSS 包名 `@dsh-external/dsh-genui` → **`@omdsh-dev/dsh-genui`**（与仓库组织一致）；运行时硬编码三处（`PACKAGE_NAME`/`ASSET_ROUTE_PATH`/`PLUGIN_ID`）、cordis.patch.yml、README/安装脚本/e2e/测试同步改名，253 测试全绿
- **文档全面转公开**：README/安装脚本/e2e 同步更新——npm 组织尚未创建前以公开 git URL 安装为准，无需 gh/npm 登录或内测资格；双通道渲染描述不再依赖内测快照名
- **peerDeps 对齐 rc.6（0.1.0）+ cordis 4.0.1 稳定版**：8 个 `dsh-*` peer 包 `^0.0.1-rc.1 → ^0.1.0-rc.6`、`@deepseek-ai/cordis` `^4.0.1-rc.1 → ^4.0.1`；代码零改动（运行时值 import 仅 cordis + dsh-client-ui-primitives，其余均 type-only），rc.6 类型下编译与 253 测试全绿；`pnpm-workspace.yaml` 补 63 条 `minimumReleaseAgeExclude`（rc.6 发布未满 pnpm supply-chain 最小年龄，消费者安装必需的白名单）
- **跨机器构建可复现**：CSS Modules 哈希只使用仓库内相对路径，不再混入 `/Users/...` 或 `/home/runner/...`；macOS 与 GitHub Linux 对同一源码生成相同 `lib/client.js`

## [0.7.2] - 2026-08-13
### 发布
- **仓库随 0813 内测收编维持组织内私有**：`dsh-genui` 保持在 `dsh-external` 组织（个人账号迁移已回滚；组织成员可见、对外私有），GitHub topics 补上内测群要求的 `dsh`、`dsh-plugin`（原有 `marisa-plugin`/`web-ui`/`generative-ui` 保留）；README/安装脚本/e2e 中安装与 clone URL、私有仓库前提说明同步更新（私有仓库需 gh 登录）
- **发布渠道红线落地**：package.json 设 `private: true`（`npm/pnpm publish` 被硬拒绝）；npm 上无任何已发布版本（`@deepseek-ai/dsh-genui` / `dsh-genui` 均 404）；分发只走私有 Git URL，不发布 npm/Workshop 等任何公开渠道
### 修复
- **流式渲染回归（0812-final 宿主）**：0812-final 快照移除了 fence-registry 扩展点，插件降级 DOM 通道后只等 `data-streaming` 落定才挂载——dsh-ui 围栏要等整段回复写完才渲染。DOM 通道升级为流式接管：首个完成组件即挂载、正文增长实时重渲染、pre-paint 手术修复（宿主 React 重渲染抹掉外来容器/重置隐藏时在绘制前补回，防原始 JSON 闪回）、settle 转换才带稳定 source 身份发布面板与持久状态；**流式期间宿主不渲染语言标签**（MarkdownText 传 `lang={streaming ? undefined : lang}`），改为按内容识别围栏（partial 解析出 GenUI 组件树即接管），settle 后按标签复核（误识别的其他语言围栏自动还原为代码块）；新增 6 个流式回归测试（流式即挂载/无完成组件保持代码块/面板 settle 后发布/宿主重渲染自愈/空标签内容识别/异语言 settle 还原）

### 新增
- **DOM 渲染通道（纯插件化）**：fence 渲染改为双模——宿主提供 fence-registry 扩展点（契约线）时走原 registry 通道；原版 DSH（无扩展点）时启用 DOM 观察通道：MutationObserver 盯会话内 `.md-code-block`（稳定类名），`[data-streaming]` 落定后按语言标签找到 `dsh-ui` 围栏，解析 JSON 并以插件自有 React 根挂载同一套渲染管线（react-dom/client 平台模块）；原始代码块隐藏保留以承接流式更新，卸载/分支切换自动还原。**零宿主代码改动：原版快照 + 本插件即可用**，同时兼容契约线宿主（自动探测选择）
- **动作上下文插件本地化**：`GenuiActionContext`/`useGenuiAction` 不再依赖宿主导出（原版无此导出）——宿主提供时沿用宿主上下文实例（MarkdownText 注入的 sendGenuiAction 无缝到达），否则回退插件本地上下文；DOM 通道以 `ctx.sessions.scope().get('conversation').send()` 转发 `[genui-action]`（与宿主版消息模板逐字一致）
- **DOM 通道稳定身份**：sourceId = `dom:<data-chat-anchor-key>:<围栏序数>`，order 取锚点键数字段（缺省按行序），面板去重与 durable state 键在无宿主 context 时依旧稳定
### 修改
- fence 渲染管线抽到 `src/client/fence-render.tsx`（registry 与 DOM 两通道共用）；renderGenuiFence 语义不变（不可修复体仍渲染 FenceFallback）
- tsdown externals 增加 `react-dom/client`（平台模块表已有，零体积）
- vitest 别名修正 `dsh-invariants` → `packages/runtime-diagnostics/invariants`（0812-final 线路径）
### 测试
- 355 全绿（+13 DOM 通道：挂载/语言过滤/落定门控/坏体保块/动作转发(300ms 防抖)/panel 发布/卸载还原/无会话渲染 + 6 个流式回归）；registry 通道测试经 setup 特征门控在两条宿主线上均可运行


## [0.7.1] - 2026-08-13
### 修改
- **适配 0812 宿主契约线**：/panel 斜杠命令源从 `ctx.slash`（ui-slash，0812 线上已移除）迁到 `ctx.inputTriggers`（ui-input-trigger 的 `InputTriggerSource`：candidates(session, req) / onPick(pick) / matchEnter(session, line, signal) / submit(args, actx)）；client inject 同步改为 `['slots','sessions','inputTriggers']`
- **tsconfig 宿主类型路径**：`dsh-invariants` → `packages/runtime-diagnostics/invariants`，ui-slash 类型路径 → `packages/client/ui-input-trigger`

### 修复
- **mermaid 管道边标签含方括号解析失败**：`-->|文本 [x]|` 的 `[` `]` 会被当节点语法 → Parse error → 降级显示源码（实测案例 `-->|6. 用户交互 → [genui-action]|`）。`repairMermaidSource` 新增 pipe 标签掩码 + 引号化（`|"文本 [x]"|`，渲染时不显示引号）；已引号、无方括号、节点标签内的管道字符均不受影响


## [0.7.0] - 2026-08-13
### 新增
- **图表 hover 提示**：柱状图/分组柱（title 属性带系列名+数值）、环图与折线图（SVG `<title>` 元素）——悬停可见精确值，零依赖
- **validate_dsh_ui 返回修复版 JSON**：坏 JSON 可修复时（引号/尾随逗号/缺失闭合符），❌ 回复直接附上自动修复后的正文，模型照抄即可，不再手重写（重写是下一个错别字的来源）；fence-repair 逻辑抽到共享模块 src/shared/fence-repair.ts，node 工具与客户端渲染器共用同一实现；tier-2 扫描改为单次统一修复（此前 tier-1 部分修复成果在整体解析失败时被丢弃，叠加缺陷无法合并修复）
- **slider 表单节点**：数值滑块（min/max/step/value/label），带 `id` 跨刷新持久化并进 submit 的 `fields` 收集；拖拽经防抖合并成一次 action；提示词与 SKILL 同步
- **表格本地排序**：表头点击 升序 → 降序 → 还原（数值感知比较 + aria-sort 状态），local-first 零往返
- **plot 系列画法**：series 支持 `kind: line|area|scatter`——area 填色到基线、scatter 散点；提示词与 SKILL 同步
- **面板跨重启持久化**：面板快照 + /panel 本地覆盖持久化到 localStorage（每会话条目、LRU 上限 50），刷新/重开会话秒级恢复、/panel clear 永久生效
- **资产空闲预取**：boot 时注入 `<link rel=prefetch>` 低优先级预取 mermaid/three 资产，首个图通常命中热缓存

### 修复
- **历史滚动重放重复折叠**：被后续 replace 裁掉的旧 append，在滚动历史重新挂载卡片时会再次合并进面板——新增 seen 去重注册表（所有处理过的 sourceId 幂等），并引入持久化重放 barrier（水合后 ≤ 持久化 maxSeenSeq 的旧重放一律死）
- **tier-1/tier-2 组合缺陷不可修复**：尾随逗号 + 缺闭合符并存的坏体此前修不好，统一扫描后一次修复

### 修改
- **GenuiBlock 按族拆分**：1,620 行单文件拆为 blocks/{state,basic,charts,forms,advanced,render-node} + 薄壳 GenuiBlock（状态/防抖/持久化），类型循环通过 state 模块打破，行为零变化（全量测试保绿）
- 提示词与 SKILL 同步 slider/plot kind/表格排序/验证器修复版语义

### 测试
- 315 → 335（+20）：图表提示、slider 三态、表格排序三态、plot 三种画法、预取幂等、validate 修复版返回、面板持久化/水合/重放 barrier、消费后重放不再折叠

## [0.6.0] - 2026-08-13
### 修复
- **SKILL.md frontmatter 从安装起就解析失败**：description 里含 `: ` 序列（`charts: callouts`、`prose: 要点`），被宿主 yaml 解析器判为紧凑嵌套映射 → 技能被 skill-local 静默忽略 → 会话技能目录从不显示 genui、`skill` 工具一直报 "unknown or no longer available"。修复：description 加 YAML 双引号。技能目录是每步活刷新的（digest 机制），修复即刻生效无需重启。新增 `tests/skill-md.spec.ts` 用宿主同款 yaml 解析器钉住 frontmatter，杜绝静默回归。UI 围栏此前一直正常是因为它走系统提示词注入通道（genui:fence section），与技能目录是两条独立通道
- install.sh 技能同步改为双根（`$DSH_HOME/skills` + `$AGENTS_HOME/skills`，AGENTS_HOME 默认 `~/.agents`），沿用七类目标状态安全判定；新增对应测试

### 新增
- **客户端分包（体积 -98%）**：mermaid 与 three.js 引擎不再内联进 client.js——它们单独构建为 `lib/assets/mermaid.js` / `lib/assets/three.js` IIFE（各自注册到 `window.__GenuiAssets__`），首次用到时按需加载；插件 node 端经可选探针（同 tools 注册模式）向宿主 webserver 注册自有资产路由 `/plugins/<id>/assets/*`（最长前缀胜过通用 `/plugins` 路由，无需改宿主源码；文件名白名单 + 无路径穿越）。全部浏览器产物开启 minify（宿主无 gzip）。client.js：9.04 MB → 109 KB（gzip 1.72 MB → 28 KB）；mermaid 资产 3.4 MB / three 资产 700 KB 仅按需下载。旧宿主无资产路由时优雅降级（mermaid 显示源码、scene3d 显示加载失败）
- **系统提示词瘦身（-47%）**：注入每个会话的组件目录从 10,928 字符压到 5,823（去重 radio 行、低频组件并行为一行、规则合并；全部 38 个 type 与关键字段保留，次要字段经实测后补回内联——skill 指针只作增益、不再是负载点）
- **select 补齐表单语义**：新增 `id`（跨刷新持久化 + 进 submit `fields` 收集）与 `selected`（预选下标；缺省显示「请选择…」占位，不静默预选第一项）；action payload 带 `id`
- **link 诚实渲染**：新增白名单 `href`（仅 http(s)/mailto）渲染为真实锚点（target=_blank + noopener）；无 href 渲染为纯文本样式——消灭「假按钮」同类问题
- **file-tree 本地折叠**：目录行可点击折叠/展开（aria-expanded、零模型往返），兑现 spec 文档承诺
- **input/textarea 防空提交**：blur 仅当值自上次投递后变化才发 action（聚焦即离开不再产生空往返）；action payload 附带字段 `id` 帮助模型定位

### 修改
- **流式重渲染削减**：GenuiBlock memo 增加结构相等比较器——流式 chunk 重解析产生的「内容未变的新对象」不再触发整树重渲染（≤200 节点围栏流式期间最多一次实质性渲染）
- **会话内存清理**：dock 组件卸载（宿主剪除会话 scope）时清空该会话的面板快照/操作表/溢出诊断/展开令牌，长期运行不再按会话数增长
- **负值图表钳制**：柱状/分组柱负值渲染零高柱（数值标注照显）、环图负值记零弧（此前非法 strokeDasharray 画出整圆）；line 正常画负区间
- **mermaid 主题跟随宿主**：按 `document.documentElement.style.colorScheme` 选 dark/neutral，浅色主题不再显示深色图
- **scene3d 容器自适应**：ResizeObserver 同步面板/窗口尺寸变化，事件驱动渲染（静止零开销）不变
- **调色板令牌迁移收尾**：PlotBlock 系列色从 v1 硬编码 hex 迁到宿主 `--dsw-static-*` 令牌（设计 v2 漏掉的一处）
- **节点计数统一**：render_ui / validate_dsh_ui 的「N 个组件」改走 guard 共享遍历（tabs/accordion/file-tree 子节点计入，与面板折叠一致）
- **括号诊断方向修正**：validate_dsh_ui 的括号计数提示按差值符号说「缺/多」（此前一律说「多」）

### 安全
- **颜色字段格式白名单**：avatar/chart/plot/mesh/scene 背景的 `color` 只接受 hex/rgb/hsl/`var(--dsw-*)`——`url(...)`、`javascript:` 等任意 CSS 值被丢弃并降级默认调色板（堵住经背景图外带数据的通道）

### 测试
- 新增 24 项测试（315 全绿）：memo 比较器、select 三态（占位/预选/收集）、link 锚点与降级、file-tree 折叠、负值图表、blur 防空提交（input/textarea/Enter 路径）、颜色白名单、括号诊断方向、tabs 内节点计数、面板会话清理、asset-loader（rev 解析/记忆化/失败路径）

## [Unreleased]
### 新增
- 新增 validate_dsh_ui 工具：模型发出 ```dsh-ui 围栏前可先调用它验证 JSON（纯本地，零 LLM/网络）；失败时返回精确位置、括号计数诊断与常见原因，修正后重验再发——从源头把坏围栏挡在渲染之前。SKILL.md 规则 11 + 宿主 Rules 同步提示：≥3 个组件或含 table 的复杂 UI 先验后发，简单 UI 不必（避免每 UI 一次往返的开销）
### 修复
- dsh-ui 围栏 Tier-2 结构修复盲区：此前只「追加缺失的闭合符」，遇到错位/多余闭合符（典型如行数组的 `]` 被写成 `}`，收尾 `"]}]}]}`）会原样保留、修复失败并弹红色解析失败横幅；现在跳过与开放栈不匹配的闭合符，仅当整体可解析时采纳。新增回归测试（含真实 654 字符坏样本）
- dsh-ui 围栏修复后静默渲染：Tier-1/Tier-2 或 guard 修复成功并渲染后，不再显示黄色「已自动补全/已修复」提示（用户只应看到正确的 UI 或红色报错横幅，不需要被告知补全过程）

## [0.5.1] - 2026-08-12
### 修复
- mermaid 图渲染：修复渲染容器游离导致 flowchart/graph 必然降级的问题——mermaid ≥ 11.16 绘制流程图时经 `document.body` 查找图元素，游离容器渲染必抛 TypeError。临时容器改为离屏挂载到 DOM（不可用 `display:none`，会破坏 dagre 文本测量）；标签自动修复不再给边标签加引号（此前 `H -- 否(流式中) --> J` 会被改坏为 `H -- 否("流式中") --> J`，修复后反而解析失败）
- dsh-ui 围栏 JSON 容错：新增两级自动修复——Tier-1（字符串内未转义半角引号、尾随逗号）流式中即可安全应用，仅当整体可解析时采纳；Tier-2（缺失引号/括号的结构补全）仅对已结束消息生效，流式半截不会被误采纳；修复成功时提示修复数量

## [0.5.0] - 2026-08-12
### 新增（设计系统 v2）
- 令牌层：`.block` 上收敛出五套刻度，全部组件样式经令牌解析——字号（display 24 / h1 20 / h2 16 / h3·body 14 / title 13 / meta 12 / data 11，消灭 9/10/11.5px 等 17 个散值）、间隙（4/8/12/16）、圆角（surface 12 / control 8 / pill 999，消灭 3/6/7/14px 杂值）、色调浓度（统一 8% 弱 / 14% 强两档）、边框与等宽字体单一来源
- 围栏保持透明 inline：`.block` 不设画布/边框/内边距，表面只存在于组件自身（card/quiz/plot/accordion）；「整块围栏套大卡片」的方案已尝试并否决——单个 stat 或文本节点不需要卡片包裹；会话面板 dock 圆角保持 14px
- 图表骨架：柱状图/分组柱状图补基线 + 25/50/75% 网格线，分类标签移出绘图区独立成行（不再压线），分组柱逐根显示数值；折线图补 Y 轴四条刻度线与刻度值；数值标注统一 11px 等宽
- 调色板单一来源：图表与头像调色板改用宿主 `--dsw-static-*` 令牌（deepseek/green/amber/red/blue 族），不再自造与主题脱节的 hex

### 修改
- 正文 13.5→14px 并对齐宿主 markdown 阅读字号；`text.body` 从次级色升为主色；h1 24→20px（会话内不再像文档标题）；caption 去掉对中文无效的 uppercase
- 全量字号/间距/圆角/色调浓度按刻度归一（按钮、输入、表格、徽章、步骤、时间线、quiz、callout 等 40+ 规则）
- 表格：表头去 uppercase、12px/600，单元格 13px；根 gap 默认 14→16；grid 列改为 `minmax(0,1fr)` 防窄列塌缩
- 等宽字体统一 `--ds-font-family-code`（修掉宿主不存在的 `--dsw-font-mono`）

### 修复
- 浅色主题会话面板徽章对比度：硬编码 `#7ba8ff`（≈2.4:1 不达 AA）改为语义令牌自适应（浅色 deepseek-500 ≈5.7:1、暗色 deepseek-400）
- 图表单系列与多系列同屏色值不一致（柱用令牌蓝、环用自造蓝）已消除
- 分组柱条形高度上限 82%/85%，数值标注不再溢出绘图区

## [0.4.0] - 2026-08-12
### 新增
- 面板操作模型：每个来源（围栏/工具结果）带稳定身份与三段顺序进入会话级操作表——不同消息即使局部 key 相同也各追加一次；重放/StrictMode 幂等；乱序到达按真实顺序折叠；`/panel` 变为本地覆盖（默认面板或清空 + 屏障），旧历史重放无法复活面板
- 面板规模边界：整面板默认最多 200 节点 / 200 条追加（可注入调整），超限以 replace 恢复并给出诊断
- 面板、工具卡与内联 UI 的持久化身份改为「会话 + 稳定来源 + 内容指纹」，新内容不再继承旧状态
- 输入法保护：input 回车 / textarea Ctrl/Cmd+Enter 带三层组合态判定（composition ref + 10ms 延迟 + isComposing/229），选词回车不再误提交
- 单次前向扫描的 partial 解析：病态输入从秒级降为毫秒级，解析尝试有界
- scene3d 改为事件驱动渲染：静止零动画帧，拖拽/滚轮才重绘；拖拽走 pointer capture
- 确定构建：CSS 类名固定排序 + 关闭 sourcemap，同源码重复构建产物 SHA 一致；tsdown 直接从 src 构建、tsc 只产声明
- 安装脚本文件安全边界：skill 同步按目标六类状态处理（原子替换/同文件链接跳过/异文件与悬空链接安全失败），profile 参数校验，路径经环境变量传递

### 修改
- 表单：tabs 内 grouped radio/字段/submit 与根层行为一致；答案状态简化为纯字符串表；空字段离开共享注册表、默认值挂载即注册、submit 统一按已填字段计算
- 按钮本地反馈文案由「已响应」改为「已触发」（只证明本地事件触发）
- 依赖归类：图表/3D 引擎（已内联）与 react-dom 移入 devDependencies，安装不再额外下载
- 发布包白名单：不再包含 src/、sourcemap 与中间 JS（压缩约 1.7 MB、解包约 8.7 MB），并新增 `scripts/verify-pack.mjs` 门禁

### 修复
- 面板追加 A→B→A 重放不再重复合并；同消息两个围栏按文本块/围栏顺序折叠而非 effect 顺序
- 同一超限来源只产生一次诊断
- 面板拖拽/3D 不再注册 window 级指针监听，卸载无残留
- 安装脚本在插件 checkout 内运行时不再解析到自身（node self-reference）

### 安全
- 密码输入保持打码渲染，但值不持久化、不进 submit 收集，刷新即清空；教学面禁止索取密码、API Key、访问令牌、恢复码等秘密

## [0.3.5] - 2026-08-12

### 兼容（适配 0811 快照）
- **cordis 改名迁移**：0811 快照把 `cordis` 包重命名为 `@deepseek-ai/cordis`（4.0.1-rc.1）。插件全部 4 处 import、peerDependencies、tsconfig paths、tsdown EXTERNALS、vitest alias 同步迁移——host 侧 `Context` 现在与核心同源，避免双 cordis 实例导致的注入器不匹配
- 验证：tsc + 208 测试 + tsdown 全绿（测试直接 alias 到 0811 的 vendor/cordis 与 ui-primitives 源码），主 GUI（0811）已加载重建 bundle

## [0.3.4] - 2026-08-11

### 新增
- **fence 解析失败诊断条（根治静默退化）**：`dsh-ui` 围栏在消息结束后仍无法解析为 JSON 时，渲染器显示「⚠️ dsh-ui fence JSON 解析失败（含位置）」红色诊断条，原始内容保留在下方代码块——作者一眼可见缺陷，不再无声变成代码块；流式输出中的 partial JSON 不误报（按宿主 `[data-streaming]` 标记判定已结束）

## [0.3.3] - 2026-08-11

### 新增
- **状态持久化（v2.7，刷新/重开不丢）**：交互状态（radio 答案、交卷锁定、带 `id` 的输入值）按「会话 + 块位置 + 内容指纹」存 localStorage——刷新页面、重开会话后同一块 UI 的状态原样恢复；重渲染相同内容（seed 回填）保留用户状态，渲染新内容（换题）自动从头开始；单键存储、200 块 LRU 上限、防抖 300ms 落盘
- **表单回车提交**：`input` 回车 / `textarea` Ctrl+Enter 立即触发 action（payload 带 `submit:true`），不再依赖失焦；`input`/`textarea` 改为受控组件（值可追踪）
- **字段收集**：`input`/`textarea` 新增可选 `id`——带 id 的值进入 submit 的 `fields:{id:value}` 收集（纯表单 = 多个输入 + 一个 submit 提交）；无 group 时 submit 按「任一答案或字段已填」启用
- 系统提示词与 SKILL 同步「持久化」规则（相同内容=保留状态，新内容=重置）

### 修复
- 修复「重置后恢复状态被覆盖」：round 复位 effect 跳过首次挂载，恢复的答案/勾选不再被清掉

### 兼容
- 全部为可选字段：无 `stateKey`/`id` 时行为与 0.3.2 完全一致（旧围栏不持久化，行为不变）
- 测试新增 10 个（store 单测/刷新恢复/内容隔离/重置清空/Enter 提交/fields 收集），全套 199 通过

## [0.3.2] - 2026-08-11

### 新增
- **本地判卷（v2.6，零往返）**：`radio` 新增 `answer`（正确选项下标或标签）+ `explanation`（解析）——带答案的卷子点 `submit` 交卷时**当场本地判卷**：得分、每题 ✓/✗、正确答案、解析全部立即出现在 UI 里，不发模型、不等生成；判卷后题目锁定，点「重新作答」本地重置（可选 `resetAction` 通知模型）。题目没带答案时才退回 v2.5 的聚合 action
- **本地优先原则**：系统提示词与 SKILL 明确——UI 自己能完成的状态变化（判卷、判题、重置、展开、选中）一律本地即时完成，action 只用于必须模型参与的事
- **按钮本地点击反馈**：带 action 的按钮点击后立即显示「✓ 已响应」徽标（1.4s 后消失），模型往返期间用户也能看到点击被接收
- **修复默认选中吞答案**：`radio` 不再默认预选第一项（除非模型显式 `selected`），避免「保持默认即未作答」的静默丢失；模型给了 `selected` 时作为初始答案立即注册
- **重置完整复位**：重新作答同时清空 radio 本地选中态（round 机制），避免上一轮的勾选残留导致 change 事件不触发

### 修复
- guard：`answer` 越界下标从「钳位」改为「丢弃」（钳位会静默判错选项）

### 兼容
- 全部为可选字段：旧 spec 零改动；无 `answer` 数据的 submit 行为与 0.3.1 完全一致
- 测试新增 11 个（本地判卷/锁定/重置/离线判卷/按钮反馈/守卫），全套 189 通过

## [0.3.1] - 2026-08-11

### 新增
- **`submit` 交卷组件（v2.5）**：`{"type":"submit","label":"交卷","action":"grade","groups":["q1","q2"]}` —— 配合带 `group` 的 `radio` 聚合作答：用户在本地答完所有题后点一次交卷，模型一次性收到 `{answers:{题目:选项,...},total,answered}`，不再逐题刷往返；`groups` 列出的题未答完时按钮禁用，旁侧显示「已选 n/m」进度
- **`radio` 聚合模式**：`radio` 增加可选 `group` 字段——设置后选择只本地记录、不发逐次 action（兼容旧行为：不带 `group` 仍逐次回传）
- **`quiz` / `textarea` 支持 `action`**：`quiz` 作答时回传 `{type:'quiz',question,answer,correct}`（本地判题不变）；`textarea` 失焦时回传 `{type:'textarea',value}`
- **诚实交互（消灭假按钮）**：不带 `action` 的按钮渲染为禁用态（`disabled` + 置灰 + `not-allowed` 光标），不再出现"看着能点、点了没反应"的控件；系统提示词同步强调"交互组件必须带 action"

### 修复
- 按钮 hover 样式改为 `:not(:disabled)`，禁用态不再有高亮/悬停反馈

### 兼容
- 全部为可选字段：旧 spec 零改动；`radio` 不带 `group` 时行为与 0.3.0 完全一致
- 测试新增 14 个（v2.5 交互 + 守卫），全套 178 通过

## [0.3.0] - 2026-08-11

### 新增
- **`/panel` 会话面板命令**：slash 命令客户端直开面板（默认组件总览）；`/panel <指令>` 把指令转发给模型定制面板内容（指令不再被命令吞掉）；`/panel clear` 清空收起；面板 dock 收到命令自动展开
- **面板增量追加**：`panel: true` 围栏携带 `append: true` 时按标签页合并进现有面板——同名标签页内容追加、新标签页新增、普通内容追加到尾部；面板可无限累积，不再受单条消息传输大小限制；按 fence key 幂等去重（同一围栏只合并一次）
- **面板高度拖拽**：展开态拖拽面板顶边框调高（120–600px），自定义高度跨折叠/展开保留
- **表格横向滚动**：宽表格在容器内横向滚动（overscroll 约束），不再撑破面板/消息流

### 修复
- **render_ui 工具参数桥接兼容**：`specOf` 递归解包 harness 桥接层的所有参数形态（`{spec:对象}`、`{spec:"<JSON>"}`、`{arguments:包装}`、裸字符串、内层嵌套 spec 键）——此前小参数被包装成错误形状、工具行面板整体不可用；损坏 JSON 现在输出 `[genui-tool]` 诊断日志并给出明确错误
- **mermaid 错误图上屏**：`suppressErrorRendering` + 私有容器渲染——语法错误不再以 "Syntax error in text / mermaid version…" 错误图形式直接显示在页面上，统一走源码降级提示
- **mermaid 自动修复重试**：渲染失败后自动修复常见模型笔误再试一次——剥标签内反引号、引号化中文/空格标签、剥离 `<br/>`；修复成功则正常显示，仍失败才降级源码
- **测试环境**：jsdom PointerEvent polyfill，支持面板拖拽等指针交互测试
- **适配 0810 snapshot 的 `dsh.client` 声明契约**：浏览器端声明从顶层 `dshClient` 迁移到 `dsh.client` 子字段——新版 client-modules 只读取 `dsh.client`，旧字段被静默跳过，导致渲染器不进 boot 图、`/plugins/@deepseek-ai/dsh-genui/client.js` 404、页面上所有 `dsh-ui` 围栏退化为代码块；同批修复 dsh-annotation、better-sidebar 等 5 个插件同款问题

### 兼容
- spec 新增可选 `append` 字段（仅 `panel: true` 时生效），旧 spec 不受影响

## [0.2.2] - 2026-08-10

### 安全
- **mermaid 出口检查**：渲染出的 SVG 上屏前再验一次货——含 `<script>`、`on*` 事件属性或 `javascript:` URI 一律拒绝并回退源码块（入口 kind 白名单之外的第二道防线；mermaid strict 模式之外的最后兜底），新增 5 个测试锁死该门

### 优化
- **组件选择规则**：系统提示词新增「一个主题选一种主组件」决策表（结论→callout、指标→stat、对比→table、趋势→line、占比→donut、流程→steps 等）；SKILL.md 新增数量纪律与反例（同一数据不重复表达、3–8 个组件、3D 仅在内容本身是几何时用）

## [0.2.1] - 2026-08-10

### 优化
- **主动触发**：系统提示的 fence 规范新增 Trigger 规则——要点、强调、对比、流程、步骤、状态、数据、演示等结构化场景应主动用 UI，无需用户开口要图表；纯文字问答保持 prose
- **SKILL.md 路由拓宽**：description 从"可视化专用"改为"结构化呈现通用"；新增「内容类型 → 组件」映射表（要点→list/callout、强调→callout/badge、流程→steps/timeline/mermaid、对比→table/tabs、状态→badge/progress 等）

## [0.2.0] - 2026-08-09

### 修复
- **渲染错误边界**：任一 GenUI 块（fence / 工具卡片 / 面板）渲染异常时降级为内联提示，不再拖垮整个聊天界面（issue #2 白屏事故的根因已在主仓修复：默认分支更新至 fence-registry commit 47d230e）
- 安装说明改为 git URL 方式（`link:` 装干净 clone 会漏装 mermaid/three/react 依赖）

### 新增
- `scripts/install.sh`：一键安装（自检 dsh / pnpm / GitHub 凭据 → 安装 → 提示重启）
- `scripts/e2e.mjs`：真机 e2e（临时 dsh web + 插件 → 模型输出 fence → 渲染 → action 回传 → 模型响应）
- GitHub Actions CI（tsc + 135 测试 + 构建 + lib 与 src 一致性校验）
- README 顶部「dsh 版本要求」警示（需 fence-registry ≥ 47d230e）

## [0.1.1] - 2026-08-09

- panel 停靠（collapsible dock）、panel-only fence、spec 守卫、render_ui 工具通道、quiz/a11y/防抖加固、画廊全词汇
