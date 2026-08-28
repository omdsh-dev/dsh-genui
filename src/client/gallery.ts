/**
 * GenUI gallery: one spec exercising every white-listed node type, used as
 * the canonical full-vocabulary sample (tests render it and assert every
 * component family appears; docs and demos reuse it as the "show everything"
 * fence).
 */
import type { GenuiSpec } from './spec.ts'

/** A single spec covering all 41 node types in the vocabulary. */
export const gallerySpec: GenuiSpec = {
  title: 'GenUI · 组件画廊',
  gap: 14,
  items: [
    { type: 'text', size: 'h1', content: '排版层级' },
    { type: 'text', size: 'h2', content: '二级标题' },
    { type: 'text', size: 'h3', content: '三级标题' },
    { type: 'text', size: 'body', content: '正文：组件白名单渲染，不经过任意 HTML 路径。' },
    { type: 'text', size: 'muted', content: '弱化文本' },
    { type: 'text', size: 'caption', content: '说明文字', center: true },
    { type: 'row', items: [
      { type: 'badge', label: '成功', tone: 'success' },
      { type: 'badge', label: '警告', tone: 'warn' },
      { type: 'badge', label: '危险', tone: 'danger' },
      { type: 'badge', label: '强调', tone: 'accent', icon: '★' },
      { type: 'avatar', name: 'Alice' },
      { type: 'avatar', name: 'Bob', color: '#3d9e8f' },
      { type: 'link', label: '详情链接' },
    ], wrap: true },
    { type: 'divider' },
    { type: 'image', src: '/demo-image.png', alt: '图片展示演示' },
    { type: 'audio', src: '/demo-audio.mp3', alt: '音频播放器演示' },
    { type: 'video', src: '/demo-video.mp4', alt: '视频播放器演示', poster: '/demo-video.jpg', aspectRatio: '16:9' },
    { type: 'grid', cols: 3, items: [
      { type: 'stat', label: 'CPU', value: '42%', delta: '+3.1%' },
      { type: 'stat', label: '内存', value: '6.8 GB', delta: '-1.2%' },
      { type: 'stat', label: '请求数', value: '128.4k' },
    ] },
    { type: 'progress', label: '训练进度', value: 72, valueLabel: '72%' },
    { type: 'card', title: '性能指标', items: [
      // 表头可点击排序：数值感知（千分位 / k / 万 / % 都能正确比较），
      // 数值列自动右对齐。
      { type: 'table', columns: ['指标', 'Q1', 'Q2', 'Q3'], rows: [
        ['延迟', 92, 87, 81], ['吞吐', '1.2k', '1.4k', '1.6k'], ['错误率', '0.3%', '0.2%', '0.1%'],
        ['营收', '3.5万', '4.1万', '5.2万'], ['注册', '1,234', '2,345', '3,456'],
      ] },
      { type: 'keyvalue', pairs: [
        { key: '版本', value: 'v0.1.0' }, { key: '环境', value: 'production' }, { key: '区域', value: 'cn-east' },
      ] },
    ] },
    { type: 'list', items: [
      { title: '标题项', desc: '带描述的列表项' },
      '纯文本列表项',
      { title: '另一个标题' },
    ] },
    { type: 'chart', kind: 'bars', data: [
      { label: '一', value: 10 }, { label: '二', value: 20 }, { label: '三', value: 15 },
    ] },
    { type: 'chart', kind: 'line', data: [
      { label: '周一', value: 8 }, { label: '周二', value: 12 }, { label: '周三', value: 9 },
    ] },
    { type: 'chart', kind: 'donut', data: [
      { label: 'A', value: 30 }, { label: 'B', value: 70 },
    ] },
    { type: 'chart', data: [], series: [
      { label: '本月', data: [{ label: 'Q1', value: 3 }, { label: 'Q2', value: 5 }] },
      { label: '上月', data: [{ label: 'Q1', value: 2 }, { label: 'Q2', value: 4 }] },
    ] },
    { type: 'tabs', tabs: [
      { label: '概览', items: [{ type: 'text', content: '标签页一的内容' }] },
      { label: '明细', items: [{ type: 'list', items: ['明细 A', '明细 B'] }] },
      { label: '图表', items: [{ type: 'chart', kind: 'donut', data: [{ label: 'X', value: 40 }, { label: 'Y', value: 60 }] }] },
    ] },
    { type: 'col', gap: 8, items: [
      { type: 'button', label: '主按钮', tone: 'primary' },
      { type: 'button', label: '危险', tone: 'danger', small: true },
      { type: 'button', label: '成功', tone: 'success' },
      { type: 'button', label: '幽灵', tone: 'ghost', icon: '↗' },
    ] },
    { type: 'row', items: [
      { type: 'input', label: '名称', placeholder: '输入…' },
      { type: 'select', label: '环境', options: ['dev', 'staging', 'production'] },
    ], wrap: true },
    { type: 'row', items: [
      { type: 'checkbox', label: '自动保存', checked: true },
      { type: 'switch', label: '通知', checked: true },
      { type: 'radio', label: '主题', options: ['浅色', '深色', '跟随系统'] },
    ], wrap: true },
    { type: 'textarea', label: '备注', placeholder: '多行输入…', rows: 3 },
    { type: 'accordion', items: [
      { title: '第一项', items: [{ type: 'json', value: { ok: true, count: 3 } }] },
      { title: '第二项', items: [{ type: 'code', lang: 'ts', code: 'export const x = 1' }] },
    ] },
    { type: 'copy', label: '复制令牌', text: 'sk-1234567890' },
    { type: 'plot', title: '波动叠加', xMin: -6.28, xMax: 6.28, series: [
      { expr: 'sin(x)', label: 'sin(x)', color: '#4f8ef7' },
      { expr: '0.8*cos(x)', label: 'cos', color: '#3ecf8e' },
    ] },
    { type: 'callout', tone: 'info', title: '提示', content: '画廊覆盖全部组件词汇。' },
    { type: 'steps', current: 2, steps: [
      { title: '起草', desc: '写规格' }, { title: '渲染', desc: '画组件' }, { title: '验证', desc: '跑测试' },
    ] },
    { type: 'diff', diffs: [
      { path: 'a.ts', oldText: 'const x = 1', newText: 'const x = 2' },
    ] },
    { type: 'code', lang: 'json', code: '{"hello": "world"}' },
    { type: 'mermaid', code: 'graph TD\nA[模型] --> B[渲染器]\nB --> C[组件]' },
    { type: 'scene3d', title: '几何演示', ambient: 1, meshes: [
      { shape: 'box', color: '#4f8ef7', position: [-1.4, 0, 0], rotation: [0.5, 0.8, 0] },
      { shape: 'sphere', color: '#3ecf8e', position: [0, 0, 0] },
      { shape: 'cone', color: '#e0a458', position: [1.4, 0, 0] },
    ] },
    { type: 'timeline', items: [
      { title: '发布 v0.1', desc: '首个可用版本', time: '08-01' },
      { title: '事件循环', desc: 'action 回流', time: '08-08' },
    ] },
    { type: 'file-tree', items: [
      { name: 'src', type: 'dir', children: [
        { name: 'client', type: 'dir', children: [{ name: 'GenuiBlock.tsx', type: 'file' }] },
        { name: 'spec.ts', type: 'file' },
      ] },
      { name: 'README.md', type: 'file' },
    ] },
    { type: 'breadcrumb', items: ['首页', '组件', '画廊'] },
    { type: 'quiz', question: '1 + 1 = ?', id: 'gallery-q1', options: [
      { label: '1', feedback: '再想想' }, { label: '2', correct: true }, { label: '3' },
    ], explanation: '二进制里 1+1=10，十进制里是 2。' },
    { type: 'spacer' },
  ],
}
