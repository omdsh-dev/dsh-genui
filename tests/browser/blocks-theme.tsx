/** Real renderer, synthetic data. The optional host sheet comes from the
 * runner, separately from the export's standalone fallback palette. */
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { GenuiBlock } from '../../src/client/GenuiBlock.tsx'
import { STANDALONE_THEME_CSS } from '../../src/client/artifact/standalone-theme.ts'
import type { GenuiBlocks, GenuiNode } from '../../src/client/spec.ts'
import css from '../../src/client/GenuiBlock.module.css'

const params = new URLSearchParams(location.search)
if (params.get('theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
const theme = document.createElement('style')
theme.textContent = STANDALONE_THEME_CSS
document.head.appendChild(theme)
if (params.get('palette') === 'host') {
  const response = await fetch('/__host-theme.css')
  if (!response.ok) throw new Error('Host theme stylesheet unavailable')
  const host = document.createElement('style')
  host.textContent = await response.text()
  document.head.appendChild(host)
}

const matrix: GenuiBlocks = {
  type: 'blocks', columns: 2, title: 'Predicted positive / predicted negative',
  rows: [
    { label: 'Actual +', variant: 'outline', cells: [
      { text: 'TP · 42', tone: 'success', sub: 'True positive' },
      { text: 'FN · 8', tone: 'danger', sub: 'False negative' },
    ] },
    { label: 'Actual −', variant: 'outline', cells: [
      { text: 'FP · 5', tone: 'warning', sub: 'False positive' },
      { text: 'TN · 45', tone: 'success', sub: 'True negative' },
    ] },
  ], caption: 'Each cell counts one labeled outcome; color supplements the TP / FN / FP / TN labels.',
}
const variants: GenuiBlocks = {
  type: 'blocks', columns: 6,
  rows: (['fill', 'outline', 'plain'] as const).map(variant => ({
    label: variant, variant, cells: [
      'Default', { text: 'Accent', tone: 'accent' }, { text: 'Success', tone: 'success' },
      { text: 'Warning', tone: 'warning' }, { text: 'Danger', tone: 'danger' }, { text: 'Muted', tone: 'muted' },
    ],
  })),
}
const explicit: GenuiBlocks = {
  type: 'blocks', columns: 3, rows: [{ color: '#e2e8f0', cells: [
    'Row fill', { text: 'Cell fill', tone: 'danger', color: '#1f6f7a' }, { text: 'Tone wins row', tone: 'success' },
  ] }],
}
const samples: { name: string, node: GenuiNode, panel?: boolean }[] = [
  { name: 'matrix', node: matrix },
  { name: 'variants', node: variants },
  { name: 'card', node: { type: 'card', title: 'On a card surface', items: [matrix] } },
  { name: 'panel', node: variants, panel: true },
  { name: 'explicit', node: explicit },
]
for (const sample of samples) {
  const section = document.createElement('section')
  section.dataset.case = sample.name
  const title = document.createElement('h2')
  title.textContent = sample.name
  section.appendChild(title)
  const mount = document.createElement('div')
  section.appendChild(mount)
  document.getElementById('root')!.appendChild(section)
  flushSync(() => createRoot(mount).render(<GenuiBlock spec={{ items: [sample.node] }} />))
  // GenuiBlock also lives inside panels. Exercise the panel token declaration
  // without a nested block masking it with its own copy of the tokens.
  if (sample.panel) mount.firstElementChild!.className = css.panel
}

/** Resolve modern color(srgb ...) and alpha via the actual browser parser. */
function rgba(value: string): number[] {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d')!
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  return [r!, g!, b!, a! / 255]
}
function over(fg: number[], bg: number[]): number[] {
  return fg.slice(0, 3).map((v, i) => v * fg[3]! + bg[i]! * (1 - fg[3]!)).concat(1)
}
function background(element: Element | null): number[] {
  if (element === null) return [255, 255, 255, 1]
  return over(rgba(getComputedStyle(element).backgroundColor), background(element.parentElement))
}
function luminance(rgb: number[]): number {
  const linear = rgb.slice(0, 3).map(v => v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}
const results = [...document.querySelectorAll<HTMLElement>(`.${css.blocksCell}`)].map(cell => {
  const style = getComputedStyle(cell)
  const bg = background(cell)
  const ink = over(rgba(style.color), bg)
  const lums = [luminance(bg), luminance(ink)].sort((a, b) => a - b)
  const root = cell.closest(`.${css.block}, .${css.panel}`)!
  return {
    name: cell.closest<HTMLElement>('[data-case]')!.dataset.case,
    text: cell.textContent, tone: cell.dataset.tone ?? null,
    plain: cell.classList.contains(css.blocksCellPlain), outline: cell.classList.contains(css.blocksCellOutline),
    background: rgba(style.backgroundColor), effective: bg,
    border: rgba(style.borderTopColor), borderWidth: style.borderTopWidth,
    ink, contrast: (lums[1]! + 0.05) / (lums[0]! + 0.05),
    sharedStrong: getComputedStyle(root).getPropertyValue('--dsl-g-tint-strong').trim(),
    sharedTint: getComputedStyle(root).getPropertyValue('--dsl-g-tint').trim(),
  }
})
document.getElementById('results')!.textContent = JSON.stringify(results)
