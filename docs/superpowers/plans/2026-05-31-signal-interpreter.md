# Signal Interpreter — Implementation Plan (Backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les interpréteurs MQTT hardcoded par un système configurable basé sur des « units » composables, sans toucher au frontend (différé jusqu'au merge de `feat/topics-tree`).

**Architecture:** Un device = liste d'units. Chaque unit écoute un topic, extrait optionnellement un champ JSON, applique une condition, transforme via un catalogue fini, et produit un champ. Le runtime fusionne les sorties en un `DeviceState` mergé persistant. Modèle X : une entrée registry = une instance physique. Debounce et dedup indexés par `device.id`.

**Tech Stack:** Node.js, TypeScript, Fastify, better-sqlite3, mqtt, Vitest.

**Spec :** [`docs/superpowers/specs/2026-05-31-signal-interpreter-design.md`](../specs/2026-05-31-signal-interpreter-design.md)

**Zone interdite (chantier `feat/topics-tree` en cours) :** ne PAS modifier `apps/frontend/**` ni les routes/topics frontend liées. La phase frontend est documentée en fin de plan comme **différée**.

---

## File Structure

### Backend — nouveaux fichiers
- `apps/backend/src/interpreters/eval.ts` — `getByPath`, `evalCondition`, `applyTransform`, `evalUnit`
- `apps/backend/src/interpreters/eval.test.ts`
- `apps/backend/src/interpreters/validate.ts` — validation des units et payloads device
- `apps/backend/src/interpreters/validate.test.ts`
- `apps/backend/src/interpreters/aggregator.ts` — état mergé persistant par device
- `apps/backend/src/interpreters/aggregator.test.ts`
- `apps/backend/src/interpreters/presets.ts` — catalogue `PRESETS` + `applyPreset` + `extractVars`
- `apps/backend/src/interpreters/presets.test.ts`
- `apps/backend/src/interpreters/registry.ts` — `createUnitRegistry`
- `apps/backend/src/interpreters/registry.test.ts`
- `apps/backend/src/interpreters/parity.test.ts` — parité avec anciens interpréteurs
- `apps/backend/src/api/presets-routes.ts`

### Backend — fichiers modifiés
- `apps/backend/src/interpreters/types.ts` — ajout `Unit`, `Condition`, `Transform`, `OutputType`, `Display`, `LayoutDescriptor`, `DeviceEntry`, `RouteResult`
- `apps/backend/src/db/schema.ts` — ajout colonnes `debounce_ms`/`layout_json` sur `device_registry`, création `device_units`
- `apps/backend/src/db/registry.ts` — refonte pour le nouveau modèle, CRUD units, migration upgrade-in-place
- `apps/backend/src/db/registry.test.ts` — tests des nouvelles fonctions
- `apps/backend/src/api/registry-routes.ts` — refactorisation pour le nouveau modèle
- `apps/backend/src/index.ts` — câblage du nouveau pipeline (registry + aggregator)

### Backend — fichiers supprimés (Task 14)
- `apps/backend/src/interpreters/frigate.ts` + test associé s'il existe
- `apps/backend/src/interpreters/wled.ts` + test
- `apps/backend/src/interpreters/tasmota.ts` + test
- `apps/backend/src/interpreters/raw.ts`
- `apps/backend/src/interpreters/dynamic.ts`
- `apps/backend/src/interpreters/index.ts` (l'ancien `createInterpreterRegistry`)

### Frontend — Phase B différée
Voir la section finale **« Phase B — Frontend (différée) »**. À implémenter dans un plan ultérieur APRÈS merge de `feat/topics-tree`.

---

## Task 1 : Étendre `interpreters/types.ts`

**Files:**
- Modify: `apps/backend/src/interpreters/types.ts`

- [ ] **Step 1 : Réécrire le fichier**

Remplacer entièrement `apps/backend/src/interpreters/types.ts` par :

```ts
export interface DeviceState {
  source: string
  event_type: string
  state: Record<string, unknown>
  raw: string
  timestamp: number
}

export interface Interpreter {
  source: string
  topics: string[]
  debounceMs?: number
  parse(topic: string, payload: Buffer): DeviceState | null
}

export type OutputType = 'boolean' | 'number' | 'string' | 'color' | 'enum'

export type ConditionOp = 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'

export interface Condition {
  path: string
  op: ConditionOp
  value: string | number | boolean | (string | number)[]
}

export type Transform =
  | { type: 'passthrough' }
  | { type: 'enum_map'; map: Record<string, unknown>; default?: unknown }
  | { type: 'scale'; in_min: number; in_max: number; out_min: number; out_max: number; round?: boolean }
  | { type: 'round'; decimals: number }
  | { type: 'rgb_to_hex' }
  | { type: 'array_first' }
  | { type: 'array_contains'; value: string | number }

export interface Display {
  label?: string
  icon?: string
  unit?: string
  min?: number
  max?: number
  on_label?: string
  off_label?: string
}

export interface LayoutDescriptor {
  groups?: { title?: string; fields: string[] }[]
  hidden?: string[]
}

export interface Unit {
  id: number
  device_id: number
  position: number
  name: string
  topic_pattern: string
  json_path: string | null
  condition: Condition | null
  transform: Transform
  output_field: string
  output_type: OutputType
  display: Display | null
}

export type UnitInput = Omit<Unit, 'id' | 'device_id'>

export interface DeviceEntry {
  id: number
  name: string
  debounce_ms: number | null
  layout: LayoutDescriptor | null
  units: Unit[]
  active: boolean
  created_at: number
}

export interface DevicePayload {
  name: string
  debounce_ms?: number | null
  layout?: LayoutDescriptor | null
  units: UnitInput[]
}

export interface RouteResult {
  device_id: number
  partial_state: Record<string, unknown>
  raw: string
}
```

L'ancien `Interpreter` est conservé pour la rétrocompat des tests de parité (Task 12) et sera supprimé à la Task 14.

- [ ] **Step 2 : Vérifier la compilation TypeScript**

Run: `cd apps/backend && npx tsc --noEmit`
Expected : aucune erreur (le fichier reste compatible avec les imports existants `DeviceState` et `Interpreter`).

- [ ] **Step 3 : Commit**

```bash
git add apps/backend/src/interpreters/types.ts
git commit -m "feat(backend): extend interpreter types for configurable units"
```

---

## Task 2 : Étendre `db/schema.ts`

**Files:**
- Modify: `apps/backend/src/db/schema.ts`

- [ ] **Step 1 : Réécrire `applySchema`**

Remplacer entièrement `apps/backend/src/db/schema.ts` par :

```ts
import type Database from 'better-sqlite3'

interface ColumnInfo { name: string }

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[]
  return rows.some(r => r.name === column)
}

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT NOT NULL,
      topic      TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload    TEXT NOT NULL,
      raw        TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_source ON events (source);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);

    CREATE TABLE IF NOT EXISTS device_snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT NOT NULL,
      state      TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_source ON device_snapshots (source);
    CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON device_snapshots (created_at);

    CREATE TABLE IF NOT EXISTS topics_seen (
      topic         TEXT    PRIMARY KEY,
      first_seen    INTEGER NOT NULL,
      last_seen     INTEGER NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 1,
      detected_type TEXT
    );

    CREATE TABLE IF NOT EXISTS device_registry (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL,
      topic_patterns   TEXT    NOT NULL,
      interpreter_type TEXT    NOT NULL,
      active           INTEGER NOT NULL DEFAULT 1,
      created_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_units (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id      INTEGER NOT NULL REFERENCES device_registry(id) ON DELETE CASCADE,
      position       INTEGER NOT NULL,
      name           TEXT    NOT NULL,
      topic_pattern  TEXT    NOT NULL,
      json_path      TEXT,
      condition_json TEXT,
      transform_json TEXT    NOT NULL,
      output_field   TEXT    NOT NULL,
      output_type    TEXT    NOT NULL,
      display_json   TEXT,
      created_at     INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_units_device ON device_units (device_id);
  `)

  if (!hasColumn(db, 'device_registry', 'debounce_ms')) {
    db.exec(`ALTER TABLE device_registry ADD COLUMN debounce_ms INTEGER`)
  }
  if (!hasColumn(db, 'device_registry', 'layout_json')) {
    db.exec(`ALTER TABLE device_registry ADD COLUMN layout_json TEXT`)
  }
}
```

Les colonnes `topic_patterns` et `interpreter_type` sont **conservées** pour la migration (cf. Task 9). Elles seront supprimées à la Task 14.

- [ ] **Step 2 : Vérifier la compilation**

Run: `cd apps/backend && npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 3 : Lancer toute la suite de tests existante**

Run: `cd apps/backend && npx vitest run`
Expected : tous les tests passent (le nouveau schéma est rétrocompatible avec les anciens tests).

- [ ] **Step 4 : Commit**

```bash
git add apps/backend/src/db/schema.ts
git commit -m "feat(backend): extend SQLite schema with device_units and registry columns"
```

---

## Task 3 : Module `eval.ts` — extraction + condition + transform

**Files:**
- Create: `apps/backend/src/interpreters/eval.ts`
- Create: `apps/backend/src/interpreters/eval.test.ts`

- [ ] **Step 1 : Écrire les tests**

Créer `apps/backend/src/interpreters/eval.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { getByPath, evalCondition, applyTransform, evalUnit } from './eval'
import type { Condition, Transform, Unit } from './types'

describe('getByPath', () => {
  it('retourne le payload entier si path null', () => {
    expect(getByPath({ a: 1 }, null)).toEqual({ a: 1 })
  })

  it('extrait un champ simple', () => {
    expect(getByPath({ a: 42 }, 'a')).toBe(42)
  })

  it('extrait un champ imbriqué', () => {
    expect(getByPath({ a: { b: { c: 'x' } } }, 'a.b.c')).toBe('x')
  })

  it('extrait un index de tableau', () => {
    expect(getByPath({ arr: [10, 20, 30] }, 'arr[1]')).toBe(20)
  })

  it('extrait imbriqué array+object', () => {
    expect(getByPath({ seg: [{ col: [[255, 100, 0]] }] }, 'seg[0].col[0]')).toEqual([255, 100, 0])
  })

  it('retourne undefined si chemin inexistant', () => {
    expect(getByPath({ a: 1 }, 'b.c')).toBeUndefined()
  })

  it('retourne undefined si traversée d\'un null', () => {
    expect(getByPath({ a: null }, 'a.b')).toBeUndefined()
  })
})

describe('evalCondition', () => {
  const payload = { type: 'new', zones: ['bureau', 'salon'], score: 0.87 }

  it('null condition → true', () => {
    expect(evalCondition(payload, null)).toBe(true)
  })

  it('eq', () => {
    expect(evalCondition(payload, { path: 'type', op: 'eq', value: 'new' })).toBe(true)
    expect(evalCondition(payload, { path: 'type', op: 'eq', value: 'end' })).toBe(false)
  })

  it('neq', () => {
    expect(evalCondition(payload, { path: 'type', op: 'neq', value: 'update' })).toBe(true)
  })

  it('in', () => {
    expect(evalCondition(payload, { path: 'type', op: 'in', value: ['new', 'end'] })).toBe(true)
    expect(evalCondition(payload, { path: 'type', op: 'in', value: ['end'] })).toBe(false)
  })

  it('contains sur array', () => {
    expect(evalCondition(payload, { path: 'zones', op: 'contains', value: 'bureau' })).toBe(true)
    expect(evalCondition(payload, { path: 'zones', op: 'contains', value: 'cuisine' })).toBe(false)
  })

  it('contains sur string', () => {
    expect(evalCondition({ s: 'hello world' }, { path: 's', op: 'contains', value: 'world' })).toBe(true)
  })

  it('gt / gte / lt / lte', () => {
    expect(evalCondition(payload, { path: 'score', op: 'gt', value: 0.5 })).toBe(true)
    expect(evalCondition(payload, { path: 'score', op: 'gte', value: 0.87 })).toBe(true)
    expect(evalCondition(payload, { path: 'score', op: 'lt', value: 1 })).toBe(true)
    expect(evalCondition(payload, { path: 'score', op: 'lte', value: 0.87 })).toBe(true)
  })

  it('chemin inexistant → false (défensif)', () => {
    expect(evalCondition(payload, { path: 'missing', op: 'eq', value: 'x' })).toBe(false)
  })
})

describe('applyTransform', () => {
  it('passthrough', () => {
    expect(applyTransform(42, { type: 'passthrough' })).toBe(42)
    expect(applyTransform({ x: 1 }, { type: 'passthrough' })).toEqual({ x: 1 })
  })

  it('enum_map avec match', () => {
    expect(applyTransform('ON', { type: 'enum_map', map: { ON: true, OFF: false } })).toBe(true)
  })

  it('enum_map avec default', () => {
    expect(applyTransform('UNKNOWN', { type: 'enum_map', map: { ON: true }, default: false })).toBe(false)
  })

  it('enum_map sans match et sans default → undefined', () => {
    expect(applyTransform('X', { type: 'enum_map', map: { ON: true } })).toBeUndefined()
  })

  it('scale 0-255 → 0-100 round', () => {
    expect(applyTransform(128, { type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100, round: true })).toBe(50)
  })

  it('scale sans round', () => {
    const v = applyTransform(127, { type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100 }) as number
    expect(v).toBeCloseTo(49.8, 1)
  })

  it('scale jette si non numérique', () => {
    expect(() => applyTransform('abc', { type: 'scale', in_min: 0, in_max: 1, out_min: 0, out_max: 1 })).toThrow()
  })

  it('round', () => {
    expect(applyTransform(0.876, { type: 'round', decimals: 2 })).toBe(0.88)
    expect(applyTransform(3.14159, { type: 'round', decimals: 3 })).toBe(3.142)
  })

  it('rgb_to_hex sur [R,G,B]', () => {
    expect(applyTransform([255, 100, 0], { type: 'rgb_to_hex' })).toBe('#ff6400')
  })

  it('rgb_to_hex sur [[R,G,B]] (forme WLED)', () => {
    expect(applyTransform([[255, 100, 0]], { type: 'rgb_to_hex' })).toBe('#ff6400')
  })

  it('rgb_to_hex jette sur valeur invalide', () => {
    expect(() => applyTransform('abc', { type: 'rgb_to_hex' })).toThrow()
  })

  it('array_first', () => {
    expect(applyTransform(['a', 'b'], { type: 'array_first' })).toBe('a')
    expect(applyTransform([], { type: 'array_first' })).toBeNull()
    expect(applyTransform('not array', { type: 'array_first' })).toBeNull()
  })

  it('array_contains', () => {
    expect(applyTransform(['x', 'y'], { type: 'array_contains', value: 'x' })).toBe(true)
    expect(applyTransform(['x', 'y'], { type: 'array_contains', value: 'z' })).toBe(false)
  })
})

describe('evalUnit', () => {
  const makeUnit = (overrides: Partial<Unit> = {}): Unit => ({
    id: 1, device_id: 1, position: 0, name: 'u',
    topic_pattern: 'x', json_path: null, condition: null,
    transform: { type: 'passthrough' },
    output_field: 'value', output_type: 'string', display: null,
    ...overrides,
  })

  it('extrait + transforme', () => {
    const u = makeUnit({ json_path: 'a.b', transform: { type: 'enum_map', map: { ON: true } } })
    const r = u
    const res = evalUnit(r, { a: { b: 'ON' } })
    expect(res.emitted).toBe(true)
    expect(res.value).toBe(true)
    expect(res.output_field).toBe('value')
  })

  it('condition false → pas d\'émission', () => {
    const u = makeUnit({
      json_path: 'a',
      condition: { path: 'flag', op: 'eq', value: true },
    })
    expect(evalUnit(u, { a: 1, flag: false }).emitted).toBe(false)
  })

  it('chemin extraction inexistant → pas d\'émission', () => {
    const u = makeUnit({ json_path: 'missing' })
    expect(evalUnit(u, { a: 1 }).emitted).toBe(false)
  })

  it('transform throw → pas d\'émission, error remontée', () => {
    const u = makeUnit({ json_path: 'a', transform: { type: 'scale', in_min: 0, in_max: 1, out_min: 0, out_max: 1 } })
    const res = evalUnit(u, { a: 'not-a-number' })
    expect(res.emitted).toBe(false)
    expect(res.error).toBeDefined()
  })

  it('payload entier si json_path null', () => {
    const u = makeUnit({ json_path: null })
    expect(evalUnit(u, 42).value).toBe(42)
    expect(evalUnit(u, 42).emitted).toBe(true)
  })
})
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

Run: `cd apps/backend && npx vitest run src/interpreters/eval.test.ts`
Expected : FAIL avec `Cannot find module './eval'`.

- [ ] **Step 3 : Implémenter `eval.ts`**

Créer `apps/backend/src/interpreters/eval.ts` :

```ts
import type { Condition, Transform, Unit } from './types'

export function getByPath(obj: unknown, path: string | null): unknown {
  if (path === null) return obj
  if (obj === null || obj === undefined) return undefined

  const tokens: (string | number)[] = []
  let current = ''
  let inBrackets = false

  for (const c of path) {
    if (c === '.' && !inBrackets) {
      if (current) tokens.push(current)
      current = ''
    } else if (c === '[') {
      if (current) tokens.push(current)
      current = ''
      inBrackets = true
    } else if (c === ']') {
      tokens.push(Number(current))
      current = ''
      inBrackets = false
    } else {
      current += c
    }
  }
  if (current) tokens.push(current)

  let value: unknown = obj
  for (const t of tokens) {
    if (value === null || value === undefined) return undefined
    if (typeof value !== 'object') return undefined
    value = (value as Record<string | number, unknown>)[t]
  }
  return value
}

export function evalCondition(payload: unknown, condition: Condition | null): boolean {
  if (condition === null) return true
  const value = getByPath(payload, condition.path)
  if (value === undefined) return false

  switch (condition.op) {
    case 'eq':
      return value === condition.value
    case 'neq':
      return value !== condition.value
    case 'in':
      return Array.isArray(condition.value) && (condition.value as unknown[]).includes(value)
    case 'contains':
      if (Array.isArray(value)) return value.includes(condition.value as never)
      if (typeof value === 'string') return value.includes(String(condition.value))
      return false
    case 'gt':
      return typeof value === 'number' && value > Number(condition.value)
    case 'gte':
      return typeof value === 'number' && value >= Number(condition.value)
    case 'lt':
      return typeof value === 'number' && value < Number(condition.value)
    case 'lte':
      return typeof value === 'number' && value <= Number(condition.value)
  }
}

export function applyTransform(value: unknown, t: Transform): unknown {
  switch (t.type) {
    case 'passthrough':
      return value
    case 'enum_map': {
      const key = String(value)
      if (key in t.map) return t.map[key]
      return t.default
    }
    case 'scale': {
      const n = Number(value)
      if (!Number.isFinite(n)) throw new Error('scale: not a number')
      const ratio = (n - t.in_min) / (t.in_max - t.in_min)
      const out = t.out_min + ratio * (t.out_max - t.out_min)
      return t.round ? Math.round(out) : out
    }
    case 'round': {
      const n = Number(value)
      if (!Number.isFinite(n)) throw new Error('round: not a number')
      const m = Math.pow(10, t.decimals)
      return Math.round(n * m) / m
    }
    case 'rgb_to_hex': {
      let rgb: number[]
      if (Array.isArray(value) && value.length >= 3 && value.every(v => typeof v === 'number')) {
        rgb = value as number[]
      } else if (Array.isArray(value) && Array.isArray(value[0])) {
        rgb = value[0] as number[]
      } else {
        throw new Error('rgb_to_hex: invalid RGB input')
      }
      const hex = rgb.slice(0, 3)
        .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
        .join('')
      return '#' + hex
    }
    case 'array_first':
      return Array.isArray(value) && value.length > 0 ? value[0] : null
    case 'array_contains':
      return Array.isArray(value) && value.includes(t.value as never)
  }
}

export interface EvalResult {
  emitted: boolean
  output_field?: string
  value?: unknown
  error?: string
}

export function evalUnit(unit: Unit, payload: unknown): EvalResult {
  if (!evalCondition(payload, unit.condition)) {
    return { emitted: false }
  }
  const extracted = getByPath(payload, unit.json_path)
  if (extracted === undefined && unit.json_path !== null) {
    return { emitted: false }
  }
  try {
    const transformed = applyTransform(extracted, unit.transform)
    return { emitted: true, output_field: unit.output_field, value: transformed }
  } catch (e) {
    return { emitted: false, error: e instanceof Error ? e.message : 'unknown error' }
  }
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

Run: `cd apps/backend && npx vitest run src/interpreters/eval.test.ts`
Expected : PASS (tous les tests).

- [ ] **Step 5 : Commit**

```bash
git add apps/backend/src/interpreters/eval.ts apps/backend/src/interpreters/eval.test.ts
git commit -m "feat(backend): add unit evaluation (extract, condition, transform)"
```

---

## Task 4 : Module `validate.ts`

**Files:**
- Create: `apps/backend/src/interpreters/validate.ts`
- Create: `apps/backend/src/interpreters/validate.test.ts`

- [ ] **Step 1 : Écrire les tests**

Créer `apps/backend/src/interpreters/validate.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { validateUnitInput, validateDevicePayload } from './validate'

const baseUnit = {
  position: 0,
  name: 'u',
  topic_pattern: 'home/test',
  json_path: null,
  condition: null,
  transform: { type: 'passthrough' },
  output_field: 'value',
  output_type: 'string',
  display: null,
}

describe('validateUnitInput', () => {
  it('accepte un unit minimal valide', () => {
    const r = validateUnitInput(baseUnit)
    expect(r.ok).toBe(true)
  })

  it('refuse topic_pattern vide', () => {
    const r = validateUnitInput({ ...baseUnit, topic_pattern: '' })
    expect(r.ok).toBe(false)
  })

  it('refuse topic_pattern avec # au milieu', () => {
    const r = validateUnitInput({ ...baseUnit, topic_pattern: 'a/#/b' })
    expect(r.ok).toBe(false)
  })

  it('accepte topic_pattern avec + et # en fin', () => {
    expect(validateUnitInput({ ...baseUnit, topic_pattern: 'home/+/state' }).ok).toBe(true)
    expect(validateUnitInput({ ...baseUnit, topic_pattern: 'home/#' }).ok).toBe(true)
  })

  it('refuse json_path invalide', () => {
    expect(validateUnitInput({ ...baseUnit, json_path: '..a' }).ok).toBe(false)
    expect(validateUnitInput({ ...baseUnit, json_path: 'a..b' }).ok).toBe(false)
  })

  it('accepte json_path simple et indexé', () => {
    expect(validateUnitInput({ ...baseUnit, json_path: 'a.b' }).ok).toBe(true)
    expect(validateUnitInput({ ...baseUnit, json_path: 'seg[0].col[0]' }).ok).toBe(true)
  })

  it('refuse output_field invalide', () => {
    expect(validateUnitInput({ ...baseUnit, output_field: '1bad' }).ok).toBe(false)
    expect(validateUnitInput({ ...baseUnit, output_field: 'bad-name' }).ok).toBe(false)
    expect(validateUnitInput({ ...baseUnit, output_field: '' }).ok).toBe(false)
  })

  it('refuse output_type hors whitelist', () => {
    expect(validateUnitInput({ ...baseUnit, output_type: 'date' }).ok).toBe(false)
  })

  it('refuse transform.type inconnu', () => {
    expect(validateUnitInput({ ...baseUnit, transform: { type: 'eval' } }).ok).toBe(false)
  })

  it('refuse scale sans bornes', () => {
    const r = validateUnitInput({ ...baseUnit, transform: { type: 'scale', in_min: 0 } })
    expect(r.ok).toBe(false)
  })

  it('refuse condition op inconnu', () => {
    const r = validateUnitInput({
      ...baseUnit,
      condition: { path: 'a', op: 'matches', value: 'x' },
    })
    expect(r.ok).toBe(false)
  })

  it('refuse event_type avec output_type incompatible', () => {
    const r = validateUnitInput({
      ...baseUnit,
      output_field: 'event_type',
      output_type: 'number',
    })
    expect(r.ok).toBe(false)
  })

  it('accepte event_type en string', () => {
    expect(validateUnitInput({
      ...baseUnit,
      output_field: 'event_type',
      output_type: 'string',
    }).ok).toBe(true)
  })
})

describe('validateDevicePayload', () => {
  const baseDevice = {
    name: 'd',
    units: [baseUnit],
  }

  it('accepte un device minimal', () => {
    expect(validateDevicePayload(baseDevice).ok).toBe(true)
  })

  it('refuse name vide', () => {
    expect(validateDevicePayload({ ...baseDevice, name: '' }).ok).toBe(false)
  })

  it('refuse units vide', () => {
    expect(validateDevicePayload({ ...baseDevice, units: [] }).ok).toBe(false)
  })

  it('refuse plus de 30 units', () => {
    const many = Array.from({ length: 31 }, () => baseUnit)
    expect(validateDevicePayload({ ...baseDevice, units: many }).ok).toBe(false)
  })

  it('refuse incohérence d\'output_type entre units même field', () => {
    const r = validateDevicePayload({
      ...baseDevice,
      units: [
        { ...baseUnit, output_field: 'x', output_type: 'string' },
        { ...baseUnit, output_field: 'x', output_type: 'number' },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it('accepte plusieurs units sur le même output_field si même type', () => {
    const r = validateDevicePayload({
      ...baseDevice,
      units: [
        { ...baseUnit, output_field: 'x', output_type: 'string' },
        { ...baseUnit, output_field: 'x', output_type: 'string', position: 1 },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it('accepte debounce_ms', () => {
    expect(validateDevicePayload({ ...baseDevice, debounce_ms: 200 }).ok).toBe(true)
    expect(validateDevicePayload({ ...baseDevice, debounce_ms: null }).ok).toBe(true)
  })

  it('refuse debounce_ms négatif', () => {
    expect(validateDevicePayload({ ...baseDevice, debounce_ms: -1 }).ok).toBe(false)
  })
})
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

Run: `cd apps/backend && npx vitest run src/interpreters/validate.test.ts`
Expected : FAIL avec `Cannot find module './validate'`.

- [ ] **Step 3 : Implémenter `validate.ts`**

Créer `apps/backend/src/interpreters/validate.ts` :

```ts
import type { UnitInput, DevicePayload, Condition, Transform, OutputType, LayoutDescriptor } from './types'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const TOPIC_SEG = /^[a-zA-Z0-9_-]+$/
const JSON_PATH = /^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*|\[\d+\])*$/
const FIELD_NAME = /^[a-zA-Z_]\w*$/
const OUTPUT_TYPES: OutputType[] = ['boolean', 'number', 'string', 'color', 'enum']
const CONDITION_OPS = ['eq', 'neq', 'in', 'contains', 'gt', 'gte', 'lt', 'lte'] as const

function validateTopicPattern(p: unknown): Result<string> {
  if (typeof p !== 'string' || p.length === 0) return { ok: false, error: 'topic_pattern: string non vide requis' }
  if (p.length > 256) return { ok: false, error: 'topic_pattern: longueur max 256' }
  const segments = p.split('/')
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg === '+') continue
    if (seg === '#') {
      if (i !== segments.length - 1) return { ok: false, error: 'topic_pattern: # uniquement en dernier segment' }
      continue
    }
    if (!TOPIC_SEG.test(seg)) return { ok: false, error: `topic_pattern: segment invalide "${seg}"` }
  }
  return { ok: true, value: p }
}

function validateJsonPath(p: unknown): Result<string | null> {
  if (p === null || p === undefined) return { ok: true, value: null }
  if (typeof p !== 'string') return { ok: false, error: 'json_path: string ou null requis' }
  if (!JSON_PATH.test(p)) return { ok: false, error: `json_path: format invalide "${p}"` }
  return { ok: true, value: p }
}

function validateCondition(c: unknown): Result<Condition | null> {
  if (c === null || c === undefined) return { ok: true, value: null }
  if (typeof c !== 'object') return { ok: false, error: 'condition: objet ou null requis' }
  const obj = c as Record<string, unknown>
  const pathRes = validateJsonPath(obj.path)
  if (!pathRes.ok) return { ok: false, error: `condition.${pathRes.error}` }
  if (pathRes.value === null) return { ok: false, error: 'condition.path requis' }
  if (typeof obj.op !== 'string' || !(CONDITION_OPS as readonly string[]).includes(obj.op)) {
    return { ok: false, error: `condition.op: doit être ${CONDITION_OPS.join('|')}` }
  }
  if (obj.value === undefined) return { ok: false, error: 'condition.value requis' }
  return { ok: true, value: { path: pathRes.value, op: obj.op as Condition['op'], value: obj.value as Condition['value'] } }
}

function validateTransform(t: unknown): Result<Transform> {
  if (typeof t !== 'object' || t === null) return { ok: false, error: 'transform: objet requis' }
  const obj = t as Record<string, unknown>
  switch (obj.type) {
    case 'passthrough':
      return { ok: true, value: { type: 'passthrough' } }
    case 'enum_map':
      if (typeof obj.map !== 'object' || obj.map === null) return { ok: false, error: 'enum_map.map requis' }
      return { ok: true, value: { type: 'enum_map', map: obj.map as Record<string, unknown>, default: obj.default } }
    case 'scale':
      for (const k of ['in_min', 'in_max', 'out_min', 'out_max']) {
        if (typeof obj[k] !== 'number') return { ok: false, error: `scale.${k}: numérique requis` }
      }
      return {
        ok: true,
        value: {
          type: 'scale',
          in_min: obj.in_min as number,
          in_max: obj.in_max as number,
          out_min: obj.out_min as number,
          out_max: obj.out_max as number,
          round: Boolean(obj.round),
        },
      }
    case 'round':
      if (typeof obj.decimals !== 'number') return { ok: false, error: 'round.decimals: numérique requis' }
      return { ok: true, value: { type: 'round', decimals: obj.decimals } }
    case 'rgb_to_hex':
      return { ok: true, value: { type: 'rgb_to_hex' } }
    case 'array_first':
      return { ok: true, value: { type: 'array_first' } }
    case 'array_contains':
      if (obj.value === undefined) return { ok: false, error: 'array_contains.value requis' }
      return { ok: true, value: { type: 'array_contains', value: obj.value as string | number } }
    default:
      return { ok: false, error: `transform.type inconnu: ${String(obj.type)}` }
  }
}

export function validateUnitInput(input: unknown): Result<UnitInput> {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'unit: objet requis' }
  const obj = input as Record<string, unknown>

  if (typeof obj.name !== 'string' || obj.name.length === 0) return { ok: false, error: 'unit.name requis' }
  if (typeof obj.position !== 'number') return { ok: false, error: 'unit.position numérique requis' }

  const topicRes = validateTopicPattern(obj.topic_pattern)
  if (!topicRes.ok) return { ok: false, error: topicRes.error }

  const pathRes = validateJsonPath(obj.json_path)
  if (!pathRes.ok) return { ok: false, error: pathRes.error }

  const condRes = validateCondition(obj.condition ?? null)
  if (!condRes.ok) return { ok: false, error: condRes.error }

  const transRes = validateTransform(obj.transform)
  if (!transRes.ok) return { ok: false, error: transRes.error }

  if (typeof obj.output_field !== 'string' || !FIELD_NAME.test(obj.output_field) || obj.output_field.length > 64) {
    return { ok: false, error: 'output_field: identifiant valide requis' }
  }
  if (typeof obj.output_type !== 'string' || !(OUTPUT_TYPES as string[]).includes(obj.output_type)) {
    return { ok: false, error: `output_type: ${OUTPUT_TYPES.join('|')}` }
  }
  if (obj.output_field === 'event_type' && obj.output_type !== 'string' && obj.output_type !== 'enum') {
    return { ok: false, error: 'output_field=event_type doit avoir output_type=string|enum' }
  }

  const display = obj.display && typeof obj.display === 'object' ? (obj.display as UnitInput['display']) : null

  return {
    ok: true,
    value: {
      position: obj.position,
      name: obj.name,
      topic_pattern: topicRes.value,
      json_path: pathRes.value,
      condition: condRes.value,
      transform: transRes.value,
      output_field: obj.output_field,
      output_type: obj.output_type as OutputType,
      display,
    },
  }
}

export function validateLayout(input: unknown): Result<LayoutDescriptor | null> {
  if (input === null || input === undefined) return { ok: true, value: null }
  if (typeof input !== 'object') return { ok: false, error: 'layout: objet ou null requis' }
  return { ok: true, value: input as LayoutDescriptor }
}

export function validateDevicePayload(input: unknown): Result<DevicePayload> {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'device: objet requis' }
  const obj = input as Record<string, unknown>

  if (typeof obj.name !== 'string' || obj.name.length === 0) return { ok: false, error: 'device.name requis' }
  if (!Array.isArray(obj.units) || obj.units.length === 0) return { ok: false, error: 'device.units: tableau non vide requis' }
  if (obj.units.length > 30) return { ok: false, error: 'device.units: max 30 units par device' }

  const units: UnitInput[] = []
  const fieldTypes = new Map<string, string>()

  for (let i = 0; i < obj.units.length; i++) {
    const res = validateUnitInput(obj.units[i])
    if (!res.ok) return { ok: false, error: `units[${i}]: ${res.error}` }
    const prev = fieldTypes.get(res.value.output_field)
    if (prev && prev !== res.value.output_type) {
      return { ok: false, error: `units[${i}]: output_field "${res.value.output_field}" déclaré avec types différents` }
    }
    fieldTypes.set(res.value.output_field, res.value.output_type)
    units.push(res.value)
  }

  let debounceMs: number | null = null
  if (obj.debounce_ms !== undefined && obj.debounce_ms !== null) {
    if (typeof obj.debounce_ms !== 'number' || obj.debounce_ms < 0) {
      return { ok: false, error: 'debounce_ms: numérique positif ou null' }
    }
    debounceMs = obj.debounce_ms
  }

  const layoutRes = validateLayout(obj.layout ?? null)
  if (!layoutRes.ok) return { ok: false, error: layoutRes.error }

  return { ok: true, value: { name: obj.name, units, debounce_ms: debounceMs, layout: layoutRes.value } }
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

Run: `cd apps/backend && npx vitest run src/interpreters/validate.test.ts`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/backend/src/interpreters/validate.ts apps/backend/src/interpreters/validate.test.ts
git commit -m "feat(backend): add unit and device payload validation"
```

---

## Task 5 : Module `aggregator.ts`

**Files:**
- Create: `apps/backend/src/interpreters/aggregator.ts`
- Create: `apps/backend/src/interpreters/aggregator.test.ts`

- [ ] **Step 1 : Écrire les tests**

Créer `apps/backend/src/interpreters/aggregator.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAggregator } from './aggregator'

describe('createAggregator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-31T12:00:00Z'))
  })

  it('produit un DeviceState avec event_type par défaut', () => {
    const agg = createAggregator()
    const state = agg.merge(1, { power: true }, '{"x":1}')
    expect(state.source).toBe('device:1')
    expect(state.event_type).toBe('state_change')
    expect(state.state).toEqual({ power: true })
    expect(state.raw).toBe('{"x":1}')
    expect(state.timestamp).toBeTypeOf('number')
  })

  it('persiste les champs non touchés entre messages', () => {
    const agg = createAggregator()
    agg.merge(1, { power: true, brightness: 80 }, 'raw1')
    const s = agg.merge(1, { brightness: 50 }, 'raw2')
    expect(s.state).toEqual({ power: true, brightness: 50 })
  })

  it('event_type d\'un unit pilote le event_type du DeviceState', () => {
    const agg = createAggregator()
    const s = agg.merge(1, { event_type: 'detection_start', object: 'person' }, 'raw')
    expect(s.event_type).toBe('detection_start')
    expect(s.state).toEqual({ object: 'person' })
    expect(s.state.event_type).toBeUndefined()
  })

  it('event_type persistant entre messages', () => {
    const agg = createAggregator()
    agg.merge(1, { event_type: 'detection_start', object: 'person' }, 'raw1')
    const s = agg.merge(1, { object: 'cat' }, 'raw2')
    expect(s.event_type).toBe('detection_start')
    expect(s.state.object).toBe('cat')
  })

  it('isolation entre devices', () => {
    const agg = createAggregator()
    agg.merge(1, { a: 1 }, 'r')
    agg.merge(2, { b: 2 }, 'r')
    expect(agg.getState(1)).toEqual({ a: 1 })
    expect(agg.getState(2)).toEqual({ b: 2 })
  })

  it('hydrate restaure un état (cas relecture Redis)', () => {
    const agg = createAggregator()
    agg.hydrate(1, { power: true, event_type: 'state_change' })
    const s = agg.merge(1, { brightness: 50 }, 'r')
    expect(s.state).toEqual({ power: true, brightness: 50 })
  })

  it('reset efface l\'état d\'un device', () => {
    const agg = createAggregator()
    agg.merge(1, { a: 1 }, 'r')
    agg.reset(1)
    expect(agg.getState(1)).toBeUndefined()
  })
})
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

Run: `cd apps/backend && npx vitest run src/interpreters/aggregator.test.ts`
Expected : FAIL avec `Cannot find module './aggregator'`.

- [ ] **Step 3 : Implémenter `aggregator.ts`**

Créer `apps/backend/src/interpreters/aggregator.ts` :

```ts
import type { DeviceState } from './types'

export interface DeviceAggregator {
  merge(deviceId: number, partial: Record<string, unknown>, raw: string): DeviceState
  hydrate(deviceId: number, state: Record<string, unknown>): void
  reset(deviceId: number): void
  getState(deviceId: number): Record<string, unknown> | undefined
}

export function createAggregator(): DeviceAggregator {
  const map = new Map<number, Record<string, unknown>>()

  return {
    merge(deviceId, partial, raw) {
      const existing = map.get(deviceId) ?? {}
      const merged = { ...existing, ...partial }
      map.set(deviceId, merged)

      const { event_type, ...publicState } = merged

      return {
        source: `device:${deviceId}`,
        event_type: typeof event_type === 'string' ? event_type : 'state_change',
        state: publicState,
        raw,
        timestamp: Date.now(),
      }
    },

    hydrate(deviceId, state) {
      map.set(deviceId, { ...state })
    },

    reset(deviceId) {
      map.delete(deviceId)
    },

    getState(deviceId) {
      return map.get(deviceId)
    },
  }
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

Run: `cd apps/backend && npx vitest run src/interpreters/aggregator.test.ts`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/backend/src/interpreters/aggregator.ts apps/backend/src/interpreters/aggregator.test.ts
git commit -m "feat(backend): add persistent state aggregator per device"
```

---

## Task 6 : Catalogue `presets.ts`

**Files:**
- Create: `apps/backend/src/interpreters/presets.ts`
- Create: `apps/backend/src/interpreters/presets.test.ts`

- [ ] **Step 1 : Écrire les tests**

Créer `apps/backend/src/interpreters/presets.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { PRESETS, applyPreset, extractVars, findPreset } from './presets'

describe('PRESETS catalogue', () => {
  it('contient au moins les 6 presets attendus', () => {
    const keys = PRESETS.map(p => p.key).sort()
    expect(keys).toEqual([
      'frigate-camera',
      'raw-passthrough',
      'tasmota-dht',
      'tasmota-energy',
      'tasmota-power',
      'wled',
    ])
  })

  it('chaque preset a un nom, units non vides, placeholders définis', () => {
    for (const p of PRESETS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.units.length).toBeGreaterThan(0)
      expect(Array.isArray(p.placeholders)).toBe(true)
    }
  })

  it('frigate-camera a debounce_ms 300', () => {
    const p = findPreset('frigate-camera')
    expect(p?.debounce_ms).toBe(300)
  })
})

describe('extractVars', () => {
  it('extrait { camera } de frigate/{camera}/events', () => {
    expect(extractVars('frigate/{camera}/events', 'frigate/principale/events')).toEqual({ camera: 'principale' })
  })

  it('extrait plusieurs placeholders', () => {
    expect(extractVars('{prefix}tele/{device_id}/STATE', 'home/abc/tele/chambre/STATE'))
      .toEqual({ prefix: 'home/abc/', device_id: 'chambre' })
  })

  it('retourne null si le pattern ne match pas', () => {
    expect(extractVars('frigate/{camera}/events', 'other/topic')).toBeNull()
  })

  it('extrait depuis un wildcard MQTT +', () => {
    expect(extractVars('frigate/{camera}/events', 'frigate/+/events')).toEqual({ camera: '+' })
  })

  it('prefix peut être vide', () => {
    expect(extractVars('{prefix}tele/{device_id}/STATE', 'tele/chambre/STATE'))
      .toEqual({ prefix: '', device_id: 'chambre' })
  })
})

describe('applyPreset', () => {
  it('substitue les placeholders dans tous les topic_patterns', () => {
    const preset = findPreset('frigate-camera')!
    const units = applyPreset(preset, { camera: 'chambre' })
    expect(units.every(u => !u.topic_pattern.includes('{'))).toBe(true)
    expect(units[0].topic_pattern).toContain('chambre')
  })

  it('ne modifie pas les autres champs', () => {
    const preset = findPreset('wled')!
    const units = applyPreset(preset, { device_id: 'salon' })
    expect(units[0].output_field).toBe(preset.units[0].output_field)
    expect(units[0].transform).toEqual(preset.units[0].transform)
  })
})

describe('findPreset', () => {
  it('retourne undefined si inconnu', () => {
    expect(findPreset('inconnu')).toBeUndefined()
  })
})
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

Run: `cd apps/backend && npx vitest run src/interpreters/presets.test.ts`
Expected : FAIL avec `Cannot find module './presets'`.

- [ ] **Step 3 : Implémenter `presets.ts`**

Créer `apps/backend/src/interpreters/presets.ts` :

```ts
import type { UnitInput, LayoutDescriptor } from './types'

export interface Preset {
  key: string
  name: string
  description: string
  debounce_ms: number | null
  layout: LayoutDescriptor | null
  placeholders: string[]
  units: UnitInput[]
}

export const PRESETS: Preset[] = [
  {
    key: 'frigate-camera',
    name: 'Caméra Frigate',
    description: "Détection d'objets avec zones, événements start/end.",
    debounce_ms: 300,
    layout: null,
    placeholders: ['camera'],
    units: [
      { position: 0, name: 'Objet détecté', topic_pattern: 'frigate/{camera}/events',
        json_path: 'after.label', condition: null, transform: { type: 'passthrough' },
        output_field: 'object', output_type: 'string', display: { label: 'Objet', icon: 'User' } },
      { position: 1, name: 'Zone', topic_pattern: 'frigate/{camera}/events',
        json_path: 'after.current_zones', condition: null, transform: { type: 'array_first' },
        output_field: 'zone', output_type: 'string', display: { label: 'Zone', icon: 'Camera' } },
      { position: 2, name: 'Confiance', topic_pattern: 'frigate/{camera}/events',
        json_path: 'after.score', condition: null, transform: { type: 'round', decimals: 2 },
        output_field: 'confidence', output_type: 'number', display: { label: 'Confiance' } },
      { position: 3, name: 'Caméra', topic_pattern: 'frigate/{camera}/events',
        json_path: 'after.camera', condition: null, transform: { type: 'passthrough' },
        output_field: 'camera', output_type: 'string', display: { label: 'Caméra' } },
      { position: 4, name: 'État détection', topic_pattern: 'frigate/{camera}/events',
        json_path: 'type', condition: null,
        transform: { type: 'enum_map', map: { new: true, end: false }, default: false },
        output_field: 'active', output_type: 'boolean',
        display: { label: 'Active', on_label: 'En cours', off_label: 'Terminée' } },
      { position: 5, name: "Type d'événement", topic_pattern: 'frigate/{camera}/events',
        json_path: 'type', condition: null,
        transform: { type: 'enum_map', map: { new: 'detection_start', end: 'detection_end' } },
        output_field: 'event_type', output_type: 'string', display: null },
    ],
  },
  {
    key: 'wled',
    name: 'WLED',
    description: 'Ruban LED contrôlable : on/off, brightness, couleur, effet.',
    debounce_ms: null,
    layout: null,
    placeholders: ['device_id'],
    units: [
      { position: 0, name: 'Alimentation', topic_pattern: 'wled/{device_id}/v',
        json_path: 'on', condition: null, transform: { type: 'passthrough' },
        output_field: 'power', output_type: 'boolean',
        display: { label: 'Allumé', icon: 'Lightbulb', on_label: 'Allumé', off_label: 'Éteint' } },
      { position: 1, name: 'Luminosité', topic_pattern: 'wled/{device_id}/v',
        json_path: 'bri', condition: null,
        transform: { type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100, round: true },
        output_field: 'brightness', output_type: 'number',
        display: { label: 'Luminosité', icon: 'Sun', unit: '%', min: 0, max: 100 } },
      { position: 2, name: 'Couleur', topic_pattern: 'wled/{device_id}/v',
        json_path: 'seg[0].col[0]', condition: null, transform: { type: 'rgb_to_hex' },
        output_field: 'color', output_type: 'color', display: { label: 'Couleur' } },
      { position: 3, name: 'Effet', topic_pattern: 'wled/{device_id}/v',
        json_path: 'seg[0].fx', condition: null, transform: { type: 'passthrough' },
        output_field: 'effect_id', output_type: 'number', display: { label: 'Effet' } },
      { position: 4, name: 'Palette', topic_pattern: 'wled/{device_id}/v',
        json_path: 'seg[0].pal', condition: null, transform: { type: 'passthrough' },
        output_field: 'palette_id', output_type: 'number', display: { label: 'Palette' } },
    ],
  },
  {
    key: 'tasmota-power',
    name: 'Tasmota POWER (relais)',
    description: 'Relais Tasmota : POWER / POWER1 / POWER2.',
    debounce_ms: null,
    layout: null,
    placeholders: ['prefix', 'device_id'],
    units: [
      { position: 0, name: 'Power', topic_pattern: '{prefix}tele/{device_id}/STATE',
        json_path: 'POWER', condition: null,
        transform: { type: 'enum_map', map: { ON: true, OFF: false } },
        output_field: 'power', output_type: 'boolean',
        display: { label: 'Allumé', icon: 'Plug', on_label: 'Allumé', off_label: 'Éteint' } },
      { position: 1, name: 'Identifiant', topic_pattern: '{prefix}tele/{device_id}/STATE',
        json_path: null, condition: null,
        transform: { type: 'enum_map', map: {}, default: '{device_id}' },
        output_field: 'device_id', output_type: 'string', display: null },
      { position: 2, name: 'RSSI', topic_pattern: '{prefix}tele/{device_id}/STATE',
        json_path: 'Wifi.RSSI', condition: null, transform: { type: 'passthrough' },
        output_field: 'rssi', output_type: 'number', display: { label: 'Signal', unit: 'dBm' } },
    ],
  },
  {
    key: 'tasmota-energy',
    name: 'Tasmota Énergie',
    description: 'Capteur Sonoff POW R2 ou équivalent (watt, kWh, voltage).',
    debounce_ms: null,
    layout: null,
    placeholders: ['prefix', 'device_id'],
    units: [
      { position: 0, name: 'Watt', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: 'ENERGY.Power', condition: null, transform: { type: 'passthrough' },
        output_field: 'watt', output_type: 'number',
        display: { label: 'Puissance', icon: 'Zap', unit: 'W' } },
      { position: 1, name: 'Voltage', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: 'ENERGY.Voltage', condition: null, transform: { type: 'passthrough' },
        output_field: 'voltage', output_type: 'number', display: { label: 'Tension', unit: 'V' } },
      { position: 2, name: 'Courant', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: 'ENERGY.Current', condition: null, transform: { type: 'passthrough' },
        output_field: 'current', output_type: 'number', display: { label: 'Courant', unit: 'A' } },
      { position: 3, name: 'kWh aujourd\'hui', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: 'ENERGY.Today', condition: null, transform: { type: 'passthrough' },
        output_field: 'kwh_today', output_type: 'number', display: { label: 'Aujourd\'hui', unit: 'kWh' } },
      { position: 4, name: 'kWh total', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: 'ENERGY.Total', condition: null, transform: { type: 'passthrough' },
        output_field: 'kwh_total', output_type: 'number', display: { label: 'Total', unit: 'kWh' } },
    ],
  },
  {
    key: 'tasmota-dht',
    name: 'Tasmota Température/Humidité',
    description: 'Capteurs ambiants (DHT22, AM2301, etc.) via topic SENSOR Tasmota.',
    debounce_ms: null,
    layout: null,
    placeholders: ['prefix', 'device_id', 'sensor'],
    units: [
      { position: 0, name: 'Température', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: '{sensor}.Temperature', condition: null, transform: { type: 'passthrough' },
        output_field: 'temperature', output_type: 'number',
        display: { label: 'Température', icon: 'Thermometer', unit: '°C' } },
      { position: 1, name: 'Humidité', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: '{sensor}.Humidity', condition: null, transform: { type: 'passthrough' },
        output_field: 'humidity', output_type: 'number', display: { label: 'Humidité', unit: '%' } },
    ],
  },
  {
    key: 'raw-passthrough',
    name: 'Passthrough brut',
    description: 'Affiche le payload brut sans interprétation (debug / inconnu).',
    debounce_ms: null,
    layout: null,
    placeholders: ['topic'],
    units: [
      { position: 0, name: 'Payload', topic_pattern: '{topic}',
        json_path: null, condition: null, transform: { type: 'passthrough' },
        output_field: 'payload', output_type: 'string', display: { label: 'Payload brut' } },
    ],
  },
]

export function findPreset(key: string): Preset | undefined {
  return PRESETS.find(p => p.key === key)
}

function substituteString(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? `{${name}}`)
}

export function applyPreset(preset: Preset, vars: Record<string, string>): UnitInput[] {
  return preset.units.map(u => ({
    ...u,
    topic_pattern: substituteString(u.topic_pattern, vars),
    json_path: u.json_path ? substituteString(u.json_path, vars) : null,
    transform: substituteTransform(u.transform, vars),
  }))
}

function substituteTransform(t: UnitInput['transform'], vars: Record<string, string>): UnitInput['transform'] {
  if (t.type === 'enum_map') {
    return {
      ...t,
      default: typeof t.default === 'string' ? substituteString(t.default, vars) : t.default,
    }
  }
  return t
}

export function extractVars(pattern: string, topic: string): Record<string, string> | null {
  const names: string[] = []
  let regexStr = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1) { regexStr += '\\{'; i++; continue }
      const name = pattern.slice(i + 1, end)
      names.push(name)
      regexStr += name === 'prefix' ? '(.*?)' : '([^/]+)'
      i = end + 1
    } else {
      const c = pattern[i]
      regexStr += /[.+?^$()|[\]\\]/.test(c) ? '\\' + c : c
      i++
    }
  }
  const m = new RegExp(`^${regexStr}$`).exec(topic)
  if (!m) return null
  const out: Record<string, string> = {}
  names.forEach((n, idx) => { out[n] = m[idx + 1] })
  return out
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

Run: `cd apps/backend && npx vitest run src/interpreters/presets.test.ts`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/backend/src/interpreters/presets.ts apps/backend/src/interpreters/presets.test.ts
git commit -m "feat(backend): add preset catalogue (frigate, wled, tasmota, raw)"
```

---

## Task 7 : CRUD `device_units` dans `db/registry.ts`

**Files:**
- Modify: `apps/backend/src/db/registry.ts`
- Modify: `apps/backend/src/db/registry.test.ts`

- [ ] **Step 1 : Réécrire `db/registry.ts`**

Remplacer entièrement `apps/backend/src/db/registry.ts` par :

```ts
import type Database from 'better-sqlite3'
import type { DeviceEntry, Unit, UnitInput, LayoutDescriptor } from '../interpreters/types'

interface DeviceRow {
  id: number
  name: string
  debounce_ms: number | null
  layout_json: string | null
  active: number
  created_at: number
  topic_patterns?: string | null
  interpreter_type?: string | null
}

interface UnitRow {
  id: number
  device_id: number
  position: number
  name: string
  topic_pattern: string
  json_path: string | null
  condition_json: string | null
  transform_json: string
  output_field: string
  output_type: string
  display_json: string | null
  created_at: number
}

function parseUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    device_id: row.device_id,
    position: row.position,
    name: row.name,
    topic_pattern: row.topic_pattern,
    json_path: row.json_path,
    condition: row.condition_json ? JSON.parse(row.condition_json) : null,
    transform: JSON.parse(row.transform_json),
    output_field: row.output_field,
    output_type: row.output_type as Unit['output_type'],
    display: row.display_json ? JSON.parse(row.display_json) : null,
  }
}

function parseDevice(row: DeviceRow, units: Unit[]): DeviceEntry {
  return {
    id: row.id,
    name: row.name,
    debounce_ms: row.debounce_ms,
    layout: row.layout_json ? JSON.parse(row.layout_json) : null,
    units,
    active: row.active === 1,
    created_at: row.created_at,
  }
}

export function getAllDevices(db: Database.Database): DeviceEntry[] {
  const devices = db.prepare('SELECT * FROM device_registry ORDER BY created_at ASC').all() as DeviceRow[]
  const units = db.prepare('SELECT * FROM device_units ORDER BY device_id, position ASC').all() as UnitRow[]
  const byDevice = new Map<number, Unit[]>()
  for (const u of units) {
    const arr = byDevice.get(u.device_id) ?? []
    arr.push(parseUnit(u))
    byDevice.set(u.device_id, arr)
  }
  return devices.map(d => parseDevice(d, byDevice.get(d.id) ?? []))
}

export function getDeviceById(db: Database.Database, id: number): DeviceEntry | null {
  const row = db.prepare('SELECT * FROM device_registry WHERE id = ?').get(id) as DeviceRow | undefined
  if (!row) return null
  const units = db.prepare('SELECT * FROM device_units WHERE device_id = ? ORDER BY position ASC').all(id) as UnitRow[]
  return parseDevice(row, units.map(parseUnit))
}

export function insertDeviceWithUnits(
  db: Database.Database,
  payload: { name: string; debounce_ms: number | null; layout: LayoutDescriptor | null; units: UnitInput[] },
): number {
  const now = Date.now()
  const tx = db.transaction(() => {
    const res = db.prepare(`
      INSERT INTO device_registry (name, topic_patterns, interpreter_type, debounce_ms, layout_json, active, created_at)
      VALUES (?, '[]', '', ?, ?, 1, ?)
    `).run(payload.name, payload.debounce_ms, payload.layout ? JSON.stringify(payload.layout) : null, now)
    const deviceId = res.lastInsertRowid as number
    insertUnits(db, deviceId, payload.units, now)
    return deviceId
  })
  return tx()
}

export function insertUnits(
  db: Database.Database,
  deviceId: number,
  units: UnitInput[],
  now: number,
): void {
  const stmt = db.prepare(`
    INSERT INTO device_units
      (device_id, position, name, topic_pattern, json_path, condition_json, transform_json, output_field, output_type, display_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const u of units) {
    stmt.run(
      deviceId,
      u.position,
      u.name,
      u.topic_pattern,
      u.json_path,
      u.condition ? JSON.stringify(u.condition) : null,
      JSON.stringify(u.transform),
      u.output_field,
      u.output_type,
      u.display ? JSON.stringify(u.display) : null,
      now,
    )
  }
}

export function deleteDevice(db: Database.Database, id: number): boolean {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM device_units WHERE device_id = ?').run(id)
    return db.prepare('DELETE FROM device_registry WHERE id = ?').run(id)
  })
  return tx().changes > 0
}

export function replaceDeviceUnits(
  db: Database.Database,
  deviceId: number,
  units: UnitInput[],
): void {
  const now = Date.now()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM device_units WHERE device_id = ?').run(deviceId)
    insertUnits(db, deviceId, units, now)
  })
  tx()
}

export function updateDeviceMeta(
  db: Database.Database,
  id: number,
  patch: { name?: string; debounce_ms?: number | null; layout?: LayoutDescriptor | null; active?: boolean },
): void {
  const sets: string[] = []
  const values: unknown[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); values.push(patch.name) }
  if (patch.debounce_ms !== undefined) { sets.push('debounce_ms = ?'); values.push(patch.debounce_ms) }
  if (patch.layout !== undefined) { sets.push('layout_json = ?'); values.push(patch.layout ? JSON.stringify(patch.layout) : null) }
  if (patch.active !== undefined) { sets.push('active = ?'); values.push(patch.active ? 1 : 0) }
  if (sets.length === 0) return
  values.push(id)
  db.prepare(`UPDATE device_registry SET ${sets.join(', ')} WHERE id = ?`).run(...values)
}

export function legacyRegistryRows(db: Database.Database): DeviceRow[] {
  return db.prepare(`
    SELECT r.* FROM device_registry r
    LEFT JOIN device_units u ON u.device_id = r.id
    WHERE u.id IS NULL
  `).all() as DeviceRow[]
}
```

- [ ] **Step 2 : Réécrire `db/registry.test.ts`**

Lire d'abord l'existant pour conserver les conventions du fichier puis remplacer entièrement par :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { applySchema } from './schema'
import {
  getAllDevices, getDeviceById, insertDeviceWithUnits,
  deleteDevice, replaceDeviceUnits, updateDeviceMeta, legacyRegistryRows,
} from './registry'
import type { UnitInput } from '../interpreters/types'

function freshDb(): Database.Database {
  const db = new BetterSqlite3(':memory:')
  applySchema(db)
  return db
}

const sampleUnit: UnitInput = {
  position: 0,
  name: 'Power',
  topic_pattern: 'home/lamp/state',
  json_path: 'POWER',
  condition: null,
  transform: { type: 'enum_map', map: { ON: true, OFF: false } },
  output_field: 'power',
  output_type: 'boolean',
  display: { label: 'Allumé', icon: 'Plug' },
}

describe('insertDeviceWithUnits + getAllDevices', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('insère un device avec ses units', () => {
    const id = insertDeviceWithUnits(db, {
      name: 'Lampe',
      debounce_ms: null,
      layout: null,
      units: [sampleUnit],
    })
    const list = getAllDevices(db)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].name).toBe('Lampe')
    expect(list[0].units).toHaveLength(1)
    expect(list[0].units[0].output_field).toBe('power')
    expect(list[0].units[0].transform).toEqual({ type: 'enum_map', map: { ON: true, OFF: false } })
  })

  it('persiste condition, display, layout sérialisés', () => {
    insertDeviceWithUnits(db, {
      name: 'D',
      debounce_ms: 300,
      layout: { groups: [{ title: 'Etat', fields: ['power'] }] },
      units: [{ ...sampleUnit, condition: { path: 'flag', op: 'eq', value: true } }],
    })
    const d = getAllDevices(db)[0]
    expect(d.debounce_ms).toBe(300)
    expect(d.layout).toEqual({ groups: [{ title: 'Etat', fields: ['power'] }] })
    expect(d.units[0].condition).toEqual({ path: 'flag', op: 'eq', value: true })
    expect(d.units[0].display).toEqual({ label: 'Allumé', icon: 'Plug' })
  })

  it('tri par position', () => {
    insertDeviceWithUnits(db, {
      name: 'D', debounce_ms: null, layout: null,
      units: [
        { ...sampleUnit, position: 2, output_field: 'a' },
        { ...sampleUnit, position: 0, output_field: 'b' },
        { ...sampleUnit, position: 1, output_field: 'c' },
      ],
    })
    const d = getAllDevices(db)[0]
    expect(d.units.map(u => u.output_field)).toEqual(['b', 'c', 'a'])
  })
})

describe('getDeviceById', () => {
  it('retourne null si inexistant', () => {
    const db = freshDb()
    expect(getDeviceById(db, 999)).toBeNull()
  })
})

describe('deleteDevice', () => {
  it('supprime device et units en cascade', () => {
    const db = freshDb()
    const id = insertDeviceWithUnits(db, { name: 'D', debounce_ms: null, layout: null, units: [sampleUnit] })
    expect(deleteDevice(db, id)).toBe(true)
    expect(getAllDevices(db)).toHaveLength(0)
    const remainingUnits = db.prepare('SELECT COUNT(*) as n FROM device_units').get() as { n: number }
    expect(remainingUnits.n).toBe(0)
  })

  it('retourne false si inconnu', () => {
    const db = freshDb()
    expect(deleteDevice(db, 999)).toBe(false)
  })
})

describe('replaceDeviceUnits', () => {
  it('remplace tous les units', () => {
    const db = freshDb()
    const id = insertDeviceWithUnits(db, { name: 'D', debounce_ms: null, layout: null, units: [sampleUnit] })
    replaceDeviceUnits(db, id, [
      { ...sampleUnit, output_field: 'replaced' },
    ])
    const d = getDeviceById(db, id)!
    expect(d.units).toHaveLength(1)
    expect(d.units[0].output_field).toBe('replaced')
  })
})

describe('updateDeviceMeta', () => {
  it('met à jour les champs présents seulement', () => {
    const db = freshDb()
    const id = insertDeviceWithUnits(db, { name: 'A', debounce_ms: null, layout: null, units: [sampleUnit] })
    updateDeviceMeta(db, id, { name: 'B', debounce_ms: 500 })
    const d = getDeviceById(db, id)!
    expect(d.name).toBe('B')
    expect(d.debounce_ms).toBe(500)
  })

  it('peut désactiver un device', () => {
    const db = freshDb()
    const id = insertDeviceWithUnits(db, { name: 'A', debounce_ms: null, layout: null, units: [sampleUnit] })
    updateDeviceMeta(db, id, { active: false })
    expect(getDeviceById(db, id)!.active).toBe(false)
  })
})

describe('legacyRegistryRows', () => {
  it('retourne les rows sans units associés', () => {
    const db = freshDb()
    db.prepare(`
      INSERT INTO device_registry (name, topic_patterns, interpreter_type, active, created_at)
      VALUES (?, ?, ?, 1, ?)
    `).run('LegacyFrigate', '["frigate/+/events"]', 'frigate', Date.now())
    const id = insertDeviceWithUnits(db, { name: 'New', debounce_ms: null, layout: null, units: [sampleUnit] })
    const legacy = legacyRegistryRows(db)
    expect(legacy).toHaveLength(1)
    expect(legacy[0].name).toBe('LegacyFrigate')
    expect(legacy.some(r => r.id === id)).toBe(false)
  })
})
```

- [ ] **Step 3 : Lancer les tests**

Run: `cd apps/backend && npx vitest run src/db/registry.test.ts`
Expected : PASS.

- [ ] **Step 4 : Commit**

```bash
git add apps/backend/src/db/registry.ts apps/backend/src/db/registry.test.ts
git commit -m "feat(backend): rewrite device registry CRUD for units model"
```

Note : la fonction `seedDeviceRegistry` n'est plus exportée — l'appel dans `index.ts` sera traité à la Task 9 (migration upgrade-in-place qui la remplace).

---

## Task 8 : `createUnitRegistry` — routing en mémoire

**Files:**
- Create: `apps/backend/src/interpreters/registry.ts`
- Create: `apps/backend/src/interpreters/registry.test.ts`

- [ ] **Step 1 : Écrire les tests**

Créer `apps/backend/src/interpreters/registry.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { createUnitRegistry } from './registry'
import type { DeviceEntry, UnitInput } from './types'

let nextId = 1
function makeDevice(name: string, units: UnitInput[], debounceMs: number | null = null): DeviceEntry {
  return {
    id: nextId++,
    name,
    debounce_ms: debounceMs,
    layout: null,
    units: units.map((u, i) => ({ ...u, id: i + 1, device_id: nextId - 1 })),
    active: true,
    created_at: Date.now(),
  }
}

const tasmotaUnits: UnitInput[] = [
  {
    position: 0, name: 'Power',
    topic_pattern: 'tele/chambre/STATE',
    json_path: 'POWER', condition: null,
    transform: { type: 'enum_map', map: { ON: true, OFF: false } },
    output_field: 'power', output_type: 'boolean', display: null,
  },
]

describe('createUnitRegistry.route', () => {
  it('match topic exact + extraction + transform', () => {
    const reg = createUnitRegistry([makeDevice('Lampe', tasmotaUnits)])
    const results = reg.route('tele/chambre/STATE', Buffer.from('{"POWER":"ON"}'))
    expect(results).toHaveLength(1)
    expect(results[0].partial_state).toEqual({ power: true })
  })

  it('aucun match → []', () => {
    const reg = createUnitRegistry([makeDevice('Lampe', tasmotaUnits)])
    expect(reg.route('other/topic', Buffer.from('{}'))).toEqual([])
  })

  it('plusieurs units du même device s\'agrègent dans un seul partial_state', () => {
    const units: UnitInput[] = [
      { position: 0, name: 'a', topic_pattern: 'home/x', json_path: 'a', condition: null,
        transform: { type: 'passthrough' }, output_field: 'a', output_type: 'number', display: null },
      { position: 1, name: 'b', topic_pattern: 'home/x', json_path: 'b', condition: null,
        transform: { type: 'passthrough' }, output_field: 'b', output_type: 'number', display: null },
    ]
    const reg = createUnitRegistry([makeDevice('D', units)])
    const r = reg.route('home/x', Buffer.from('{"a":1,"b":2}'))
    expect(r).toHaveLength(1)
    expect(r[0].partial_state).toEqual({ a: 1, b: 2 })
  })

  it('payload non-JSON → utilisé comme string brute', () => {
    const units: UnitInput[] = [
      { position: 0, name: 'p', topic_pattern: 'home/y', json_path: null, condition: null,
        transform: { type: 'passthrough' }, output_field: 'value', output_type: 'string', display: null },
    ]
    const reg = createUnitRegistry([makeDevice('D', units)])
    const r = reg.route('home/y', Buffer.from('plaintext'))
    expect(r[0].partial_state.value).toBe('plaintext')
  })

  it('device inactif n\'est pas routé', () => {
    const d = makeDevice('D', tasmotaUnits)
    d.active = false
    const reg = createUnitRegistry([d])
    expect(reg.route('tele/chambre/STATE', Buffer.from('{"POWER":"ON"}'))).toEqual([])
  })

  it('addDevice ajoute à chaud', () => {
    const reg = createUnitRegistry([])
    expect(reg.route('tele/chambre/STATE', Buffer.from('{"POWER":"ON"}'))).toEqual([])
    reg.addDevice(makeDevice('Lampe', tasmotaUnits))
    expect(reg.route('tele/chambre/STATE', Buffer.from('{"POWER":"ON"}'))).toHaveLength(1)
  })

  it('removeDevice retire à chaud', () => {
    const d = makeDevice('Lampe', tasmotaUnits)
    const reg = createUnitRegistry([d])
    reg.removeDevice(d.id)
    expect(reg.route('tele/chambre/STATE', Buffer.from('{"POWER":"ON"}'))).toEqual([])
  })

  it('getAllTopics retourne l\'union des topic_patterns actifs', () => {
    const reg = createUnitRegistry([
      makeDevice('A', tasmotaUnits),
      makeDevice('B', [{ ...tasmotaUnits[0], topic_pattern: 'home/lamp/v' }]),
    ])
    expect(reg.getAllTopics().sort()).toEqual(['home/lamp/v', 'tele/chambre/STATE'])
  })

  it('getDebounceMs retourne null si non défini', () => {
    const d = makeDevice('A', tasmotaUnits, null)
    const reg = createUnitRegistry([d])
    expect(reg.getDebounceMs(d.id)).toBeNull()
  })

  it('getDebounceMs retourne la valeur du device', () => {
    const d = makeDevice('A', tasmotaUnits, 200)
    const reg = createUnitRegistry([d])
    expect(reg.getDebounceMs(d.id)).toBe(200)
  })
})
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

Run: `cd apps/backend && npx vitest run src/interpreters/registry.test.ts`
Expected : FAIL avec `Cannot find module './registry'`.

- [ ] **Step 3 : Implémenter `registry.ts`**

Créer `apps/backend/src/interpreters/registry.ts` :

```ts
import type { DeviceEntry, RouteResult } from './types'
import { evalUnit } from './eval'
import { mqttTopicMatches } from '../mqtt/matcher'

export interface UnitRegistry {
  getAllTopics(): string[]
  route(topic: string, payload: Buffer): RouteResult[]
  getDebounceMs(deviceId: number): number | null
  addDevice(entry: DeviceEntry): void
  removeDevice(id: number): void
  replaceDevice(entry: DeviceEntry): void
  getDevice(id: number): DeviceEntry | undefined
}

export function createUnitRegistry(initial: DeviceEntry[]): UnitRegistry {
  let devices: DeviceEntry[] = [...initial]

  function parsePayload(buf: Buffer): unknown {
    const str = buf.toString()
    try {
      return JSON.parse(str)
    } catch {
      return str
    }
  }

  return {
    getAllTopics() {
      const set = new Set<string>()
      for (const d of devices) {
        if (!d.active) continue
        for (const u of d.units) set.add(u.topic_pattern)
      }
      return Array.from(set)
    },

    route(topic, payload) {
      const parsed = parsePayload(payload)
      const raw = payload.toString()
      const results: RouteResult[] = []

      for (const d of devices) {
        if (!d.active) continue
        const partial: Record<string, unknown> = {}
        let touched = false
        for (const u of d.units) {
          if (!mqttTopicMatches(u.topic_pattern, topic)) continue
          const res = evalUnit(u, parsed)
          if (res.emitted && res.output_field) {
            partial[res.output_field] = res.value
            touched = true
          }
        }
        if (touched) results.push({ device_id: d.id, partial_state: partial, raw })
      }
      return results
    },

    getDebounceMs(deviceId) {
      const d = devices.find(x => x.id === deviceId)
      return d?.debounce_ms ?? null
    },

    addDevice(entry) {
      devices = [...devices, entry]
    },

    removeDevice(id) {
      devices = devices.filter(d => d.id !== id)
    },

    replaceDevice(entry) {
      devices = devices.map(d => d.id === entry.id ? entry : d)
    },

    getDevice(id) {
      return devices.find(d => d.id === id)
    },
  }
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

Run: `cd apps/backend && npx vitest run src/interpreters/registry.test.ts`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/backend/src/interpreters/registry.ts apps/backend/src/interpreters/registry.test.ts
git commit -m "feat(backend): add unit registry with topic routing"
```

---

## Task 9 : Migration legacy upgrade-in-place

**Files:**
- Modify: `apps/backend/src/db/registry.ts`
- Modify: `apps/backend/src/db/registry.test.ts`

- [ ] **Step 1 : Ajouter les tests de migration**

Ajouter à la fin de `apps/backend/src/db/registry.test.ts` :

```ts
import { migrateLegacyRegistry } from './registry'

function insertLegacyRow(db: Database.Database, name: string, patterns: string[], interpreterType: string): number {
  const r = db.prepare(`
    INSERT INTO device_registry (name, topic_patterns, interpreter_type, active, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(name, JSON.stringify(patterns), interpreterType, Date.now())
  return r.lastInsertRowid as number
}

describe('migrateLegacyRegistry', () => {
  it('migre une row Frigate (frigate/principale/events)', () => {
    const db = freshDb()
    insertLegacyRow(db, 'Caméra entrée', ['frigate/principale/events'], 'frigate')
    migrateLegacyRegistry(db, '')
    const all = getAllDevices(db)
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('Caméra entrée')
    expect(all[0].debounce_ms).toBe(300)
    expect(all[0].units.every(u => u.topic_pattern === 'frigate/principale/events')).toBe(true)
    expect(all[0].units.find(u => u.output_field === 'object')).toBeDefined()
  })

  it('migre une row WLED (wled/salon/v)', () => {
    const db = freshDb()
    insertLegacyRow(db, 'WLED salon', ['wled/salon/v'], 'wled')
    migrateLegacyRegistry(db, '')
    const all = getAllDevices(db)
    expect(all[0].units.every(u => u.topic_pattern === 'wled/salon/v')).toBe(true)
    expect(all[0].units.find(u => u.output_field === 'brightness')).toBeDefined()
  })

  it('migre une row Tasmota avec prefix vide', () => {
    const db = freshDb()
    insertLegacyRow(db, 'Lampe chambre', ['tele/chambre/STATE'], 'tasmota')
    migrateLegacyRegistry(db, '')
    const d = getAllDevices(db)[0]
    expect(d.units.every(u => u.topic_pattern === 'tele/chambre/STATE')).toBe(true)
  })

  it('migre une row Tasmota avec prefix custom', () => {
    const db = freshDb()
    insertLegacyRow(db, 'Tasmota', ['home/chambre/lumiere/tele/chambre/STATE'], 'tasmota')
    migrateLegacyRegistry(db, 'home/chambre/lumiere/')
    const d = getAllDevices(db)[0]
    expect(d.units[0].topic_pattern).toBe('home/chambre/lumiere/tele/chambre/STATE')
  })

  it('migre une row raw avec un topic exact', () => {
    const db = freshDb()
    insertLegacyRow(db, 'Sonde', ['home/garage/temp'], 'raw')
    migrateLegacyRegistry(db, '')
    const d = getAllDevices(db)[0]
    expect(d.units[0].topic_pattern).toBe('home/garage/temp')
    expect(d.units[0].output_field).toBe('payload')
  })

  it('idempotente : second appel ne change rien', () => {
    const db = freshDb()
    insertLegacyRow(db, 'Frigate', ['frigate/principale/events'], 'frigate')
    migrateLegacyRegistry(db, '')
    const before = getAllDevices(db)
    migrateLegacyRegistry(db, '')
    const after = getAllDevices(db)
    expect(after).toHaveLength(before.length)
    expect(after[0].units.length).toBe(before[0].units.length)
  })

  it('ignore les rows déjà migrées (qui ont des units)', () => {
    const db = freshDb()
    insertDeviceWithUnits(db, { name: 'Already', debounce_ms: null, layout: null, units: [sampleUnit] })
    migrateLegacyRegistry(db, '')
    const d = getAllDevices(db)[0]
    expect(d.name).toBe('Already')
    expect(d.units).toHaveLength(1)
  })

  it('log warning et désactive si extraction du placeholder échoue', () => {
    const db = freshDb()
    insertLegacyRow(db, 'Cas exotique', ['custom/strange/topic'], 'frigate')
    migrateLegacyRegistry(db, '')
    const d = getAllDevices(db)[0]
    expect(d.active).toBe(false)
  })
})
```

- [ ] **Step 2 : Implémenter `migrateLegacyRegistry` dans `db/registry.ts`**

Ajouter à la fin de `apps/backend/src/db/registry.ts` :

```ts
import { findPreset, applyPreset, extractVars } from '../interpreters/presets'

const INTERPRETER_TO_PRESET: Record<string, string> = {
  frigate: 'frigate-camera',
  wled: 'wled',
  tasmota: 'tasmota-power',
  raw: 'raw-passthrough',
}

function deriveVarsForMigration(
  presetKey: string,
  legacyPattern: string,
  tasmotaPrefix: string,
): Record<string, string> | null {
  const preset = findPreset(presetKey)
  if (!preset) return null
  if (presetKey === 'raw-passthrough') return { topic: legacyPattern }
  if (presetKey === 'tasmota-power') {
    const refPattern = preset.units[0].topic_pattern.replace('{prefix}', tasmotaPrefix)
    const vars = extractVars(refPattern, legacyPattern)
    if (!vars) return null
    return { prefix: tasmotaPrefix, device_id: vars.device_id ?? '+' }
  }
  return extractVars(preset.units[0].topic_pattern, legacyPattern)
}

export function migrateLegacyRegistry(db: Database.Database, tasmotaPrefix: string): void {
  const rows = legacyRegistryRows(db)
  for (const row of rows) {
    const interpreterType = row.interpreter_type ?? ''
    const presetKey = INTERPRETER_TO_PRESET[interpreterType]
    if (!presetKey) {
      console.warn(`[Migration] interpreter_type inconnu pour device ${row.id} (${row.name}): ${interpreterType}`)
      updateDeviceMeta(db, row.id, { active: false })
      continue
    }
    const preset = findPreset(presetKey)
    if (!preset) {
      console.warn(`[Migration] preset introuvable: ${presetKey}`)
      updateDeviceMeta(db, row.id, { active: false })
      continue
    }
    const patterns: string[] = row.topic_patterns ? JSON.parse(row.topic_patterns) : []
    const firstPattern = patterns[0]
    if (!firstPattern) {
      console.warn(`[Migration] device ${row.id} (${row.name}) sans topic_patterns, désactivé`)
      updateDeviceMeta(db, row.id, { active: false })
      continue
    }
    const vars = deriveVarsForMigration(presetKey, firstPattern, tasmotaPrefix)
    if (!vars) {
      console.warn(`[Migration] impossible d'extraire les placeholders pour ${row.name} (${firstPattern}), device désactivé`)
      updateDeviceMeta(db, row.id, { active: false })
      continue
    }
    const units = applyPreset(preset, vars)
    insertUnits(db, row.id, units, Date.now())
    updateDeviceMeta(db, row.id, { debounce_ms: preset.debounce_ms })
    console.log(`[Migration] device ${row.id} (${row.name}) migré vers preset ${presetKey}`)
  }
}
```

- [ ] **Step 3 : Lancer les tests**

Run: `cd apps/backend && npx vitest run src/db/registry.test.ts`
Expected : PASS.

- [ ] **Step 4 : Commit**

```bash
git add apps/backend/src/db/registry.ts apps/backend/src/db/registry.test.ts
git commit -m "feat(backend): migrate legacy device rows to unit-based model"
```

---

## Task 10 : Route API `GET /api/presets`

**Files:**
- Create: `apps/backend/src/api/presets-routes.ts`

- [ ] **Step 1 : Écrire la route**

Créer `apps/backend/src/api/presets-routes.ts` :

```ts
import type { FastifyInstance } from 'fastify'
import { PRESETS } from '../interpreters/presets'

export function registerPresetsRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/presets', async (_req, reply) => {
    return reply.send({ presets: PRESETS })
  })
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `cd apps/backend && npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add apps/backend/src/api/presets-routes.ts
git commit -m "feat(backend): add GET /api/presets route"
```

---

## Task 11 : Refactor des routes `/api/registry`

**Files:**
- Modify: `apps/backend/src/api/registry-routes.ts`

- [ ] **Step 1 : Réécrire `registry-routes.ts`**

Remplacer entièrement `apps/backend/src/api/registry-routes.ts` par :

```ts
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import type { UnitRegistry } from '../interpreters/registry'
import {
  getAllDevices, getDeviceById, insertDeviceWithUnits, deleteDevice,
  replaceDeviceUnits, updateDeviceMeta,
} from '../db/registry'
import { validateDevicePayload } from '../interpreters/validate'

export function registerRegistryRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  registry: UnitRegistry,
): void {
  fastify.get('/api/registry', async (_req, reply) => {
    return reply.send({ devices: getAllDevices(db) })
  })

  fastify.post('/api/registry', async (req, reply) => {
    const res = validateDevicePayload(req.body)
    if (!res.ok) return reply.status(400).send({ error: res.error })

    const id = insertDeviceWithUnits(db, {
      name: res.value.name,
      debounce_ms: res.value.debounce_ms ?? null,
      layout: res.value.layout ?? null,
      units: res.value.units,
    })
    const created = getDeviceById(db, id)
    if (created) registry.addDevice(created)

    return reply.status(201).send({ id })
  })

  fastify.patch('/api/registry/:id', async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(id)) return reply.status(400).send({ error: 'id invalide' })

    const existing = getDeviceById(db, id)
    if (!existing) return reply.status(404).send({ error: 'Device introuvable' })

    const res = validateDevicePayload(req.body)
    if (!res.ok) return reply.status(400).send({ error: res.error })

    updateDeviceMeta(db, id, {
      name: res.value.name,
      debounce_ms: res.value.debounce_ms ?? null,
      layout: res.value.layout ?? null,
    })
    replaceDeviceUnits(db, id, res.value.units)

    const updated = getDeviceById(db, id)
    if (updated) registry.replaceDevice(updated)

    return reply.send({ ok: true })
  })

  fastify.delete('/api/registry/:id', async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(id)) return reply.status(400).send({ error: 'id invalide' })
    const deleted = deleteDevice(db, id)
    if (!deleted) return reply.status(404).send({ error: 'Device introuvable' })
    registry.removeDevice(id)
    return reply.status(204).send()
  })
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `cd apps/backend && npx tsc --noEmit`
Expected : aucune erreur (les imports `DynamicRegistry` ont disparu — `index.ts` sera mis à jour à la Task 13).

- [ ] **Step 3 : Commit**

```bash
git add apps/backend/src/api/registry-routes.ts
git commit -m "feat(backend): refactor /api/registry for unit-based device model"
```

---

## Task 12 : Tests de parité

**Files:**
- Create: `apps/backend/src/interpreters/parity.test.ts`

- [ ] **Step 1 : Écrire les tests de parité**

Créer `apps/backend/src/interpreters/parity.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { frigateInterpreter } from './frigate'
import { wledInterpreter } from './wled'
import { createTasmotaInterpreter } from './tasmota'
import { createUnitRegistry } from './registry'
import { createAggregator } from './aggregator'
import { findPreset, applyPreset } from './presets'
import type { DeviceEntry } from './types'

function buildDevice(id: number, name: string, presetKey: string, vars: Record<string, string>, debounceMs: number | null = null): DeviceEntry {
  const preset = findPreset(presetKey)!
  const units = applyPreset(preset, vars).map((u, i) => ({ ...u, id: i + 1, device_id: id }))
  return { id, name, debounce_ms: debounceMs, layout: null, units, active: true, created_at: 0 }
}

function compareStates(legacy: Record<string, unknown>, fresh: Record<string, unknown>): void {
  for (const k of Object.keys(legacy)) {
    expect(fresh[k]).toEqual(legacy[k])
  }
}

describe('Parité Frigate detection_start (type=new)', () => {
  it('produit les mêmes champs que l\'ancien interpréteur', () => {
    const payload = JSON.stringify({
      type: 'new',
      after: { id: 'evt-1', label: 'person', camera: 'chambre', current_zones: ['bureau'], score: 0.876 },
    })
    const legacy = frigateInterpreter.parse('frigate/chambre/events', Buffer.from(payload))!

    const device = buildDevice(1, 'Frigate', 'frigate-camera', { camera: 'chambre' }, 300)
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('frigate/chambre/events', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.event_type).toBe(legacy.event_type)
    expect(state.state.object).toBe(legacy.state.object)
    expect(state.state.zone).toBe(legacy.state.zone)
    expect(state.state.confidence).toBe(legacy.state.confidence)
    expect(state.state.camera).toBe(legacy.state.camera)
    expect(state.state.active).toBe(legacy.state.active)
  })
})

describe('Parité Frigate detection_end (type=end)', () => {
  it('produit les mêmes champs', () => {
    const payload = JSON.stringify({
      type: 'end',
      after: { id: 'evt-1', label: 'person', camera: 'chambre', current_zones: ['bureau'], score: 0.91 },
    })
    const legacy = frigateInterpreter.parse('frigate/chambre/events', Buffer.from(payload))!

    const device = buildDevice(1, 'Frigate', 'frigate-camera', { camera: 'chambre' }, 300)
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('frigate/chambre/events', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.event_type).toBe('detection_end')
    expect(state.state.active).toBe(false)
  })
})

describe('Parité WLED', () => {
  it('on/off, brightness, color, fx, pal', () => {
    const payload = JSON.stringify({ on: true, bri: 128, seg: [{ col: [[255, 100, 0]], fx: 3, pal: 1 }] })
    const legacy = wledInterpreter.parse('wled/salon/v', Buffer.from(payload))!

    const device = buildDevice(2, 'WLED', 'wled', { device_id: 'salon' })
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('wled/salon/v', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.state.power).toBe(legacy.state.power)
    expect(state.state.brightness).toBe(legacy.state.brightness)
    expect((state.state.color as string).toLowerCase()).toBe((legacy.state.color as string).toLowerCase())
    expect(state.state.effect_id).toBe(legacy.state.effect_id)
    expect(state.state.palette_id).toBe(legacy.state.palette_id)
  })
})

describe('Parité Tasmota STATE (POWER)', () => {
  it('produit power=true et device_id', () => {
    const tasmota = createTasmotaInterpreter('')
    const payload = JSON.stringify({ POWER: 'ON', Wifi: { RSSI: 50 } })
    const legacy = tasmota.parse('tele/chambre/STATE', Buffer.from(payload))!

    const device = buildDevice(3, 'Tasmota', 'tasmota-power', { prefix: '', device_id: 'chambre' })
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('tele/chambre/STATE', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.state.power).toBe(legacy.state.power)
    expect(state.state.rssi).toBe(legacy.state.rssi)
  })
})

describe('Parité Tasmota SENSOR (énergie)', () => {
  it('watt, voltage, kwh', () => {
    const tasmota = createTasmotaInterpreter('')
    const payload = JSON.stringify({
      ENERGY: { Power: 150, Voltage: 230, Current: 0.65, Today: 1.2, Total: 42.5 },
    })
    const legacy = tasmota.parse('tele/chambre/SENSOR', Buffer.from(payload))!

    const device = buildDevice(4, 'Tasmota Energy', 'tasmota-energy', { prefix: '', device_id: 'chambre' })
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('tele/chambre/SENSOR', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.state.watt).toBe(legacy.state.watt)
    expect(state.state.voltage).toBe(legacy.state.voltage)
    expect(state.state.kwh_today).toBe(legacy.state.kwh_today)
    expect(state.state.kwh_total).toBe(legacy.state.kwh_total)
  })
})

describe('Parité Tasmota SENSOR (température/humidité)', () => {
  it('AM2301', () => {
    const tasmota = createTasmotaInterpreter('')
    const payload = JSON.stringify({ AM2301: { Temperature: 22.5, Humidity: 55 } })
    const legacy = tasmota.parse('tele/chambre/SENSOR', Buffer.from(payload))!

    const device = buildDevice(5, 'Tasmota DHT', 'tasmota-dht', { prefix: '', device_id: 'chambre', sensor: 'AM2301' })
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('tele/chambre/SENSOR', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.state.temperature).toBe(legacy.state.temperature)
    expect(state.state.humidity).toBe(legacy.state.humidity)
  })
})
```

- [ ] **Step 2 : Lancer les tests**

Run: `cd apps/backend && npx vitest run src/interpreters/parity.test.ts`
Expected : PASS (toutes les assertions de parité).

- [ ] **Step 3 : Commit**

```bash
git add apps/backend/src/interpreters/parity.test.ts
git commit -m "test(backend): add parity tests against legacy interpreters"
```

---

## Task 13 : Câblage dans `index.ts`

**Files:**
- Modify: `apps/backend/src/index.ts`

- [ ] **Step 1 : Réécrire `apps/backend/src/index.ts`**

Remplacer entièrement `apps/backend/src/index.ts` par :

```ts
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import cors from '@fastify/cors'
import { config } from './config'
import { createDb } from './db/client'
import { applySchema } from './db/schema'
import { createRetentionJob } from './db/retention'
import { createRedisStore } from './store/redis'
import { createDedupStore } from './pipeline/dedup'
import { createDebounce } from './pipeline/debounce'
import { getAllDevices, migrateLegacyRegistry } from './db/registry'
import { createUnitRegistry } from './interpreters/registry'
import { createAggregator } from './interpreters/aggregator'
import { upsertTopicSeen } from './db/topics'
import { registerTopicsRoutes } from './api/topics-routes'
import { registerRegistryRoutes } from './api/registry-routes'
import { registerPresetsRoutes } from './api/presets-routes'
import { createMqttClient } from './mqtt/client'
import { createBroadcaster, registerWsRoutes } from './ws/server'
import { registerDeviceRoutes } from './api/devices'
import { registerHistoryRoutes } from './api/history'
import { insertEvent, insertSnapshot } from './db/queries'

async function main() {
  const db = createDb(config.db.path)
  applySchema(db)
  migrateLegacyRegistry(db, config.tasmota.topicPrefix)

  const devices = getAllDevices(db)
  const unitRegistry = createUnitRegistry(devices)
  const aggregator = createAggregator()

  const redisStore = createRedisStore(config.redis.url)
  const dedupStore = createDedupStore()
  const broadcaster = createBroadcaster()

  const fastify = Fastify({ logger: true })
  await fastify.register(cors, { origin: true })
  await fastify.register(websocket)

  registerWsRoutes(fastify, broadcaster, redisStore)
  registerDeviceRoutes(fastify, redisStore)
  registerHistoryRoutes(fastify, db)
  registerTopicsRoutes(fastify, db)
  registerRegistryRoutes(fastify, db, unitRegistry)
  registerPresetsRoutes(fastify)

  const retentionJob = createRetentionJob(db, config.retention.days)
  retentionJob.start()

  const debounceMap = new Map<number, ReturnType<typeof createDebounce>>()
  function getDebounce(deviceId: number): ReturnType<typeof createDebounce> | null {
    const ms = unitRegistry.getDebounceMs(deviceId)
    if (!ms) return null
    if (!debounceMap.has(deviceId)) debounceMap.set(deviceId, createDebounce(ms))
    return debounceMap.get(deviceId)!
  }

  function processMessage(topic: string, payload: Buffer) {
    const results = unitRegistry.route(topic, payload)

    setImmediate(() => {
      try {
        const firstSource = results[0] ? results[0].device_id.toString() : null
        upsertTopicSeen(db, topic, firstSource)
      } catch (e) {
        console.error('[Catalogue] Upsert error:', e)
      }
    })

    for (const result of results) {
      const state = aggregator.merge(result.device_id, result.partial_state, result.raw)
      const key = state.source
      const debounce = getDebounce(result.device_id)

      const handle = () => {
        if (!dedupStore.hasChanged(key, state)) {
          console.log(`[Pipeline] Dedup — état inchangé pour: ${key}`)
          return
        }
        dedupStore.update(key, state)
        console.log(`[Pipeline] Broadcast — ${key} | event: ${state.event_type}`)
        broadcaster.broadcast(key, state)
        redisStore.setDeviceState(key, state).catch(console.error)

        setImmediate(() => {
          insertEvent(db, {
            source: state.source,
            topic,
            event_type: state.event_type,
            payload: JSON.stringify(state.state),
            raw: state.raw,
            created_at: state.timestamp,
          })
          insertSnapshot(db, state.source, JSON.stringify(state.state))
        })
      }

      if (debounce) debounce(String(result.device_id), handle)
      else handle()
    }
  }

  createMqttClient({
    host: config.mqtt.host,
    port: config.mqtt.port,
    username: config.mqtt.username,
    password: config.mqtt.password,
    topics: ['#'],
    onMessage: processMessage,
  })

  await fastify.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`[Server] Backend running on port ${config.port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `cd apps/backend && npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 3 : Lancer toute la suite de tests**

Run: `cd apps/backend && npx vitest run`
Expected : tous les tests passent.

- [ ] **Step 4 : Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "feat(backend): wire unit registry and aggregator into pipeline"
```

---

## Task 14 : Suppression du code obsolète

**Files:**
- Delete: `apps/backend/src/interpreters/frigate.ts`
- Delete: `apps/backend/src/interpreters/wled.ts`
- Delete: `apps/backend/src/interpreters/tasmota.ts`
- Delete: `apps/backend/src/interpreters/raw.ts`
- Delete: `apps/backend/src/interpreters/dynamic.ts`
- Delete: `apps/backend/src/interpreters/index.ts`
- Delete: `apps/backend/src/interpreters/parity.test.ts`
- Modify: `apps/backend/src/interpreters/types.ts` (retirer `Interpreter`)
- Modify: `apps/backend/src/db/schema.ts` (retirer colonnes `topic_patterns`, `interpreter_type`)

> ⚠️ **N'exécute cette task QUE lorsque les Tasks 1-13 sont mergées sur Main et que la nouvelle pipeline tourne en environnement réel pendant au moins une session de validation.**

- [ ] **Step 1 : Vérifier qu'aucun import des anciens interpréteurs ne reste hors des fichiers à supprimer**

Run:
```bash
cd apps/backend && grep -rE "from './(frigate|wled|tasmota|raw|dynamic)'" src/ | grep -v "src/interpreters/(frigate|wled|tasmota|raw|dynamic)"
```
Expected : aucun match. Seul `parity.test.ts` peut référencer ces fichiers et il est supprimé à la même task.

- [ ] **Step 2 : Supprimer les fichiers**

```bash
rm apps/backend/src/interpreters/frigate.ts \
   apps/backend/src/interpreters/wled.ts \
   apps/backend/src/interpreters/tasmota.ts \
   apps/backend/src/interpreters/raw.ts \
   apps/backend/src/interpreters/dynamic.ts \
   apps/backend/src/interpreters/index.ts \
   apps/backend/src/interpreters/parity.test.ts
```

Si des fichiers `*.test.ts` correspondants existent pour `frigate`, `wled`, `tasmota`, `raw`, `dynamic`, les supprimer aussi.

- [ ] **Step 3 : Retirer `Interpreter` de `types.ts`**

Dans `apps/backend/src/interpreters/types.ts`, supprimer ces lignes :

```ts
export interface Interpreter {
  source: string
  topics: string[]
  debounceMs?: number
  parse(topic: string, payload: Buffer): DeviceState | null
}
```

- [ ] **Step 4 : Retirer les colonnes obsolètes de `device_registry`**

Modifier `apps/backend/src/db/schema.ts` pour reconstruire la table sans les colonnes héritées. Ajouter à la fin de `applySchema(db)` (avant les ajouts de colonnes idempotents) :

```ts
  if (hasColumn(db, 'device_registry', 'topic_patterns')) {
    db.exec(`
      CREATE TABLE device_registry_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT    NOT NULL,
        debounce_ms      INTEGER,
        layout_json      TEXT,
        active           INTEGER NOT NULL DEFAULT 1,
        created_at       INTEGER NOT NULL
      );
      INSERT INTO device_registry_new (id, name, debounce_ms, layout_json, active, created_at)
        SELECT id, name, debounce_ms, layout_json, active, created_at FROM device_registry;
      DROP TABLE device_registry;
      ALTER TABLE device_registry_new RENAME TO device_registry;
    `)
  }
```

- [ ] **Step 5 : Vérifier la compilation et les tests**

Run: `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected : compilation propre et tous les tests passent (sauf ceux qui dépendaient des fichiers supprimés).

- [ ] **Step 6 : Commit**

```bash
git add -A apps/backend/src/
git commit -m "chore(backend): remove legacy interpreters and obsolete columns"
```

---

## Phase B — Frontend (différée)

> ⚠️ **NE PAS exécuter cette phase tant que `feat/topics-tree` n'est pas mergée sur Main.** Les fichiers touchés (`apps/frontend/src/app/page.tsx`, `apps/frontend/src/app/devices/page.tsx`, `apps/frontend/src/components/devices/*`) sont en cours de refonte par ce chantier parallèle.

### Aperçu des tâches frontend à venir

À écrire dans un plan séparé après le merge :

1. **Création des widgets génériques** dans `apps/frontend/src/components/devices/widgets/` : `BooleanIndicator.tsx`, `NumericValue.tsx`, `TextField.tsx`, `ColorSwatch.tsx`, `EnumBadge.tsx`, plus tests.
2. **Whitelist d'icônes** `apps/frontend/src/components/devices/icons.ts` avec `ICON_MAP` et helper `getIcon`.
3. **Composant `GenericDeviceCard`** dans `apps/frontend/src/components/devices/GenericDeviceCard.tsx` qui itère sur `device.units`, lit `state.state[unit.output_field]` et dispatche vers le widget approprié selon `unit.output_type`. Respecte `unit.display` pour label/icône/unit.
4. **Refonte de `app/page.tsx`** (post-merge topics-tree) : remplacer le `switch (interpreter_type)` par un map `devices.map(d => <GenericDeviceCard device={d} state={...} />)`.
5. **Refonte du formulaire `/devices/page.tsx`** (post-merge topics-tree) : dropdown « Partir d'un preset » alimenté par `GET /api/presets`, formulaire d'ajout/suppression d'units, substitution côté frontend des placeholders avant POST.
6. **Endpoint client `apps/frontend/src/lib/registry-api.ts`** : ajouter `fetchPresets`, `patchDevice`. Étendre les types `RegistryDevice` et `Unit` côté frontend pour matcher le nouveau modèle.
7. **Suppression des cards spécialisées** : `FrigateCard.tsx`, `WledCard.tsx`, `TasmotaCard.tsx`, `GenericCard.tsx` (ce dernier peut être conservé en debug interne si utile).

---

## Self-Review (rappel — à exécuter par l'agent)

Avant de lancer l'implémentation, parcours les sections de la spec :
- §3 (modèle de données) → Tasks 1, 2, 7.
- §4 (format unit) → Tasks 1, 3, 4, 6.
- §5 (pipeline runtime) → Tasks 3, 5, 8, 13.
- §6 (presets seed) → Tasks 6, 10.
- §7 (rendu frontend) → Phase B (différée).
- §8 (validation/sécurité) → Task 4.
- §9 (migration) → Tasks 2, 9, 14.
- §10 (tests) → Tasks 3, 4, 5, 6, 7, 8, 9, 12.
- §11 (dépendances zone interdite) → Phase B explicitement différée.
- §12 (critères de réussite) → couverts à l'exception du frontend différé.
