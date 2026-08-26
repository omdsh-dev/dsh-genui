/**
 * templates.ts — GenUI 模板中心数据（0.9.4）。
 *
 * 每个模板 = 一段自然语言 `instruction`（试用时插入输入框，模型按 genui
 * skill 生成对应界面）+ 一份**合法**的 `demo` spec（预览时由 GenuiBlock
 * 直接渲染，用户先看到效果再决定试用）。字段对齐 spec.ts / guard.ts 的
 * 实际 schema（tests/templates.spec.ts 用 validateGenuiSpec 逐条校验）。
 *
 * 模板即说明书：覆盖布局/数据/图表/交互/测验/高级各能力面。
 */
import type { GenuiSpec } from './spec.ts'

export interface GenuiTemplate {
  id: string
  category: '仪表盘' | '数据' | '流程' | '图表' | '交互' | '测验' | '高级'
  name: string
  description: string
  /** 试用时插入输入框的自然语言指令。 */
  instruction: string
  /** 预览用的合法 spec（≤200 节点、嵌套 ≤8 层）。 */
  demo: GenuiSpec
}

export const GENUI_TEMPLATES: readonly GenuiTemplate[] = [
  {
    id: 'tpl-dashboard',
    category: '仪表盘',
    name: '项目仪表盘',
    description: '一张卡片汇总核心指标：数字 + 环比 + 进度条，决策一眼可见。',
    instruction: '请用 dsh-ui 给当前项目做一个仪表盘：4 个关键指标的 stat 卡片（带环比 delta）、整体进度 progress 条、今天的 3 件待办 list。标题用「项目仪表盘」。',
    demo: {
      title: '项目仪表盘（示例）',
      gap: 12,
      items: [
        { type: 'card', title: '本周关键指标', items: [
          { type: 'grid', cols: 2, items: [
            { type: 'stat', label: '本周完成', value: '12 / 18', delta: '+4' },
            { type: 'stat', label: '阻塞事项', value: '2', delta: '-1' },
            { type: 'stat', label: '平均耗时', value: '3.2h', delta: '-8%' },
            { type: 'stat', label: '覆盖率', value: '86%' },
          ] },
        ] },
        { type: 'card', title: '整体进度', items: [
          { type: 'progress', label: 'v1.0 里程碑', value: 68, valueLabel: '68 / 100' },
        ] },
        { type: 'card', title: '今日待办', items: [
          { type: 'list', items: ['评审 M1 模板中心 PR', '同步 vendor 到 SSiD', '周三周会材料'] },
        ] },
      ],
    },
  },
  {
    id: 'tpl-compare',
    category: '数据',
    name: '方案对比表',
    description: '多方案逐维度对照，表格直接可读，争议点一目了然。',
    instruction: '请用 dsh-ui 把以下方案的对比做成一张 table：方案 A/B/C × 维度（成本/复杂度/风险/收益），列首高亮推荐项；顶部加一行 callout 说明结论。',
    demo: {
      title: '方案对比（示例）',
      items: [
        { type: 'callout', tone: 'info', title: '结论', content: '方案 B 综合最优：成本中、复杂度低、风险低。' },
        { type: 'table', columns: ['维度', '方案 A', '方案 B ★', '方案 C'], rows: [
          ['成本', '高', '中', '低'],
          ['复杂度', '高', '中', '低'],
          ['风险', '低', '低', '高'],
          ['收益', '大', '中', '小'],
        ] },
      ],
    },
  },
  {
    id: 'tpl-steps',
    category: '流程',
    name: '五步上手流程',
    description: '关键步骤排成时间线，每步一句要点，适合教程/交接/发布流程。',
    instruction: '请用 dsh-ui 把操作步骤做成 steps 教程：5 步（按实际流程），每步标题 + 一两句要点，顶部用 badge 标出预计耗时。',
    demo: {
      title: '上手流程（示例）',
      items: [
        { type: 'badge', label: '约 5 分钟', tone: 'accent' },
        { type: 'steps', current: 2, steps: [
          { title: '安装插件', desc: '从插件中心安装，或 npm 安装到 profile' },
          { title: '发送第一条指令', desc: '让模型用 dsh-ui 输出一个界面' },
          { title: '体验交互', desc: '点按钮/判卷/切 tab，动作会回传模型' },
          { title: '常驻面板', desc: '模型用 panel:true 把结果钉在会话面板' },
          { title: '进阶组件', desc: '图表/流程/3D 按需懒加载' },
        ] },
      ],
    },
  },
  {
    id: 'tpl-quiz',
    category: '测验',
    name: '随堂测验',
    description: '一题一答即时判卷：选中即知对错，附讲解，适合培训问答。',
    instruction: '请用 dsh-ui 出 3 道随堂测验（quiz 组件：question + options，其中一项 correct，附 explanation），标题「随堂测验」，每题即选即评。',
    demo: {
      title: '随堂测验（示例）',
      gap: 10,
      items: [
        { type: 'text', content: '选中即判卷并显示讲解。', size: 'muted' },
        { type: 'quiz', id: 'q-dsh', question: 'DSH 插件的最小单位是？', options: [
          { label: '服务' },
          { label: '插件（cordis 插件）', correct: true, feedback: '✓ 一切皆插件：服务、工具、UI 都通过插件注册。' },
          { label: '工具' },
        ], explanation: 'DSH 基于 cordis，任何能力（含服务与工具）都以插件形式注册。' },
        { type: 'quiz', id: 'q-fence', question: 'dsh-ui 围栏由谁输出？', options: [
          { label: '用户' },
          { label: '模型', correct: true, feedback: '✓ 模型在回复中输出 dsh-ui fence。' },
          { label: '宿主' },
        ], explanation: '模型输出 fence，渲染器将其画成真实组件。' },
        { type: 'quiz', id: 'q-panel', question: 'panel:true 的围栏渲染到哪里？', options: [
          { label: '消息流' },
          { label: '会话面板 dock', correct: true, feedback: '✓ 面板更新不刷屏。' },
          { label: '设置页' },
        ] },
      ],
    },
  },
  {
    id: 'tpl-stats',
    category: '数据',
    name: '关键值 + 进度',
    description: '一次交付：数值、进度、里程碑三件套，周报/复盘通用。',
    instruction: '请用 dsh-ui 总结本周关键数据：keyvalue 列 3 组关键值、两根 progress 进度（计划 vs 实际）、timeline 放 3 个里程碑，标题「周报速览」。',
    demo: {
      title: '周报速览（示例）',
      items: [
        { type: 'keyvalue', pairs: [
          { key: '完成项', value: '12' },
          { key: '延期', value: '1' },
          { key: '风险', value: '2（均已有缓解）' },
        ] },
        { type: 'progress', label: '计划进度', value: 75, valueLabel: '75%' },
        { type: 'progress', label: '实际进度', value: 82, valueLabel: '82%' },
        { type: 'timeline', items: [
          { title: '周一', desc: '完成 M1 开发', time: '08-25' },
          { title: '周三', desc: '全链路验证通过', time: '08-27' },
          { title: '周五', desc: '发布 0.9.4', time: '08-29' },
        ] },
      ],
    },
  },
  {
    id: 'tpl-chart',
    category: '图表',
    name: '趋势柱状图',
    description: '数据直接画成柱状图，多序列对比，走势一眼看清。',
    instruction: '请用 dsh-ui 把下列数据画成 chart（bars，多序列）：近 6 周完成量 vs 计划量；图表上方给一句趋势结论。',
    demo: {
      title: '趋势对比（示例）',
      items: [
        { type: 'text', content: '结论：近 3 周完成量连续上升，本周首次反超计划。' },
        { type: 'chart', kind: 'line', data: [
          { label: 'W21', value: 8 },
          { label: 'W22', value: 10 },
          { label: 'W23', value: 9 },
          { label: 'W24', value: 12 },
          { label: 'W25', value: 15 },
          { label: 'W26', value: 18 },
        ] },
      ],
    },
  },
  {
    id: 'tpl-tabs',
    category: '交互',
    name: '分标签页',
    description: '一大块内容拆成标签页，锚点清晰；面板不挤、消息不刷屏。',
    instruction: '请用 dsh-ui 把内容分成 tabs 三个标签：概览/明细/FAQ，每个标签 3 条以内要点；标题「功能速览」。',
    demo: {
      title: '功能速览（示例）',
      items: [
        { type: 'tabs', tabs: [
          { label: '概览', items: [{ type: 'text', content: '三项能力：实时渲染、交互回传、常驻面板。' }] },
          { label: '明细', items: [{ type: 'list', items: ['渲染：fence 增量解析，边流边出', '交互：动作回传模型增量更新', '面板：会话级 dock，折叠/调高'] }] },
          { label: 'FAQ', items: [{ type: 'text', content: '问：不动模型会怎样？答：组件仍可本地判卷/展开。' }] },
        ] },
      ],
    },
  },
  {
    id: 'tpl-checklist',
    category: '流程',
    name: '交付检查清单',
    description: '提交前逐项打勾：清单即流程，漏项看得见。',
    instruction: '请用 dsh-ui 做一张交付检查清单：6 项（测试/文档/发布/回滚/监控/公告），checkbox 可勾选，顶部 badge 提示「全部勾选再合并」。',
    demo: {
      title: '交付清单（示例）',
      items: [
        { type: 'badge', label: '全部勾选再合并', tone: 'warn' },
        { type: 'list', items: [
          { type: 'checkbox', label: '单元测试通过' },
          { type: 'checkbox', label: '文档同步' },
          { type: 'checkbox', label: '发布套餐就绪' },
          { type: 'checkbox', label: '回滚预案' },
        ] },
      ],
    },
  },
  {
    id: 'tpl-accordion',
    category: '高级',
    name: 'FAQ 手风琴',
    description: '一问一答收在折叠面板里，长文档变短，回答不吓人。',
    instruction: '请用 dsh-ui 做 FAQ 手风琴（accordion）：5 个高频问题，标题栏就是问题、展开一条给答案；第一问默认展开。',
    demo: {
      title: 'FAQ（示例）',
      items: [
        { type: 'accordion', items: [
          { title: '支持哪些图表？', items: [{ type: 'text', content: 'chart（bars/line/donut）、plot 函数图、echart 全功能图表。' }] },
          { title: '面板能持久吗？', items: [{ type: 'text', content: '同一内容指纹刷新/重放恢复状态；新内容重置。' }] },
          { title: '交互会打扰模型吗？', items: [{ type: 'text', content: '带 action 的组件才回传；纯展示组件零往返。' }] },
        ] },
      ],
    },
  },
  {
    id: 'tpl-diagram',
    category: '高级',
    name: '系统架构图',
    description: '框架图画成 SVG：节点分层、连接线、分区标注，比截图清楚。',
    instruction: '请用 dsh-ui 画一幅架构图（diagram）：描述当前系统的 5 个节点与连接（kind: architecture 或 flowchart），包含一个安全区 zone。',
    demo: {
      title: '架构图（示例）',
      items: [
        { type: 'diagram', kind: 'flowchart', title: 'DSH 插件链路', nodes: [
          { id: 'a', label: '模型', x: 20, y: 20, w: 120, h: 48 },
          { id: 'b', label: '插件', x: 20, y: 120, w: 120, h: 48 },
          { id: 'c', label: '宿主', x: 200, y: 70, w: 120, h: 48 },
        ], edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
        ] },
      ],
    },
  },
  {
    id: 'tpl-3d',
    category: '高级',
    name: '3D 场景',
    description: '一个可旋转的 3D 场景：产品演示/空间示意用得上。',
    instruction: '请用 dsh-ui 渲染一个 3D 场景（scene3d）：一个立方体 + 一个球体，标题「示例场景」，附一句使用场景说明。',
    demo: {
      title: '3D 场景（示例）',
      items: [
        { type: 'text', content: '首次加载需下载 three.js（约 700KB，懒加载），之后走缓存。', size: 'muted' },
        { type: 'scene3d', title: '示例场景', meshes: [
          { shape: 'box', size: 1, color: '#4FC3F7', position: [-1.2, 0, 0] },
          { shape: 'sphere', size: 0.6, color: '#81C784', position: [1.2, 0, 0] },
        ] },
      ],
    },
  },
  {
    id: 'tpl-breadcrumb',
    category: '数据',
    name: '路径面包屑',
    description: '长路径拆成面包屑：文件位置、组织层级一读就懂。',
    instruction: '请用 dsh-ui 展示当前工作区结构：breadcrumb 显示文件路径（4 段）、file-tree 描述项目目录（3 个目录、每个 2 个子项）。',
    demo: {
      title: '目录结构（示例）',
      items: [
        { type: 'breadcrumb', items: ['工作区', 'dsh-genui', 'src', 'client'] },
        { type: 'file-tree', items: [
          { name: 'src', type: 'dir', children: [
            { name: 'client', type: 'dir', children: [
              { name: 'panel.tsx' },
              { name: 'templates.ts' },
            ] },
            { name: 'index.tsx' },
          ] },
          { name: 'tests', type: 'dir', children: [
            { name: 'templates.spec.ts' },
          ] },
        ] },
      ],
    },
  },
]
