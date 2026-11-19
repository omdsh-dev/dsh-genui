import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { GenuiBlock } from '../../src/client/GenuiBlock.tsx'
import { GenuiActionContext } from '../../src/client/action-context.ts'
import { STANDALONE_THEME_CSS } from '../../src/client/artifact/standalone-theme.ts'
import type { GenuiSpec } from '../../src/client/spec.ts'

const style = document.createElement('style')
style.textContent = STANDALONE_THEME_CSS
document.head.append(style)
const root = createRoot(document.getElementById('root')!)
let revision = 0
const fixture = {
  events: [] as Array<{ action: string; payload: Record<string, unknown> }>,
  mount(spec: GenuiSpec, reset = true) {
    if (reset) { revision += 1; fixture.events.length = 0 }
    flushSync(() => root.render(
      <GenuiActionContext.Provider value={(action, payload) => { fixture.events.push({ action, payload }) }}>
        <GenuiBlock key={revision} spec={spec} animateEntrance={false} />
      </GenuiActionContext.Provider>,
    ))
  },
}
Object.assign(window, { genuiInteraction: fixture })
