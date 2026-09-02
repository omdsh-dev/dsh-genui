// @vitest-environment jsdom
// scene3d event-driven rendering: one render after init, zero while idle,
// one per drag move / wheel — no permanent requestAnimationFrame loop.
// three is mocked (jsdom has no WebGL); the canvas pointer listeners and
// the disposer are what we pin here.
import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenuiScene3D } from '../src/client/spec.ts'
import { mountScene } from '../src/client/scene3d-core.ts'

const { renderSpy, cameraPositionSpy } = vi.hoisted(() => ({
  renderSpy: vi.fn(),
  cameraPositionSpy: vi.fn(),
}))

vi.mock('three', () => {
  class FakeGeometry {}
  class FakeMaterial {}
  class FakeObject3D {
    position = { set() {} }
    rotation = { set() {} }
    scale = { setScalar() {}, set() {} }
    add() {}
  }
  return {
    WebGLRenderer: class {
      domElement = document.createElement('canvas')
      setSize() {}
      setPixelRatio() {}
      render(..._args: unknown[]) {
        renderSpy()
      }
      dispose() {}
    },
    PerspectiveCamera: class {
      position = { set: cameraPositionSpy }
      lookAt() {}
    },
    Scene: class {
      background: unknown
      add() {}
    },
    Color: class {},
    AmbientLight: class {},
    DirectionalLight: class {
      position = { set() {} }
    },
    GridHelper: class {},
    BoxGeometry: FakeGeometry,
    SphereGeometry: FakeGeometry,
    ConeGeometry: FakeGeometry,
    CylinderGeometry: FakeGeometry,
    TorusGeometry: FakeGeometry,
    MeshStandardMaterial: FakeMaterial,
    Mesh: FakeObject3D,
  }
})

const SCENE: GenuiScene3D = {
  title: '立方体',
  meshes: [{ shape: 'box', size: [1, 1, 1], color: '#6ea8ff', position: [0, 0, 0] }],
}

afterEach(() => {
  document.body.innerHTML = ''
  renderSpy.mockClear()
  cameraPositionSpy.mockClear()
})

describe('scene3d event-driven rendering', () => {
  it('renders exactly once after init and never idles', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const dispose = await mountScene(container, SCENE)
    expect(renderSpy).toHaveBeenCalledTimes(1)
    renderSpy.mockClear()
    // A static scene must not re-render on its own (no RAF loop).
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(renderSpy).not.toHaveBeenCalled()
    dispose()
  })

  it('renders once per drag move and once per wheel; stops after release', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const dispose = await mountScene(container, SCENE)
    const canvas = container.querySelector('canvas')!
    renderSpy.mockClear()
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 12, clientY: 12, pointerId: 1 })
    expect(renderSpy).toHaveBeenCalledTimes(1)
    fireEvent.pointerMove(canvas, { clientX: 14, clientY: 14, pointerId: 1 })
    expect(renderSpy).toHaveBeenCalledTimes(2)
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 99, clientY: 99, pointerId: 1 })
    expect(renderSpy).toHaveBeenCalledTimes(2) // released: no re-render
    fireEvent.wheel(canvas, { deltaY: 120 })
    expect(renderSpy).toHaveBeenCalledTimes(3)
    dispose()
  })

  it('dragging right follows the pointer horizontally', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const dispose = await mountScene(container, SCENE)
    const canvas = container.querySelector('canvas')!
    const [initialX, initialY, initialZ] = cameraPositionSpy.mock.calls.at(-1) as number[]

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 2 })
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 10, pointerId: 2 })

    const [nextX, nextY, nextZ] = cameraPositionSpy.mock.calls.at(-1) as number[]
    expect(nextX).toBeLessThan(initialX)
    expect(nextY).toBeCloseTo(initialY)
    expect(nextZ).toBeGreaterThan(initialZ)
    dispose()
  })

  it('dragging down follows the pointer vertically', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const dispose = await mountScene(container, SCENE)
    const canvas = container.querySelector('canvas')!
    const [, initialY] = cameraPositionSpy.mock.calls.at(-1) as number[]

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 3 })
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 20, pointerId: 3 })

    const [, nextY] = cameraPositionSpy.mock.calls.at(-1) as number[]
    expect(nextY).toBeGreaterThan(initialY)
    dispose()
  })

  it('pointercancel ends the drag', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const dispose = await mountScene(container, SCENE)
    const canvas = container.querySelector('canvas')!
    renderSpy.mockClear()
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 9 })
    fireEvent.pointerMove(canvas, { clientX: 5, clientY: 0, pointerId: 9 })
    expect(renderSpy).toHaveBeenCalledTimes(1)
    fireEvent.pointerCancel(canvas, { pointerId: 9 })
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 0, pointerId: 9 })
    expect(renderSpy).toHaveBeenCalledTimes(1) // cancelled: no re-render
    dispose()
  })

  it('dispose removes the canvas and stops everything', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const dispose = await mountScene(container, SCENE)
    expect(container.querySelector('canvas')).not.toBeNull()
    dispose()
    expect(container.querySelector('canvas')).toBeNull()
  })
})
