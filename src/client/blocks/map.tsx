import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { GenuiMap } from '../spec.ts'
import type { AnswersState } from './state.ts'
import { repairMap, isMapProjectable } from '../map-data.ts'
import { useGenuiMapConfig } from '../map-config.ts'
import { loadMapEngine, type MapController } from '../map-lazy.ts'
import { useT } from '../i18n/index.ts'
import css from './map.module.css'

export function MapNode({ node: raw, answers }: { node: GenuiMap; answers?: AnswersState | undefined }) {
  const t = useT()
  // Direct typed callers receive the same resource and URL boundary as fences.
  const node = useMemo(() => repairMap(raw) ?? { type: 'map' as const, locations: [] }, [raw])
  const config = useGenuiMapConfig()
  const [localSelection, setLocalSelection] = useState(node.selected ?? '')
  const stored = node.id !== undefined && answers !== undefined && Object.hasOwn(answers.fields, node.id) ? answers.fields[node.id] : undefined
  const candidate = stored ?? localSelection
  const selected = node.locations.some(location => location.id === candidate) ? candidate : ''
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const canvas = useRef<HTMLDivElement>(null)
  const controller = useRef<MapController>()
  const uid = useId()
  const latest = useRef({ node, selected, answers, t })
  latest.current = { node, selected, answers, t }

  function choose(id: string): void {
    const current = latest.current
    if (id !== '' && !current.node.locations.some(location => location.id === id)) return
    setLocalSelection(id)
    if (current.node.id !== undefined) current.answers?.setField(current.node.id, id)
    controller.current?.select(id)
  }
  useEffect(() => {
    // Preserve a valid stable ID across streaming updates; never restore a removed choice.
    if (candidate !== selected) setLocalSelection('')
    if (node.id !== undefined && answers !== undefined && stored !== selected && (stored !== undefined || selected !== '')) {
      answers.setField(node.id, selected)
    }
  }, [node.id, selected, candidate, stored, answers])

  useEffect(() => {
    let cancelled = false
    let failed = false
    let mounted: MapController | undefined
    let observer: ResizeObserver | undefined
    setStatus('loading')
    void loadMapEngine().then(engine => {
      if (cancelled || canvas.current === null) return
      const current = latest.current
      mounted = engine.mountMap(canvas.current, current.node, current.selected, {
        config, onSelect: choose,
        onError: () => { failed = true; if (!cancelled) setStatus('failed') },
        onReady: () => { if (!cancelled && !failed) setStatus('ready') },
        markerLabel: label => latest.current.t('map.marker', { label }),
      })
      controller.current = mounted
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => mounted?.resize())
        observer.observe(canvas.current)
      }
    }).catch(() => { if (!cancelled) setStatus('failed') })
    return () => { cancelled = true; observer?.disconnect(); mounted?.destroy(); controller.current = undefined }
  }, [config])
  useEffect(() => { controller.current?.update(node, selected) }, [node, selected])
  const hasPolarCoordinates = node.locations.some(location => !isMapProjectable(location.coordinates))
    || node.routes?.some(route => route.coordinates.some(point => !isMapProjectable(point)))
    || (node.center !== undefined && !isMapProjectable(node.center))
  const label = node.title ?? t('map.title')
  return <section className={css.map} aria-label={label}>
    {node.title !== undefined && <strong>{node.title}</strong>}
    <div ref={canvas} className={css.canvas} style={{ height: node.height ?? 320 }} role="region" aria-label={t('map.canvas')} aria-describedby={`${uid}-status`} />
    <div id={`${uid}-status`} className={css.status} role="status">
      {status === 'failed' ? t('map.failed') : status === 'loading' ? t('map.loading') : config === undefined ? t('map.offline') : t('map.hostStyle')}
    </div>
    {hasPolarCoordinates && <p className={css.status}>{t('map.polar')}</p>}
    <div className={css.controls}>
      <button type="button" disabled={status !== 'ready'} onClick={() => controller.current?.zoom(1)}>{t('map.zoomIn')}</button>
      <button type="button" disabled={status !== 'ready'} onClick={() => controller.current?.zoom(-1)}>{t('map.zoomOut')}</button>
      <button type="button" disabled={status !== 'ready'} onClick={() => controller.current?.reset()}>{t('map.reset')}</button>
      <button type="button" disabled={selected === ''} onClick={() => choose('')}>{t('map.clear')}</button>
    </div>
    {node.locations.length === 0 && <p>{t('map.empty')}</p>}
    <ul className={css.locations} aria-label={t('map.locations')}>
      {node.locations.map(location => <li key={location.id}>
        <button className={css.location} type="button" aria-pressed={selected === location.id} onClick={() => choose(location.id)}>
          <span>{location.label}</span>
          {location.description !== undefined && <span className={css.description}>{location.description}</span>}
          <span className={css.description}>{location.coordinates.join(', ')}</span>
        </button>
      </li>)}
    </ul>
    {(node.routes?.length ?? 0) > 0 && <details><summary>{t('map.routes')}</summary>
      <ul className={css.routes}>{node.routes!.map(route => <li key={route.id}>{route.label}: {route.coordinates.map(point => point.join(', ')).join(' → ')}</li>)}</ul>
    </details>}
  </section>
}
