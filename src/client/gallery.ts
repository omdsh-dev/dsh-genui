/**
 * GenUI gallery: one spec exercising every white-listed node type, used as
 * the canonical full-vocabulary sample (tests render it and assert every
 * component family appears; docs and demos reuse it as the "show everything"
 * fence).
 */
import type { GenuiSpec } from './spec.ts'

/** A single spec covering all 38 node types in the vocabulary. */
export const gallerySpec: GenuiSpec = {
  title: 'GenUI · Component gallery',
  gap: 14,
  items: [
    { type: 'text', size: 'h1', content: 'Typography scale' },
    { type: 'text', size: 'h2', content: 'Secondary heading' },
    { type: 'text', size: 'h3', content: 'Tertiary heading' },
    { type: 'text', size: 'body', content: 'Body: rendered from the component whitelist, never through arbitrary HTML.' },
    { type: 'text', size: 'muted', content: 'Muted text' },
    { type: 'text', size: 'caption', content: 'Caption', center: true },
    { type: 'row', items: [
      { type: 'badge', label: 'Success', tone: 'success' },
      { type: 'badge', label: 'Warning', tone: 'warn' },
      { type: 'badge', label: 'Danger', tone: 'danger' },
      { type: 'badge', label: 'Accent', tone: 'accent', icon: '★' },
      { type: 'avatar', name: 'Alice' },
      { type: 'avatar', name: 'Bob', color: '#3d9e8f' },
      { type: 'link', label: 'Details link' },
    ], wrap: true },
    { type: 'divider' },
    { type: 'grid', cols: 3, items: [
      { type: 'stat', label: 'CPU', value: '42%', delta: '+3.1%' },
      { type: 'stat', label: 'Memory', value: '6.8 GB', delta: '-1.2%' },
      { type: 'stat', label: 'Requests', value: '128.4k' },
    ] },
    { type: 'progress', label: 'Training progress', value: 72, valueLabel: '72%' },
    { type: 'card', title: 'Performance metrics', items: [
      { type: 'table', columns: ['Metric', 'Q1', 'Q2', 'Q3'], rows: [
        ['Latency', 92, 87, 81], ['Throughput', '1.2k', '1.4k', '1.6k'], ['Error rate', '0.3%', '0.2%', '0.1%'],
      ] },
      { type: 'keyvalue', pairs: [
        { key: 'Version', value: 'v0.1.0' }, { key: 'Environment', value: 'production' }, { key: 'Region', value: 'cn-east' },
      ] },
    ] },
    { type: 'list', items: [
      { title: 'Title item', desc: 'List item with a description' },
      'Plain text list item',
      { title: 'Another title' },
    ] },
    { type: 'chart', kind: 'bars', data: [
      { label: 'One', value: 10 }, { label: 'Two', value: 20 }, { label: 'Three', value: 15 },
    ] },
    { type: 'chart', kind: 'line', data: [
      { label: 'Mon', value: 8 }, { label: 'Tue', value: 12 }, { label: 'Wed', value: 9 },
    ] },
    { type: 'chart', kind: 'donut', data: [
      { label: 'A', value: 30 }, { label: 'B', value: 70 },
    ] },
    { type: 'chart', data: [], series: [
      { label: 'This month', data: [{ label: 'Q1', value: 3 }, { label: 'Q2', value: 5 }] },
      { label: 'Last month', data: [{ label: 'Q1', value: 2 }, { label: 'Q2', value: 4 }] },
    ] },
    { type: 'tabs', tabs: [
      { label: 'Overview', items: [{ type: 'text', content: 'Content of tab one' }] },
      { label: 'Details', items: [{ type: 'list', items: ['Detail A', 'Detail B'] }] },
      { label: 'Chart', items: [{ type: 'chart', kind: 'donut', data: [{ label: 'X', value: 40 }, { label: 'Y', value: 60 }] }] },
    ] },
    { type: 'col', gap: 8, items: [
      { type: 'button', label: 'Primary button', tone: 'primary' },
      { type: 'button', label: 'Danger', tone: 'danger', small: true },
      { type: 'button', label: 'Success', tone: 'success' },
      { type: 'button', label: 'Ghost', tone: 'ghost', icon: '↗' },
    ] },
    { type: 'row', items: [
      { type: 'input', label: 'Name', placeholder: 'Type…' },
      { type: 'select', label: 'Environment', options: ['dev', 'staging', 'production'] },
    ], wrap: true },
    { type: 'row', items: [
      { type: 'checkbox', label: 'Auto-save', checked: true },
      { type: 'switch', label: 'Notifications', checked: true },
      { type: 'radio', label: 'Theme', options: ['Light', 'Dark', 'System'] },
    ], wrap: true },
    { type: 'textarea', label: 'Notes', placeholder: 'Multi-line input…', rows: 3 },
    { type: 'accordion', items: [
      { title: 'First item', items: [{ type: 'json', value: { ok: true, count: 3 } }] },
      { title: 'Second item', items: [{ type: 'code', lang: 'ts', code: 'export const x = 1' }] },
    ] },
    { type: 'copy', label: 'Copy token', text: 'sk-1234567890' },
    { type: 'plot', title: 'Wave overlay', xMin: -6.28, xMax: 6.28, series: [
      { expr: 'sin(x)', label: 'sin(x)', color: '#4f8ef7' },
      { expr: '0.8*cos(x)', label: 'cos', color: '#3ecf8e' },
    ] },
    { type: 'callout', tone: 'info', title: 'Tip', content: 'The gallery covers the full component vocabulary.' },
    { type: 'steps', current: 2, steps: [
      { title: 'Draft', desc: 'Write spec' }, { title: 'Render', desc: 'Draw components' }, { title: 'Verify', desc: 'Run tests' },
    ] },
    { type: 'diff', diffs: [
      { path: 'a.ts', oldText: 'const x = 1', newText: 'const x = 2' },
    ] },
    { type: 'code', lang: 'json', code: '{"hello": "world"}' },
    { type: 'mermaid', code: 'graph TD\nA[Model] --> B[Renderer]\nB --> C[Components]' },
    { type: 'scene3d', title: 'Geometry demo', ambient: 1, meshes: [
      { shape: 'box', color: '#4f8ef7', position: [-1.4, 0, 0], rotation: [0.5, 0.8, 0] },
      { shape: 'sphere', color: '#3ecf8e', position: [0, 0, 0] },
      { shape: 'cone', color: '#e0a458', position: [1.4, 0, 0] },
    ] },
    { type: 'timeline', items: [
      { title: 'Release v0.1', desc: 'First usable version', time: '08-01' },
      { title: 'Event loop', desc: 'action round-trip', time: '08-08' },
    ] },
    { type: 'file-tree', items: [
      { name: 'src', type: 'dir', children: [
        { name: 'client', type: 'dir', children: [{ name: 'GenuiBlock.tsx', type: 'file' }] },
        { name: 'spec.ts', type: 'file' },
      ] },
      { name: 'README.md', type: 'file' },
    ] },
    { type: 'breadcrumb', items: ['Home', 'Components', 'Gallery'] },
    { type: 'quiz', question: '1 + 1 = ?', id: 'gallery-q1', options: [
      { label: '1', feedback: 'Try again' }, { label: '2', correct: true }, { label: '3' },
    ], explanation: 'In binary, 1+1=10; in decimal it is 2.' },
    { type: 'spacer' },
  ],
}
