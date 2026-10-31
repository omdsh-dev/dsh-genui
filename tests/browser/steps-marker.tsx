/** Real GenuiBlock, with host tokens injected separately from export defaults. */
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { GenuiBlock } from '../../src/client/GenuiBlock.tsx'
import { STANDALONE_THEME_CSS } from '../../src/client/artifact/standalone-theme.ts'
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
// The official base token sheet supplies the host's font stack. Export uses its
// own font default; neither case impersonates native Windows font rendering.
if (params.get('palette') === 'host') document.body.style.fontFamily = 'var(--dsw-font-family)'
const steps = ['一', '二', '三', '四'].map((title, index) => ({
  title: index === 1 ? `${title} · 检查步骤标题在窄屏上的换行布局与说明可读性 · verify readable title wrapping at narrow viewport widths` : title,
  desc: `第${title}条：验证完成标记、当前步骤和待办序号，内容应完整保留。`,
}))
for (const font of [14, 17, 20]) {
  for (const lineHeight of [1.45, 2.1]) {
    const group = document.createElement('div')
    group.dataset.font = String(font)
    group.dataset.lineHeight = String(lineHeight)
    const heading = document.createElement('h2')
    heading.textContent = `宿主字号 ${font}px · 正文行高 ${lineHeight}`
    group.appendChild(heading)
    const cases = document.createElement('div')
    cases.className = 'cases'
    group.appendChild(cases)
    document.getElementById('root')!.appendChild(group)
    for (const state of ['done', 'numbered']) {
      const section = document.createElement('section')
      section.dataset.state = state
      section.style.setProperty('--dsh-content-font-size', `${font}px`)
      section.style.lineHeight = String(lineHeight)
      const title = document.createElement('h3')
      title.textContent = state === 'done' ? '全部完成' : '当前第 1 步，其余待办'
      const mount = document.createElement('div')
      section.append(title, mount)
      cases.appendChild(section)
      flushSync(() => createRoot(mount).render(<GenuiBlock spec={{ items: [
        { type: 'steps', steps, ...(state === 'numbered' ? { current: 0 } : {}) },
      ] }} />))
    }
  }
}
await document.fonts.ready
await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
await Promise.all(document.getAnimations()
  .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
  .map(animation => animation.finished.catch(() => {})))
const results = [...document.querySelectorAll<HTMLElement>(`.${css.stepMarker}`)].map(marker => {
  const style = getComputedStyle(marker)
  const box = marker.getBoundingClientRect()
  const range = document.createRange()
  range.selectNodeContents(marker)
  const text = range.getBoundingClientRect()
  const section = marker.closest<HTMLElement>('section')!
  const group = section.closest<HTMLElement>('[data-font]')!
  const title = marker.parentElement!.querySelector<HTMLElement>(`.${css.stepTitle}`)!
  const titleBox = title.getBoundingClientRect()
  return {
    hostFont: Number(group.dataset.font), hostLineHeight: Number(group.dataset.lineHeight),
    state: section.dataset.state, text: marker.textContent,
    font: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), fontFamily: style.fontFamily,
    width: box.width, height: box.height,
    textTop: text.top - box.top, textBottom: text.bottom - box.top,
    textCenterOffset: (text.top + text.bottom - box.top - box.bottom) / 2,
    titleLineHeight: parseFloat(getComputedStyle(title).lineHeight),
    titleLines: titleBox.height / parseFloat(getComputedStyle(title).lineHeight),
    descLineHeight: parseFloat(getComputedStyle(marker.parentElement!.querySelector(`.${css.stepDesc}`)!).lineHeight),
    titleClear: titleBox.left >= box.right && titleBox.right <= innerWidth,
  }
})
document.getElementById('results')!.textContent = JSON.stringify({
  samples: results, overflow: document.documentElement.scrollWidth > innerWidth,
})
