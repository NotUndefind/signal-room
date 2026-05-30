# Dynamic Device Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les interpréteurs MQTT hardcodés par un registre dynamique configurable depuis l'UI, avec catalogue progressif des topics vus.

**Architecture:** Le backend souscrit à `#` dès le démarrage. Chaque message déclenche (1) un upsert dans `topics_seen` (catalogue passif) et (2) un lookup dans le `DynamicRegistry` chargé en mémoire depuis SQLite. Les devices sont ajoutables via `POST /api/registry` qui met le registre à jour à chaud. Le dashboard affiche les cards des devices configurés + les topics découverts récents non configurés.

**Tech Stack:** better-sqlite3, MQTT.js, Fastify, Next.js (App Router), Zustand, Tailwind/shadcn-ui, Vitest

---

## File Structure

### Backend — nouveaux fichiers
- `apps/backend/src/db/topics.ts` — `upsertTopicSeen` + `getTopicsSeen`
- `apps/backend/src/db/topics.test.ts`
- `apps/backend/src/db/registry.ts` — CRUD `device_registry` + seed
- `apps/backend/src/db/registry.test.ts`
- `apps/backend/src/mqtt/matcher.ts` — `mqttTopicMatches(pattern, topic)`
- `apps/backend/src/mqtt/matcher.test.ts`
- `apps/backend/src/interpreters/raw.ts` — interpréteur raw
- `apps/backend/src/interpreters/raw.test.ts`
- `apps/backend/src/interpreters/dynamic.ts` — `DynamicRegistry` en mémoire
- `apps/backend/src/interpreters/dynamic.test.ts`
- `apps/backend/src/api/topics-routes.ts` — `GET /api/topics`
- `apps/backend/src/api/registry-routes.ts` — `GET/POST/DELETE /api/registry`

### Backend — fichiers modifiés
- `apps/backend/src/db/schema.ts` — ajout `topics_seen` + `device_registry`
- `apps/backend/src/index.ts` — souscription `#`, catalogue passif, registre dynamique, nouvelles routes

### Frontend — nouveaux fichiers
- `apps/frontend/src/lib/registry-api.ts` — fetch `/api/registry` + `/api/topics`
- `apps/frontend/src/components/devices/GenericCard.tsx`
- `apps/frontend/src/components/devices/DiscoveredCard.tsx`
- `apps/frontend/src/app/devices/page.tsx`

### Frontend — fichiers modifiés
- `apps/frontend/src/app/page.tsx` — cards dynamiques + section topics découverts

---

## Task 1 : DB Schema — tables topics_seen et device_registry

**Files:**
- Modify: `apps/backend/src/db/schema.ts`
- Test: `apps/backend/src/db/client.test.ts` (existant — ajouter 2 assertions)

- [ ] **Step 1 : Lire les tests existants de client.test.ts**

```bash
cat apps/backend/src/db/client.test.ts
```

- [ ] **Step 2 : Ajouter les deux tables dans schema.ts**

Ouvrir `apps/backend/src/db/schema.ts` et ajouter les deux tables dans l'appel `db.exec()` existant, après les tables `events` et `device_snapshots` :

```typescript
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
```

- [ ] **Step 3 : Vérifier que les tests existants passent encore**

```bash
cd apps/backend && npx vitest run src/db/client.test.ts
```

Expected : PASS (aucune régression)

- [ ] **Step 4 : Commit**

```bash
git add apps/backend/src/db/schema.ts
git commit -m "feat(db): add topics_seen and device_registry tables"
```

---

## Task 2 : topics_seen — upsert et query

**Files:**
- Create: `apps/backend/src/db/topics.ts`
- Create: `apps/backend/src/db/topics.test.ts`

- [ ] **Step 1 : Écrire les tests**

Créer `apps/backend/src/db/topics.test.ts` :

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { applySchema } from './schema'
import { upsertTopicSeen, getTopicsSeen } from './topics'

function makeDb() {
  const db = new Database(':memory:')
  applySchema(db)
  return db
}

describe('upsertTopicSeen', () => {
  it('insère un nouveau topic', () => {
    const db = makeDb()
    upsertTopicSeen(db, 'home/sensor', 'tasmota')
    const rows = getTopicsSeen(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].topic).toBe('home/sensor')
    expect(rows[0].message_count).toBe(1)
    expect(rows[0].detected_type).toBe('tasmota')
  })

  it('met à jour last_seen et message_count pour un topic existant', () => {
    const db = makeDb()
    upsertTopicSeen(db, 'home/sensor', null)
    upsertTopicSeen(db, 'home/sensor', 'frigate')
    const rows = getTopicsSeen(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].message_count).toBe(2)
  })

  it('ne réinitialise pas detected_type si déjà connu', () => {
    const db = makeDb()
    upsertTopicSeen(db, 'home/sensor', 'wled')
    upsertTopicSeen(db, 'home/sensor', null)
    const rows = getTopicsSeen(db)
    expect(rows[0].detected_type).toBe('wled')
  })
})

describe('getTopicsSeen', () => {
  it('retourne tous les topics sans filtre', () => {
    const db = makeDb()
    upsertTopicSeen(db, 'a', null)
    upsertTopicSeen(db, 'b', null)
    expect(getTopicsSeen(db)).toHaveLength(2)
  })

  it('filtre par cutoff', () => {
    const db = makeDb()
    const old = Date.now() - 100_000
    db.prepare(`INSERT INTO topics_seen (topic, first_seen, last_seen, message_count) VALUES (?, ?, ?, 1)`)
      .run('old/topic', old, old)
    upsertTopicSeen(db, 'recent/topic', null)
    const cutoff = Date.now() - 10_000
    const rows = getTopicsSeen(db, cutoff)
    expect(rows.map(r => r.topic)).toContain('recent/topic')
    expect(rows.map(r => r.topic)).not.toContain('old/topic')
  })
})
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

```bash
cd apps/backend && npx vitest run src/db/topics.test.ts
```

Expected : FAIL avec "Cannot find module './topics'"

- [ ] **Step 3 : Implémenter topics.ts**

Créer `apps/backend/src/db/topics.ts` :

```typescript
import type Database from 'better-sqlite3'

export interface TopicSeenRow {
  topic: string
  first_seen: number
  last_seen: number
  message_count: number
  detected_type: string | null
}

export function upsertTopicSeen(
  db: Database.Database,
  topic: string,
  detectedType: string | null
): void {
  const now = Date.now()
  db.prepare(`
    INSERT INTO topics_seen (topic, first_seen, last_seen, message_count, detected_type)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(topic) DO UPDATE SET
      last_seen = excluded.last_seen,
      message_count = message_count + 1,
      detected_type = COALESCE(excluded.detected_type, topics_seen.detected_type)
  `).run(topic, now, now, detectedType)
}

export function getTopicsSeen(
  db: Database.Database,
  cutoff?: number
): TopicSeenRow[] {
  if (cutoff !== undefined) {
    return db.prepare(
      'SELECT * FROM topics_seen WHERE last_seen >= ? ORDER BY last_seen DESC'
    ).all(cutoff) as TopicSeenRow[]
  }
  return db.prepare(
    'SELECT * FROM topics_seen ORDER BY last_seen DESC'
  ).all() as TopicSeenRow[]
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

```bash
cd apps/backend && npx vitest run src/db/topics.test.ts
```

Expected : PASS (6 tests)

- [ ] **Step 5 : Commit**

```bash
git add apps/backend/src/db/topics.ts apps/backend/src/db/topics.test.ts
git commit -m "feat(db): add topics_seen upsert and query"
```

---

## Task 3 : device_registry — CRUD et seed

**Files:**
- Create: `apps/backend/src/db/registry.ts`
- Create: `apps/backend/src/db/registry.test.ts`

- [ ] **Step 1 : Écrire les tests**

Créer `apps/backend/src/db/registry.test.ts` :

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { applySchema } from './schema'
import { getAllDevices, insertDevice, deleteDevice, seedDeviceRegistry } from './registry'

function makeDb() {
  const db = new Database(':memory:')
  applySchema(db)
  return db
}

describe('insertDevice / getAllDevices', () => {
  it('insère et récupère un device avec topic_patterns parsé', () => {
    const db = makeDb()
    const id = insertDevice(db, {
      name: 'Mon capteur',
      topic_patterns: ['home/+/temp'],
      interpreter_type: 'raw',
    })
    const devices = getAllDevices(db)
    expect(devices).toHaveLength(1)
    expect(devices[0].id).toBe(id)
    expect(devices[0].name).toBe('Mon capteur')
    expect(devices[0].topic_patterns).toEqual(['home/+/temp'])
    expect(devices[0].interpreter_type).toBe('raw')
    expect(devices[0].active).toBe(1)
  })
})

describe('deleteDevice', () => {
  it('supprime un device existant et retourne true', () => {
    const db = makeDb()
    const id = insertDevice(db, { name: 'X', topic_patterns: ['a/b'], interpreter_type: 'raw' })
    expect(deleteDevice(db, id)).toBe(true)
    expect(getAllDevices(db)).toHaveLength(0)
  })

  it('retourne false pour un id inexistant', () => {
    const db = makeDb()
    expect(deleteDevice(db, 9999)).toBe(false)
  })
})

describe('seedDeviceRegistry', () => {
  it('insère Frigate, Tasmota, WLED si la table est vide', () => {
    const db = makeDb()
    seedDeviceRegistry(db, '')
    const devices = getAllDevices(db)
    expect(devices).toHaveLength(3)
    const names = devices.map(d => d.name)
    expect(names).toContain('Frigate')
    expect(names).toContain('Tasmota')
    expect(names).toContain('WLED')
  })

  it("n'insère pas si la table contient déjà des entrées", () => {
    const db = makeDb()
    insertDevice(db, { name: 'Existing', topic_patterns: ['x'], interpreter_type: 'raw' })
    seedDeviceRegistry(db, '')
    expect(getAllDevices(db)).toHaveLength(1)
  })

  it('applique le préfixe Tasmota', () => {
    const db = makeDb()
    seedDeviceRegistry(db, 'home/')
    const tasmota = getAllDevices(db).find(d => d.name === 'Tasmota')!
    expect(tasmota.topic_patterns).toContain('home/tele/+/STATE')
  })
})
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

```bash
cd apps/backend && npx vitest run src/db/registry.test.ts
```

Expected : FAIL avec "Cannot find module './registry'"

- [ ] **Step 3 : Implémenter registry.ts**

Créer `apps/backend/src/db/registry.ts` :

```typescript
import type Database from 'better-sqlite3'

export interface DeviceEntry {
  id: number
  name: string
  topic_patterns: string[]
  interpreter_type: 'frigate' | 'tasmota' | 'wled' | 'raw'
  active: number
  created_at: number
}

interface DeviceRow {
  id: number
  name: string
  topic_patterns: string
  interpreter_type: string
  active: number
  created_at: number
}

function parseRow(row: DeviceRow): DeviceEntry {
  return {
    ...row,
    topic_patterns: JSON.parse(row.topic_patterns) as string[],
    interpreter_type: row.interpreter_type as DeviceEntry['interpreter_type'],
  }
}

export function getAllDevices(db: Database.Database): DeviceEntry[] {
  const rows = db.prepare(
    'SELECT * FROM device_registry ORDER BY created_at ASC'
  ).all() as DeviceRow[]
  return rows.map(parseRow)
}

export function insertDevice(
  db: Database.Database,
  device: { name: string; topic_patterns: string[]; interpreter_type: string }
): number {
  const result = db.prepare(`
    INSERT INTO device_registry (name, topic_patterns, interpreter_type, active, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(device.name, JSON.stringify(device.topic_patterns), device.interpreter_type, Date.now())
  return result.lastInsertRowid as number
}

export function deleteDevice(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM device_registry WHERE id = ?').run(id)
  return result.changes > 0
}

export function seedDeviceRegistry(db: Database.Database, tasmotaPrefix = ''): void {
  const { count } = db.prepare(
    'SELECT COUNT(*) as count FROM device_registry'
  ).get() as { count: number }
  if (count > 0) return

  const p = tasmotaPrefix
  const now = Date.now()
  const insert = db.prepare(`
    INSERT INTO device_registry (name, topic_patterns, interpreter_type, active, created_at)
    VALUES (?, ?, ?, 1, ?)
  `)

  insert.run('Frigate', JSON.stringify(['frigate/+/events']), 'frigate', now)
  insert.run(
    'Tasmota',
    JSON.stringify([`${p}stat/+/RESULT`, `${p}tele/+/STATE`, `${p}tele/+/SENSOR`]),
    'tasmota',
    now + 1
  )
  insert.run('WLED', JSON.stringify(['wled/+/v']), 'wled', now + 2)
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

```bash
cd apps/backend && npx vitest run src/db/registry.test.ts
```

Expected : PASS (6 tests)

- [ ] **Step 5 : Commit**

```bash
git add apps/backend/src/db/registry.ts apps/backend/src/db/registry.test.ts
git commit -m "feat(db): add device_registry CRUD and seed"
```

---

## Task 4 : MQTT topic matcher

**Files:**
- Create: `apps/backend/src/mqtt/matcher.ts`
- Create: `apps/backend/src/mqtt/matcher.test.ts`

- [ ] **Step 1 : Écrire les tests**

Créer `apps/backend/src/mqtt/matcher.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { mqttTopicMatches } from './matcher'

describe('mqttTopicMatches', () => {
  it('match exact', () => {
    expect(mqttTopicMatches('home/sensor/temp', 'home/sensor/temp')).toBe(true)
  })

  it('ne matche pas si différent', () => {
    expect(mqttTopicMatches('home/sensor/temp', 'home/sensor/humidity')).toBe(false)
  })

  it('+ matche un segment', () => {
    expect(mqttTopicMatches('home/+/temp', 'home/sensor/temp')).toBe(true)
    expect(mqttTopicMatches('home/+/temp', 'home/other/temp')).toBe(true)
    expect(mqttTopicMatches('home/+/temp', 'home/sensor/humidity')).toBe(false)
  })

  it('+ ne matche pas plusieurs segments', () => {
    expect(mqttTopicMatches('home/+/temp', 'home/a/b/temp')).toBe(false)
  })

  it('# matche zéro ou plusieurs segments en fin', () => {
    expect(mqttTopicMatches('home/#', 'home/sensor')).toBe(true)
    expect(mqttTopicMatches('home/#', 'home/sensor/temp')).toBe(true)
    expect(mqttTopicMatches('home/#', 'home')).toBe(true)
  })

  it('# seul matche tout', () => {
    expect(mqttTopicMatches('#', 'anything/at/all')).toBe(true)
  })

  it('longueurs différentes sans wildcard', () => {
    expect(mqttTopicMatches('a/b', 'a/b/c')).toBe(false)
    expect(mqttTopicMatches('a/b/c', 'a/b')).toBe(false)
  })
})
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

```bash
cd apps/backend && npx vitest run src/mqtt/matcher.test.ts
```

Expected : FAIL avec "Cannot find module './matcher'"

- [ ] **Step 3 : Implémenter matcher.ts**

Créer `apps/backend/src/mqtt/matcher.ts` :

```typescript
export function mqttTopicMatches(pattern: string, topic: string): boolean {
  const pp = pattern.split('/')
  const tp = topic.split('/')

  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '#') return true
    if (tp[i] === undefined) return false
    if (pp[i] !== '+' && pp[i] !== tp[i]) return false
  }

  return pp.length === tp.length
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

```bash
cd apps/backend && npx vitest run src/mqtt/matcher.test.ts
```

Expected : PASS (8 tests)

- [ ] **Step 5 : Commit**

```bash
git add apps/backend/src/mqtt/matcher.ts apps/backend/src/mqtt/matcher.test.ts
git commit -m "feat(mqtt): add topic pattern matcher"
```

---

## Task 5 : Interpréteur raw

**Files:**
- Create: `apps/backend/src/interpreters/raw.ts`
- Create: `apps/backend/src/interpreters/raw.test.ts`

- [ ] **Step 1 : Écrire les tests**

Créer `apps/backend/src/interpreters/raw.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { rawInterpreter } from './raw'

describe('rawInterpreter', () => {
  it('retourne le payload JSON parsé dans state.payload', () => {
    const payload = Buffer.from(JSON.stringify({ temperature: 22.5 }))
    const result = rawInterpreter.parse('home/sensor/temp', payload)
    expect(result).not.toBeNull()
    expect(result?.source).toBe('raw')
    expect(result?.event_type).toBe('raw_message')
    expect(result?.state.payload).toEqual({ temperature: 22.5 })
    expect(result?.state.topic).toBe('home/sensor/temp')
  })

  it('retourne la string brute si le payload n'est pas du JSON valide', () => {
    const payload = Buffer.from('not json')
    const result = rawInterpreter.parse('any/topic', payload)
    expect(result?.state.payload).toBe('not json')
  })

  it('accepte n'importe quel topic', () => {
    const result = rawInterpreter.parse('completely/random/topic', Buffer.from('{}'))
    expect(result).not.toBeNull()
  })
})
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

```bash
cd apps/backend && npx vitest run src/interpreters/raw.test.ts
```

Expected : FAIL avec "Cannot find module './raw'"

- [ ] **Step 3 : Implémenter raw.ts**

Créer `apps/backend/src/interpreters/raw.ts` :

```typescript
import type { Interpreter, DeviceState } from './types'

export const rawInterpreter: Interpreter = {
  source: 'raw',
  topics: [],

  parse(topic: string, payload: Buffer): DeviceState | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload.toString())
    } catch {
      parsed = payload.toString()
    }

    return {
      source: 'raw',
      event_type: 'raw_message',
      state: { topic, payload: parsed },
      raw: payload.toString(),
      timestamp: Date.now(),
    }
  },
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

```bash
cd apps/backend && npx vitest run src/interpreters/raw.test.ts
```

Expected : PASS (3 tests)

- [ ] **Step 5 : Commit**

```bash
git add apps/backend/src/interpreters/raw.ts apps/backend/src/interpreters/raw.test.ts
git commit -m "feat(interpreters): add raw interpreter"
```

---

## Task 6 : DynamicRegistry en mémoire

**Files:**
- Create: `apps/backend/src/interpreters/dynamic.ts`
- Create: `apps/backend/src/interpreters/dynamic.test.ts`

- [ ] **Step 1 : Écrire les tests**

Créer `apps/backend/src/interpreters/dynamic.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { applySchema } from '../db/schema'
import { seedDeviceRegistry, insertDevice } from '../db/registry'
import { createDynamicRegistry } from './dynamic'
import type { Config } from '../config'

function makeDb() {
  const db = new Database(':memory:')
  applySchema(db)
  return db
}

const config: Config = {
  mqtt: { host: 'localhost', port: 1883, username: 'test' },
  redis: { url: 'redis://localhost:6379' },
  db: { path: ':memory:' },
  retention: { days: 30 },
  frigate: { debounceMs: 300 },
  tasmota: { topicPrefix: '' },
  port: 3001,
}

describe('createDynamicRegistry', () => {
  it('route un message frigate vers le bon interpréteur', () => {
    const db = makeDb()
    seedDeviceRegistry(db, '')
    const registry = createDynamicRegistry(db, config)
    const payload = Buffer.from(JSON.stringify({
      type: 'new',
      after: { id: 'x', label: 'person', camera: 'cam1', current_zones: [], score: 0.9 },
    }))
    const result = registry.route('frigate/cam1/events', payload)
    expect(result?.source).toBe('frigate')
  })

  it('retourne null pour un topic non configuré', () => {
    const db = makeDb()
    const registry = createDynamicRegistry(db, config)
    const result = registry.route('unknown/topic', Buffer.from('{}'))
    expect(result).toBeNull()
  })

  it('prend en compte un device ajouté dynamiquement', () => {
    const db = makeDb()
    const registry = createDynamicRegistry(db, config)
    registry.addDevice({
      id: 1, name: 'Test', topic_patterns: ['home/+/temp'],
      interpreter_type: 'raw', active: 1, created_at: Date.now(),
    })
    const result = registry.route('home/sensor/temp', Buffer.from('{"v":22}'))
    expect(result?.source).toBe('raw')
  })

  it('ne route plus après removeDevice', () => {
    const db = makeDb()
    const registry = createDynamicRegistry(db, config)
    registry.addDevice({
      id: 99, name: 'Tmp', topic_patterns: ['tmp/topic'],
      interpreter_type: 'raw', active: 1, created_at: Date.now(),
    })
    registry.removeDevice(99)
    const result = registry.route('tmp/topic', Buffer.from('{}'))
    expect(result).toBeNull()
  })

  it('retourne le debounceMs de l'interpréteur correspondant', () => {
    const db = makeDb()
    seedDeviceRegistry(db, '')
    const registry = createDynamicRegistry(db, config)
    expect(registry.getDebounceMs('frigate')).toBe(300)
    expect(registry.getDebounceMs('raw')).toBeUndefined()
  })
})
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

```bash
cd apps/backend && npx vitest run src/interpreters/dynamic.test.ts
```

Expected : FAIL avec "Cannot find module './dynamic'"

- [ ] **Step 3 : Implémenter dynamic.ts**

Créer `apps/backend/src/interpreters/dynamic.ts` :

```typescript
import type Database from 'better-sqlite3'
import type { DeviceState, Interpreter } from './types'
import type { Config } from '../config'
import type { DeviceEntry } from '../db/registry'
import { getAllDevices } from '../db/registry'
import { frigateInterpreter } from './frigate'
import { wledInterpreter } from './wled'
import { createTasmotaInterpreter } from './tasmota'
import { rawInterpreter } from './raw'
import { mqttTopicMatches } from '../mqtt/matcher'

export interface DynamicRegistry {
  route(topic: string, payload: Buffer): DeviceState | null
  getDebounceMs(source: string): number | undefined
  addDevice(entry: DeviceEntry): void
  removeDevice(id: number): void
}

export function createDynamicRegistry(db: Database.Database, config: Config): DynamicRegistry {
  const interpreterMap: Record<string, Interpreter> = {
    frigate: frigateInterpreter,
    tasmota: createTasmotaInterpreter(config.tasmota.topicPrefix),
    wled: wledInterpreter,
    raw: rawInterpreter,
  }

  let devices: DeviceEntry[] = getAllDevices(db).filter(d => d.active === 1)

  return {
    route(topic: string, payload: Buffer): DeviceState | null {
      for (const device of devices) {
        const matches = device.topic_patterns.some(p => mqttTopicMatches(p, topic))
        if (!matches) continue
        const interpreter = interpreterMap[device.interpreter_type]
        if (!interpreter) continue
        const result = interpreter.parse(topic, payload)
        if (result !== null) return result
      }
      return null
    },

    getDebounceMs(source: string): number | undefined {
      return interpreterMap[source]?.debounceMs
    },

    addDevice(entry: DeviceEntry): void {
      devices = [...devices, entry]
    },

    removeDevice(id: number): void {
      devices = devices.filter(d => d.id !== id)
    },
  }
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

```bash
cd apps/backend && npx vitest run src/interpreters/dynamic.test.ts
```

Expected : PASS (5 tests)

- [ ] **Step 5 : Commit**

```bash
git add apps/backend/src/interpreters/dynamic.ts apps/backend/src/interpreters/dynamic.test.ts
git commit -m "feat(interpreters): add DynamicRegistry with hot-reload"
```

---

## Task 7 : API routes topics et registry

**Files:**
- Create: `apps/backend/src/api/topics-routes.ts`
- Create: `apps/backend/src/api/registry-routes.ts`

Pas de tests unitaires pour ces routes (elles délèguent à des fonctions déjà testées). Les tests d'intégration sont couverts par les tests manuels à l'étape suivante.

- [ ] **Step 1 : Créer topics-routes.ts**

```typescript
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { getTopicsSeen } from '../db/topics'

export function registerTopicsRoutes(fastify: FastifyInstance, db: Database.Database): void {
  fastify.get('/api/topics', async (req, reply) => {
    const { since } = req.query as { since?: string }
    const cutoff = since ? Date.now() - parseInt(since, 10) * 1000 : undefined
    const topics = getTopicsSeen(db, cutoff)
    return reply.send({ topics })
  })
}
```

- [ ] **Step 2 : Créer registry-routes.ts**

```typescript
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import type { DynamicRegistry } from '../interpreters/dynamic'
import type { DeviceEntry } from '../db/registry'
import { getAllDevices, insertDevice, deleteDevice } from '../db/registry'

const VALID_TYPES = ['frigate', 'tasmota', 'wled', 'raw'] as const

export function registerRegistryRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  registry: DynamicRegistry
): void {
  fastify.get('/api/registry', async (_req, reply) => {
    return reply.send({ devices: getAllDevices(db) })
  })

  fastify.post('/api/registry', async (req, reply) => {
    const body = req.body as { name?: unknown; topic_patterns?: unknown; interpreter_type?: unknown }
    const { name, topic_patterns, interpreter_type } = body

    if (
      typeof name !== 'string' || !name ||
      !Array.isArray(topic_patterns) || topic_patterns.length === 0 ||
      typeof interpreter_type !== 'string' ||
      !(VALID_TYPES as readonly string[]).includes(interpreter_type)
    ) {
      return reply.status(400).send({
        error: 'name (string), topic_patterns (array non-vide) et interpreter_type valide requis',
      })
    }

    const id = insertDevice(db, {
      name,
      topic_patterns: topic_patterns as string[],
      interpreter_type,
    })

    const entry: DeviceEntry = {
      id,
      name,
      topic_patterns: topic_patterns as string[],
      interpreter_type: interpreter_type as DeviceEntry['interpreter_type'],
      active: 1,
      created_at: Date.now(),
    }
    registry.addDevice(entry)

    return reply.status(201).send({ id })
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

- [ ] **Step 3 : Commit**

```bash
git add apps/backend/src/api/topics-routes.ts apps/backend/src/api/registry-routes.ts
git commit -m "feat(api): add /api/topics and /api/registry routes"
```

---

## Task 8 : Câblage de index.ts

**Files:**
- Modify: `apps/backend/src/index.ts`

- [ ] **Step 1 : Remplacer les imports en haut du fichier**

Supprimer :
```typescript
import { createInterpreterRegistry, DEFAULT_INTERPRETERS } from './interpreters/index'
```

Ajouter à la place :
```typescript
import { createDynamicRegistry } from './interpreters/dynamic'
import { seedDeviceRegistry } from './db/registry'
import { upsertTopicSeen } from './db/topics'
import { registerTopicsRoutes } from './api/topics-routes'
import { registerRegistryRoutes } from './api/registry-routes'
```

- [ ] **Step 2 : Remplacer la création du registre dans main()**

Supprimer :
```typescript
const registry = createInterpreterRegistry(DEFAULT_INTERPRETERS)
```

Ajouter à la place (juste après `applySchema(db)`) :
```typescript
seedDeviceRegistry(db, config.tasmota.topicPrefix)
const deviceRegistry = createDynamicRegistry(db, config)
```

- [ ] **Step 3 : Enregistrer les nouvelles routes**

Après les lignes `registerWsRoutes`, `registerDeviceRoutes`, `registerHistoryRoutes`, ajouter :
```typescript
registerTopicsRoutes(fastify, db)
registerRegistryRoutes(fastify, db, deviceRegistry)
```

- [ ] **Step 4 : Mettre à jour deviceKey pour les devices raw**

Remplacer la fonction `deviceKey` :
```typescript
function deviceKey(state: DeviceState): string {
  const sub = String(state.state.camera ?? state.state.device_id ?? state.state.topic ?? '')
  return sub ? `${state.source}:${sub}` : state.source
}
```

- [ ] **Step 5 : Mettre à jour processState pour le catalogue passif**

Remplacer la fonction `processState` :
```typescript
function processState(topic: string, payload: Buffer) {
  const state = deviceRegistry.route(topic, payload)

  setImmediate(() => {
    try {
      upsertTopicSeen(db, topic, state?.source ?? null)
    } catch (e) {
      console.error('[Catalogue] Upsert error:', e)
    }
  })

  if (!state) return

  const debounce = getDebounce(state.source)

  const handle = () => {
    const key = deviceKey(state)
    if (!dedupStore.hasChanged(key, state)) {
      console.log(`[Pipeline] Dedup — état inchangé pour: ${key}`)
      return
    }
    dedupStore.update(key, state)
    console.log(`[Pipeline] Broadcast — source: ${key} | event: ${state.event_type}`)
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

  if (debounce) {
    debounce(state.source, handle)
  } else {
    handle()
  }
}
```

- [ ] **Step 6 : Mettre à jour getDebounce**

Remplacer :
```typescript
function getDebounce(source: string): ReturnType<typeof createDebounce> | null {
  const ms = registry.getDebounceMs(source)
```

Par :
```typescript
function getDebounce(source: string): ReturnType<typeof createDebounce> | null {
  const ms = deviceRegistry.getDebounceMs(source)
```

- [ ] **Step 7 : Mettre à jour createMqttClient — souscrire à #**

Remplacer :
```typescript
createMqttClient({
  host: config.mqtt.host,
  port: config.mqtt.port,
  username: config.mqtt.username,
  password: config.mqtt.password,
  topics: registry.getAllTopics(),
  onMessage: processState,
})
```

Par :
```typescript
createMqttClient({
  host: config.mqtt.host,
  port: config.mqtt.port,
  username: config.mqtt.username,
  password: config.mqtt.password,
  topics: ['#'],
  onMessage: processState,
})
```

- [ ] **Step 8 : Vérifier la compilation TypeScript**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected : aucune erreur

- [ ] **Step 9 : Lancer tous les tests backend**

```bash
cd apps/backend && npx vitest run
```

Expected : tous les tests passent

- [ ] **Step 10 : Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "feat(backend): wire dynamic registry, subscribe to #, passive catalogue"
```

---

## Task 9 : Frontend — registry-api.ts

**Files:**
- Create: `apps/frontend/src/lib/registry-api.ts`

Pas de tests unitaires (wrapping fetch) — validé par le comportement de l'UI.

- [ ] **Step 1 : Créer registry-api.ts**

```typescript
const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001'

export interface RegistryDevice {
  id: number
  name: string
  topic_patterns: string[]
  interpreter_type: 'frigate' | 'tasmota' | 'wled' | 'raw'
  active: number
  created_at: number
}

export interface TopicSeen {
  topic: string
  first_seen: number
  last_seen: number
  message_count: number
  detected_type: string | null
}

export async function fetchRegistry(): Promise<RegistryDevice[]> {
  const res = await fetch(`${API_URL}/api/registry`)
  const data = await res.json() as { devices: RegistryDevice[] }
  return data.devices
}

export async function fetchTopicsSeen(sinceSeconds?: number): Promise<TopicSeen[]> {
  const url = sinceSeconds
    ? `${API_URL}/api/topics?since=${sinceSeconds}`
    : `${API_URL}/api/topics`
  const res = await fetch(url)
  const data = await res.json() as { topics: TopicSeen[] }
  return data.topics
}

export async function addDevice(device: {
  name: string
  topic_patterns: string[]
  interpreter_type: string
}): Promise<number> {
  const res = await fetch(`${API_URL}/api/registry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(device),
  })
  const data = await res.json() as { id: number }
  return data.id
}

export async function removeDevice(id: number): Promise<void> {
  await fetch(`${API_URL}/api/registry/${id}`, { method: 'DELETE' })
}
```

- [ ] **Step 2 : Commit**

```bash
git add apps/frontend/src/lib/registry-api.ts
git commit -m "feat(frontend): add registry API client"
```

---

## Task 10 : GenericCard et DiscoveredCard

**Files:**
- Create: `apps/frontend/src/components/devices/GenericCard.tsx`
- Create: `apps/frontend/src/components/devices/DiscoveredCard.tsx`

- [ ] **Step 1 : Créer GenericCard.tsx**

```tsx
import { DeviceCard } from '@/components/DeviceCard'
import type { FrontendDeviceState } from '@/store/room'

interface GenericCardProps {
  name: string
  state: FrontendDeviceState | undefined
}

export function GenericCard({ name, state }: GenericCardProps) {
  const payload = state?.state?.payload

  return (
    <DeviceCard title={name} state={state}>
      {payload !== undefined && (
        <pre className="text-xs overflow-auto max-h-48 bg-muted p-2 rounded font-mono">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </DeviceCard>
  )
}
```

- [ ] **Step 2 : Créer DiscoveredCard.tsx**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { TopicSeen } from '@/lib/registry-api'

interface DiscoveredCardProps {
  topic: TopicSeen
  onConfigure: (topic: string) => void
}

export function DiscoveredCard({ topic, onConfigure }: DiscoveredCardProps) {
  const lastSeen = new Date(topic.last_seen).toLocaleTimeString('fr-FR')

  return (
    <Card className="opacity-70 border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="font-mono text-sm truncate">{topic.topic}</span>
          <span className="text-xs text-muted-foreground font-normal ml-2 shrink-0">{lastSeen}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {topic.detected_type && (
            <Badge variant="secondary">{topic.detected_type}</Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {topic.message_count} message{topic.message_count > 1 ? 's' : ''}
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => onConfigure(topic.topic)}>
          Configurer
        </Button>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3 : Vérifier la compilation TypeScript du frontend**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected : aucune erreur

- [ ] **Step 4 : Commit**

```bash
git add apps/frontend/src/components/devices/GenericCard.tsx apps/frontend/src/components/devices/DiscoveredCard.tsx
git commit -m "feat(frontend): add GenericCard and DiscoveredCard components"
```

---

## Task 11 : Dashboard dynamique

**Files:**
- Modify: `apps/frontend/src/app/page.tsx`

- [ ] **Step 1 : Remplacer page.tsx**

Remplacer le contenu de `apps/frontend/src/app/page.tsx` :

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { History, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusIndicator } from '@/components/StatusIndicator'
import { FrigateCard } from '@/components/devices/FrigateCard'
import { WledCard } from '@/components/devices/WledCard'
import { TasmotaCard } from '@/components/devices/TasmotaCard'
import { GenericCard } from '@/components/devices/GenericCard'
import { DiscoveredCard } from '@/components/devices/DiscoveredCard'
import { useRoomStore } from '@/store/room'
import { createWsClient } from '@/lib/ws'
import { fetchRegistry, fetchTopicsSeen } from '@/lib/registry-api'
import type { RegistryDevice, TopicSeen } from '@/lib/registry-api'

const WS_URL = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? 'ws://localhost:3001/ws'

export default function DashboardPage() {
  const { devices, connected, setDevice, setDevices, setConnected } = useRoomStore()
  const [registry, setRegistry] = useState<RegistryDevice[]>([])
  const [discoveredTopics, setDiscoveredTopics] = useState<TopicSeen[]>([])
  const router = useRouter()

  useEffect(() => {
    const client = createWsClient({
      url: WS_URL,
      onSnapshot: setDevices,
      onUpdate: setDevice,
      onConnectionChange: setConnected,
    })
    return () => client.disconnect()
  }, [setDevice, setDevices, setConnected])

  useEffect(() => {
    fetchRegistry().then(setRegistry).catch(console.error)
    fetchTopicsSeen(86400).then(setDiscoveredTopics).catch(console.error)
  }, [])

  const registeredPatterns = new Set(registry.flatMap(d => d.topic_patterns))
  const unregisteredTopics = discoveredTopics.filter(t => !registeredPatterns.has(t.topic))

  function renderDevice(device: RegistryDevice): React.ReactNode[] {
    if (device.interpreter_type === 'frigate') {
      const sources = Object.values(devices).filter(d => d.source === 'frigate')
      if (sources.length === 0) return [<FrigateCard key={`frigate-${device.id}`} state={undefined} />]
      return sources.map(d => (
        <FrigateCard key={String(d.state.camera ?? device.id)} state={d} />
      ))
    }
    if (device.interpreter_type === 'tasmota') {
      const sources = Object.values(devices).filter(d => d.source === 'tasmota')
      if (sources.length === 0) return [<TasmotaCard key={`tasmota-${device.id}`} state={undefined} />]
      return sources.map(d => (
        <TasmotaCard
          key={d.state.device_id as string}
          state={d}
          label={`Tasmota — ${d.state.device_id as string}`}
        />
      ))
    }
    if (device.interpreter_type === 'wled') {
      return [<WledCard key={`wled-${device.id}`} state={devices['wled']} />]
    }
    if (device.interpreter_type === 'raw') {
      const topic = device.topic_patterns[0] ?? ''
      return [<GenericCard key={`raw-${device.id}`} name={device.name} state={devices[`raw:${topic}`]} />]
    }
    return []
  }

  return (
    <main className="min-h-screen bg-background p-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Signal Room</h1>
          <p className="text-muted-foreground text-sm mt-1">Tableau de bord de la chambre connectée</p>
        </div>
        <div className="flex items-center gap-4">
          <StatusIndicator connected={connected} />
          <Button variant="outline" size="sm" asChild>
            <Link href="/devices">
              <Settings className="h-4 w-4 mr-2" />
              Devices
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/history">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {registry.filter(d => d.active).flatMap(renderDevice)}
        {unregisteredTopics.map(topic => (
          <DiscoveredCard
            key={topic.topic}
            topic={topic}
            onConfigure={(t) => router.push(`/devices?topic=${encodeURIComponent(t)}`)}
          />
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 2 : Vérifier la compilation TypeScript**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected : aucune erreur

- [ ] **Step 3 : Commit**

```bash
git add apps/frontend/src/app/page.tsx
git commit -m "feat(frontend): dynamic dashboard from device registry"
```

---

## Task 12 : Page /devices

**Files:**
- Create: `apps/frontend/src/app/devices/page.tsx`

- [ ] **Step 1 : Créer le répertoire et le fichier**

```bash
mkdir -p apps/frontend/src/app/devices
```

- [ ] **Step 2 : Créer page.tsx**

```tsx
'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fetchRegistry, fetchTopicsSeen, addDevice, removeDevice } from '@/lib/registry-api'
import type { RegistryDevice, TopicSeen } from '@/lib/registry-api'

const INTERPRETER_TYPES = ['raw', 'frigate', 'tasmota', 'wled'] as const

function DevicesContent() {
  const searchParams = useSearchParams()
  const prefillTopic = searchParams.get('topic') ?? ''

  const [registry, setRegistry] = useState<RegistryDevice[]>([])
  const [topicsSeen, setTopicsSeen] = useState<TopicSeen[]>([])
  const [name, setName] = useState('')
  const [topicPattern, setTopicPattern] = useState(prefillTopic)
  const [interpreterType, setInterpreterType] = useState<string>('raw')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchRegistry().then(setRegistry).catch(console.error)
    fetchTopicsSeen().then(setTopicsSeen).catch(console.error)
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !topicPattern.trim()) {
      setError('Nom et topic requis')
      return
    }
    try {
      const id = await addDevice({
        name: name.trim(),
        topic_patterns: [topicPattern.trim()],
        interpreter_type: interpreterType,
      })
      setRegistry(prev => [...prev, {
        id, name: name.trim(),
        topic_patterns: [topicPattern.trim()],
        interpreter_type: interpreterType as RegistryDevice['interpreter_type'],
        active: 1,
        created_at: Date.now(),
      }])
      setName('')
      setTopicPattern('')
    } catch {
      setError("Erreur lors de l'ajout")
    }
  }

  async function handleRemove(id: number) {
    await removeDevice(id)
    setRegistry(prev => prev.filter(d => d.id !== id))
  }

  return (
    <main className="min-h-screen bg-background p-6">
      <header className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Gestion des devices</h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Devices configurés ({registry.length})</h2>
          {registry.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun device configuré</p>
          )}
          {registry.map(device => (
            <Card key={device.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  {device.name}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(device.id)}
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge variant="secondary">{device.interpreter_type}</Badge>
                <div className="space-y-1">
                  {device.topic_patterns.map(p => (
                    <p key={p} className="text-xs font-mono text-muted-foreground">{p}</p>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Ajouter un device</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="device-name">Nom</label>
              <input
                id="device-name"
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Mon capteur"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="device-topic">Topic MQTT</label>
              <input
                id="device-topic"
                className="w-full border rounded px-3 py-2 text-sm font-mono bg-background"
                value={topicPattern}
                onChange={e => setTopicPattern(e.target.value)}
                placeholder="home/sensor/temp"
                list="topics-datalist"
              />
              <datalist id="topics-datalist">
                {topicsSeen.map(t => <option key={t.topic} value={t.topic} />)}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Les topics vus apparaissent en suggestion. Wildcards MQTT supportés : + et #
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="device-type">Type d&apos;interpréteur</label>
              <select
                id="device-type"
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={interpreterType}
                onChange={e => setInterpreterType(e.target.value)}
              >
                {INTERPRETER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">Ajouter</Button>
          </form>
        </div>
      </div>
    </main>
  )
}

export default function DevicesPage() {
  return (
    <Suspense>
      <DevicesContent />
    </Suspense>
  )
}
```

- [ ] **Step 3 : Vérifier la compilation TypeScript**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected : aucune erreur

- [ ] **Step 4 : Commit**

```bash
git add apps/frontend/src/app/devices/page.tsx
git commit -m "feat(frontend): add /devices management page"
```

---

## Task 13 : Vérification finale end-to-end

- [ ] **Step 1 : Lancer tous les tests backend**

```bash
cd apps/backend && npx vitest run
```

Expected : tous les tests passent, aucune régression

- [ ] **Step 2 : Démarrer le backend**

```bash
cd apps/backend && npm run dev
```

Expected : le serveur démarre, logs indiquant `[MQTT] Subscribed to 1 topics` (le topic `#`)

- [ ] **Step 3 : Vérifier le seed en base**

```bash
curl http://localhost:3001/api/registry | python3 -m json.tool
```

Expected : 3 devices (Frigate, Tasmota, WLED) avec leurs topic_patterns

- [ ] **Step 4 : Vérifier que topics_seen se remplit**

Après quelques secondes avec MQTT actif :

```bash
curl http://localhost:3001/api/topics | python3 -m json.tool
```

Expected : liste des topics vus sur le broker

- [ ] **Step 5 : Ajouter un device raw via API**

```bash
curl -X POST http://localhost:3001/api/registry \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test raw","topic_patterns":["home/test"],"interpreter_type":"raw"}'
```

Expected : `{"id": 4}`

- [ ] **Step 6 : Démarrer le frontend et vérifier le dashboard**

```bash
cd apps/frontend && npm run dev
```

Ouvrir `http://localhost:3000`. Vérifier :
- Les cards Frigate, Tasmota, WLED apparaissent (depuis le registre, plus hardcodées)
- Les topics découverts non configurés apparaissent en DiscoveredCard avec bordure dashed
- Le bouton "Devices" dans le header navigue vers `/devices`

- [ ] **Step 7 : Vérifier la page /devices**

Ouvrir `http://localhost:3000/devices`. Vérifier :
- La liste des devices configurés s'affiche
- Le formulaire propose les topics vus en autocomplete
- Ajouter un device met à jour la liste sans rechargement
- Supprimer un device le retire de la liste

- [ ] **Step 8 : Commit final**

```bash
git add -A
git commit -m "chore: final integration check"
```
