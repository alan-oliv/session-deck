import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSessionId, type Label, type LabelStore } from '../shared/api'
import { DEFAULT_LABELS } from '../shared/labels'
import { readJson, writeJsonAtomic } from './settings'

const HEX = /^#[0-9a-f]{6}$/i

export function normalizeLabels(raw: unknown): LabelStore {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_LABELS)
  const r = raw as Record<string, unknown>
  const ids = new Set<string>()
  const names = new Set<string>()
  const list: Label[] = []
  for (const item of Array.isArray(r.list) ? r.list : DEFAULT_LABELS.list) {
    const x = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const name = typeof x.name === 'string' ? x.name.trim() : ''
    if (typeof x.id !== 'string' || !x.id || !name || typeof x.color !== 'string' || !HEX.test(x.color)) continue
    if (ids.has(x.id) || names.has(name.toLowerCase())) continue
    ids.add(x.id)
    names.add(name.toLowerCase())
    list.push({ id: x.id, name, color: x.color.toLowerCase() })
  }
  const map: Record<string, string[]> = {}
  if (r.map && typeof r.map === 'object') {
    for (const [sessionId, labelIds] of Object.entries(r.map)) {
      if (isSessionId(sessionId) && Array.isArray(labelIds)) map[sessionId] = [...new Set(labelIds.filter((i): i is string => typeof i === 'string'))]
    }
  }
  return { list, map }
}

export interface LabelsStore {
  get(): LabelStore
  save(raw: unknown): LabelStore
}

export function createLabelsStore(path: string): LabelsStore {
  let current = normalizeLabels(readJson(path))
  return {
    get: () => current,
    save(raw) {
      current = normalizeLabels(raw)
      writeJsonAtomic(path, current)
      return current
    },
  }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const sid = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  it('starts with the six default labels when there is nothing usable on disk', () => {
    expect(normalizeLabels(null)).toEqual(DEFAULT_LABELS)
    expect(normalizeLabels('nope')).toEqual(DEFAULT_LABELS)
    expect(normalizeLabels({ map: { [sid]: ['bug'] } }).list).toEqual(DEFAULT_LABELS.list)
  })
  it('keeps a saved empty list empty', () => {
    expect(normalizeLabels({ list: [], map: {} })).toEqual({ list: [], map: {} })
  })
  it('drops labels with a bad id, name or colour, and duplicate ids or names ignoring case', () => {
    const list = [
      { id: 'a', name: ' Alpha ', color: '#EB5757' },
      { id: 'a', name: 'Again', color: '#eb5757' },
      { id: 'b', name: 'alpha', color: '#eb5757' },
      { id: '', name: 'No id', color: '#eb5757' },
      { id: 'c', name: '   ', color: '#eb5757' },
      { id: 'd', name: 'Red', color: 'red' },
      { id: 'e', name: 'Fine', color: '#4ea7fc' },
      null,
    ]
    expect(normalizeLabels({ list, map: {} }).list).toEqual([
      { id: 'a', name: 'Alpha', color: '#eb5757' },
      { id: 'e', name: 'Fine', color: '#4ea7fc' },
    ])
  })
  it('keeps only session-id keys in the map, with deduped string ids', () => {
    const r = normalizeLabels({ list: [], map: { [sid]: ['a', 'a', 5, 'b'], '../x': ['a'], other: 'a' } })
    expect(r.map).toEqual({ [sid]: ['a', 'b'] })
  })
  it('persists what is saved and reads it back, normalised', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'deck-labels-')), 'nested', 'labels.json')
    const saved = createLabelsStore(path).save({ list: [{ id: 'x', name: 'Mine', color: '#26b5ce' }], map: { [sid]: ['x'], bad: ['x'] } })
    expect(saved).toEqual({ list: [{ id: 'x', name: 'Mine', color: '#26b5ce' }], map: { [sid]: ['x'] } })
    expect(createLabelsStore(path).get()).toEqual(saved)
  })
}
