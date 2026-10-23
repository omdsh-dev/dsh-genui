# GenUI 录屏演示 — 四幕 prompt + 操作指南

> 用途：为 genui 插件 README 录制演示视频。
> 流程：重启 3080 → 硬刷新浏览器 → 按顺序发送下面四幕 prompt（每幕一条消息）→ 全程录屏 → 按"剪辑建议"裁剪。

---

## 准备（每次录屏前）

1. 重启 dsh web（加载 genui 插件与最新渲染器），浏览器硬刷新 Cmd+Shift+R
2. 新建会话
3. 开录：macOS `Cmd+Shift+5`（区域录制）或 ScreenFlow / OBS
4. 建议窗口宽度 1280–1440，深色主题

---

## 第一幕：布局与数据可视化（约 60–90 秒）

> 展示：组件穿插在文字之间、排版系统、数据面板。

```
接下来请为我的插件 README 演示视频输出第一幕内容：主题是「GenUI 布局与数据」。

规则：
1. 用 dsh-ui 围栏输出，组件必须穿插在简短文字之间（每段文字 1-2 句），让 UI 看起来是回答的一部分，而不是工具卡片
2. 顶层 title 用「GenUI · 布局与数据」
3. 按下面顺序完整输出，一个都不能少：
   - text：h1 / h2 / h3 / body / muted / caption 各一个（展示排版层级）
   - 一行 badge（success / warn / danger / accent 四种 tone 各一个）+ 两个 avatar（不同名字）+ 一个 link
   - 一个 grid（3 列）：四个 stat，两个带正 delta、一个带负 delta、一个不带
   - 一个 progress（value 72，valueLabel "72%"）
   - 一个 card（标题「性能指标」）：里面放一个 table（5 行 4 列，数据用真实感数值）+ 一个 keyvalue（4 对）
   - 一个 list（3 项，带 title+desc）
   - 中间穿插 divider
4. 结尾用一句话收束
```

---

## 第二幕：交互组件巡礼（约 90–120 秒）

> 展示：表单、切换、标签页、折叠面板——录屏者逐个点击。

```
继续输出第二幕内容：主题是「GenUI 交互组件」。让观看者能亲手点击。

规则：
1. 用 dsh-ui 围栏，组件穿插在文字之间
2. 顶层 title 用「GenUI · 交互组件」
3. 按顺序输出：
   - tabs：3 个标签页，内容分别是一个表单、一个列表、一个 chart（bars）
   - accordion：3 项（展开项展示一个 json 查看器 + 一个 code 块）
   - 一个「偏好设置」card：switch（自动保存，checked true）+ radio（3 个主题选项）+ checkbox（2 个）+ select（4 个选项）+ input（placeholder 提示）+ textarea（2 行）+ primary button（label「保存设置」）+ ghost button + copy 组件
   - steps（current 2，3 步）+ 一个 callout（info tone）
4. 在 tabs 和偏好设置处用文字提示观看者：「点击标签页切换」「可以打开这些开关试试」
5. 结尾用一句话收束
```

---

## 第三幕：可视化与教学（约 120–180 秒）— 全场高光

> 展示：plot 参数滑块 + 播放动画、quiz 判题、mermaid、3D 场景。

```
继续输出第三幕内容：主题是「GenUI 可视化与教学」。这是最精彩的一幕。

规则：
1. 用 dsh-ui 围栏，组件穿插在文字之间
2. 顶层 title 用「GenUI · 可视化与教学」
3. 按顺序输出：
   - plot 一：两条曲线 a*sin(b*x) 和 0.8*cos(c*x)，xMin -6.28 xMax 6.28，第一条曲线的 a 参数带 animateTo 3 和 durationMs 4000（这样会出现播放按钮），b 和 c 是普通滑块参数，标题「波动叠加」——用文字告诉观看者「拖动滑块试试，或点播放按钮看动画」
   - quiz：两道题（每题 4 个选项 + explanation）。第一题请把正确答案放在选项 B，并在前面用文字提示「选 B 试试」；第二题让观看者故意点一个错误选项，展示判错和「再试一次」
   - mermaid：一个 flowchart（展示 GenUI 渲染管线：模型 → dsh-ui 围栏 → 解析器 → 组件渲染），再一个 gantt（展示插件开发计划）
   - scene3d：一个场景（title「几何演示」），包含 4 个 mesh：旋转的立方体、球体、圆环、圆锥，颜色各异——用文字提示「按住拖拽旋转，滚轮缩放」
   - timeline（4 项）+ file-tree（2 层目录 + 3 个文件）+ breadcrumb
4. 结尾用一句话收束
```

---

## 第四幕：事件循环（约 60–90 秒）— 收尾高光

> 展示：组件 action → 模型响应 → UI 更新。点击后模型会自动回复新的 dsh-ui。

```
继续输出第四幕内容：主题是「GenUI 事件循环」——组件和模型之间的双向互动。

规则：
1. 用 dsh-ui 围栏，顶层 title 用「GenUI · 事件循环」
2. 输出一个「服务器监控面板」card：
   - 四个 stat：CPU 42% / 内存 6.8 GB / 请求数 128.4k / 延迟 87 ms
   - 一个 switch（label「自动刷新」，checked true，带 action "toggle-refresh"）
   - 一个 button（label「刷新数据」，tone primary，带 action "refresh"）
   - 一个 select（label「环境」，选项 staging/production/dev，带 action "env-switch"）
   - 一个 callout（info，内容「点击下面的控件，我会实时响应并更新面板」）
3. 用文字告诉观看者：「点击『刷新数据』，或切换环境，我会重新生成整个面板」
4. 收到我的 [genui-action] 后：每次都用新的 dsh-ui 回应（比如刷新后 CPU 变成 63%、延迟 112ms；切换环境后 stat 数值变化并加一个 success badge「已切换到 production」），用一两句中文说明状态变化，不要输出无关内容
```

---

## 剪辑建议（README demo，目标 60–90 秒精华版）

| 镜头 | 素材 | 时长 |
|---|---|---|
| 开场 | 第一幕前半（流式渲染：组件边生成边出现） | 0:00–0:10 |
| 数据 | 第一幕 stat/table/chart | 0:10–0:20 |
| 交互 | 第二幕 tabs 切换 + 开关/表单点击 | 0:20–0:35 |
| 高光 | 第三幕 plot 滑块拖动 + 播放动画 + quiz 判题 | 0:35–0:55 |
| 高级 | scene3d 拖拽旋转 + mermaid | 0:55–1:10 |
| 收尾 | 第四幕 点击「刷新数据」→ 模型更新面板 | 1:10–1:30 |

节奏提示：
- 拖动 plot 滑块时**放慢**（每秒 1–2 格），这是最出效果的镜头
- 每个组件渲染完、动画停稳后再操作，避免画面抖动
- 事件循环幕点完按钮后等模型回复（10–30 秒），期间不要操作，剪辑时把等待压缩成 1 秒转场
- 如果某幕生成超长，可以中途停止重发，模型会续写

## Map: synthetic location picker

Show a native map with three explicitly synthetic locations around [12.5, 41.9],
a short illustrative inline route, and a persistent field named stop. Keep
marker/list selection local, with a separate Confirm stop submit action. Say
that the default is a blank coordinate map, not a street basemap or directions.
Do not include remote style/tile URLs, credentials, or geolocation requests.
