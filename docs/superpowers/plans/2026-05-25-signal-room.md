# Signal Room — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire un dashboard d'observation temps réel pour une chambre connectée, recevant des messages MQTT de Frigate, WLED et Tasmota, les interprétant et affichant l'état live des devices.

**Architecture:** Monorepo npm workspaces avec deux apps. Le backend Fastify écoute MQTT, interprète les messages via un registre extensible, déduplique via une Map en mémoire, synchro l'état dans Redis et persiste l'historique dans SQLite (async, hors du chemin WebSocket). Le frontend Next.js reçoit l'état via WebSocket et interroge l'historique via REST + TanStack Query.

**Tech Stack:** Node.js 22, TypeScript 5, Fastify 4, mqtt.js 5, ioredis 5, better-sqlite3 11, @fastify/websocket, Next.js 14, Tailwind CSS, shadcn/ui, Zustand 4, TanStack Query 5, framer-motion 11, Lucide, Vitest 2

---

## Carte des fichiers

```
signal-room/
├── package.json                          # npm workspaces root
├── .env.example
├── docker-compose.yml
├── docker-compose.dev.yml
├── apps/
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts                  # entry point, wiring
│   │       ├── config.ts                 # env vars → config object
│   │       ├── mqtt/
│   │       │   └── client.ts             # connexion MQTT, routing vers pipeline
│   │       ├── interpreters/
│   │       │   ├── types.ts              # interfaces Interpreter + DeviceState
│   │       │   ├── index.ts              # registre, auto-souscription topics
│   │       │   ├── frigate.ts            # interpréteur Frigate + session tracking
│   │       │   ├── wled.ts               # interpréteur WLED
│   │       │   └── tasmota.ts            # interpréteur Tasmota
│   │       ├── pipeline/
│   │       │   ├── dedup.ts              # Map en mémoire, comparaison d'état
│   │       │   └── debounce.ts           # debounce configurable par source
│   │       ├── store/
│   │       │   └── redis.ts              # ioredis client, get/set device state
│   │       ├── db/
│   │       │   ├── client.ts             # better-sqlite3, WAL mode
│   │       │   ├── schema.ts             # CREATE TABLE events + device_snapshots
│   │       │   ├── queries.ts            # prepared statements
│   │       │   └── retention.ts          # cron cleanup
│   │       ├── ws/
│   │       │   └── server.ts             # plugin @fastify/websocket + broadcast
│   │       └── api/
│   │           ├── devices.ts            # GET /api/devices
│   │           └── history.ts            # GET /api/events
│   └── frontend/
│       ├── package.json
│       ├── next.config.mjs
│       └── src/
│           ├── app/
│           │   ├── layout.tsx
│           │   ├── page.tsx              # dashboard temps réel
│           │   └── history/
│           │       └── page.tsx          # timeline + filtres
│           ├── components/
│           │   ├── StatusIndicator.tsx   # indicateur connexion WS
│           │   ├── DeviceCard.tsx        # carte générique par source
│           │   ├── devices/
│           │   │   ├── FrigateCard.tsx
│           │   │   ├── WledCard.tsx
│           │   │   └── TasmotaCard.tsx
│           │   └── history/
│           │       ├── Timeline.tsx      # liste d'événements paginée
│           │       └── Filters.tsx       # barre de filtres
│           ├── store/
│           │   └── room.ts               # Zustand store
│           └── lib/
│               ├── ws.ts                 # WebSocket client + reconnexion backoff
│               └── api.ts               # helpers TanStack Query
```

---

## Types partagés (référence pour toutes les tâches)

**Backend — `interpreters/types.ts`**
```typescript
export interface DeviceState {
  source: string
  event_type: string
  state: Record<string, unknown>
  raw: string          // payload MQTT original
  timestamp: number    // Unix ms
}

export interface Interpreter {
  source: string
  topics: string[]
  debounceMs?: number
  parse(topic: string, payload: Buffer): DeviceState | null
}
```

**WebSocket protocol (backend → frontend)**
```typescript
type WsMessage =
  | { type: 'snapshot'; data: Record<string, DeviceState> }
  | { type: 'update'; source: string; state: DeviceState }
```

**Frontend — `store/room.ts` type**
```typescript
interface FrontendDeviceState {
  source: string
  event_type: string
  state: Record<string, unknown>
  timestamp: number
}
```

---

## Task 1: Monorepo scaffolding

**Files:**
- Create: `package.json` (root)
- Create: `.env.example`
- Create: `apps/backend/package.json`
- Create: `apps/backend/tsconfig.json`
- Create: `apps/backend/vitest.config.ts`

- [ ] **Step 1: Créer la structure de dossiers**

```bash
mkdir -p apps/backend/src/{mqtt,interpreters,pipeline,store,db,ws,api}
mkdir -p apps/frontend
```

- [ ] **Step 2: Créer le package.json racine**

```json
{
  "name": "signal-room",
  "private": true,
  "workspaces": ["apps/*"],
  "scripts": {
    "dev:backend": "npm run dev --workspace=apps/backend",
    "dev:frontend": "npm run dev --workspace=apps/frontend",
    "test:backend": "npm run test --workspace=apps/backend",
    "test:frontend": "npm run test --workspace=apps/frontend"
  }
}
```

- [ ] **Step 3: Créer `apps/backend/package.json`**

```json
{
  "name": "@signal-room/backend",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format cjs --out-dir dist",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.0",
    "@fastify/websocket": "^10.0.1",
    "better-sqlite3": "^11.5.0",
    "fastify": "^4.28.1",
    "ioredis": "^5.4.2",
    "mqtt": "^5.10.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.0.0",
    "ioredis-mock": "^8.9.0",
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: Créer `apps/backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Créer `apps/backend/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
})
```

- [ ] **Step 6: Créer `.env.example` à la racine**

```env
# MQTT
MQTT_HOST=192.168.1.100
MQTT_PORT=1883

# Redis
REDIS_URL=redis://localhost:6379

# SQLite
DB_PATH=./signal-room.db

# Rétention
RETENTION_DAYS=30

# Debounce Frigate (ms)
FRIGATE_DEBOUNCE_MS=300

# Ports
BACKEND_PORT=3001
FRONTEND_PORT=3000
```

- [ ] **Step 7: Installer les dépendances backend**

```bash
cd apps/backend && npm install
```

Expected: `added N packages`

- [ ] **Step 8: Vérifier le workspace**

```bash
npm ls --workspaces 2>/dev/null | head -10
```

Expected: `@signal-room/backend@0.1.0` visible

- [ ] **Step 9: Commit**

```bash
git add package.json apps/backend/package.json apps/backend/tsconfig.json apps/backend/vitest.config.ts .env.example
git commit -m "chore: monorepo scaffolding with backend workspace"
```

---

## Task 2: Backend config

**Files:**
- Create: `apps/backend/src/config.ts`
- Create: `apps/backend/src/config.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/config.test.ts` :

```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.MQTT_HOST
    delete process.env.MQTT_PORT
    delete process.env.REDIS_URL
    delete process.env.DB_PATH
    delete process.env.RETENTION_DAYS
    delete process.env.FRIGATE_DEBOUNCE_MS
    delete process.env.BACKEND_PORT
  })

  it('utilise les valeurs par défaut', async () => {
    const { loadConfig } = await import('./config')
    const config = loadConfig()
    expect(config.mqtt.host).toBe('localhost')
    expect(config.mqtt.port).toBe(1883)
    expect(config.redis.url).toBe('redis://localhost:6379')
    expect(config.db.path).toBe('./signal-room.db')
    expect(config.retention.days).toBe(30)
    expect(config.frigate.debounceMs).toBe(300)
    expect(config.port).toBe(3001)
  })

  it('lit les variables d\'environnement', async () => {
    process.env.MQTT_HOST = '192.168.1.50'
    process.env.MQTT_PORT = '1884'
    process.env.RETENTION_DAYS = '7'
    const { loadConfig } = await import('./config')
    const config = loadConfig()
    expect(config.mqtt.host).toBe('192.168.1.50')
    expect(config.mqtt.port).toBe(1884)
    expect(config.retention.days).toBe(7)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL — `Cannot find module './config'`

- [ ] **Step 3: Implémenter `apps/backend/src/config.ts`**

```typescript
export interface Config {
  mqtt: { host: string; port: number }
  redis: { url: string }
  db: { path: string }
  retention: { days: number }
  frigate: { debounceMs: number }
  port: number
}

export function loadConfig(): Config {
  return {
    mqtt: {
      host: process.env.MQTT_HOST ?? 'localhost',
      port: parseInt(process.env.MQTT_PORT ?? '1883', 10),
    },
    redis: {
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    },
    db: {
      path: process.env.DB_PATH ?? './signal-room.db',
    },
    retention: {
      days: parseInt(process.env.RETENTION_DAYS ?? '30', 10),
    },
    frigate: {
      debounceMs: parseInt(process.env.FRIGATE_DEBOUNCE_MS ?? '300', 10),
    },
    port: parseInt(process.env.BACKEND_PORT ?? '3001', 10),
  }
}

export const config = loadConfig()
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd apps/backend && npm test
```

Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/config.ts apps/backend/src/config.test.ts
git commit -m "feat(backend): config loading from env vars"
```

---

## Task 3: Types des interpréteurs

**Files:**
- Create: `apps/backend/src/interpreters/types.ts`
- Create: `apps/backend/src/interpreters/types.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/interpreters/types.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import type { DeviceState, Interpreter } from './types'

describe('DeviceState type', () => {
  it('accepte un état valide', () => {
    const state: DeviceState = {
      source: 'frigate',
      event_type: 'detection_start',
      state: { object: 'person', zone: 'chambre' },
      raw: '{"type":"new"}',
      timestamp: Date.now(),
    }
    expect(state.source).toBe('frigate')
    expect(state.timestamp).toBeTypeOf('number')
  })
})

describe('Interpreter interface', () => {
  it('un interpréteur valide est compilable', () => {
    const interp: Interpreter = {
      source: 'test',
      topics: ['test/+/events'],
      debounceMs: 100,
      parse: (_topic, _payload) => null,
    }
    expect(interp.topics).toHaveLength(1)
    expect(interp.debounceMs).toBe(100)
  })

  it('debounceMs est optionnel', () => {
    const interp: Interpreter = {
      source: 'test',
      topics: ['test/topic'],
      parse: () => null,
    }
    expect(interp.debounceMs).toBeUndefined()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL — `Cannot find module './types'`

- [ ] **Step 3: Implémenter `apps/backend/src/interpreters/types.ts`**

```typescript
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
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/interpreters/types.ts apps/backend/src/interpreters/types.test.ts
git commit -m "feat(backend): interpreter and device state types"
```

---

## Task 4: SQLite client & schema

**Files:**
- Create: `apps/backend/src/db/client.ts`
- Create: `apps/backend/src/db/schema.ts`
- Create: `apps/backend/src/db/queries.ts`
- Create: `apps/backend/src/db/client.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/db/client.test.ts` :

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from './client'
import { applySchema } from './schema'
import { insertEvent, queryEvents } from './queries'

describe('SQLite client', () => {
  let db: ReturnType<typeof createDb>

  beforeEach(() => {
    db = createDb(':memory:')
    applySchema(db)
  })

  afterEach(() => {
    db.close()
  })

  it('ouvre une base en mémoire', () => {
    expect(db).toBeDefined()
  })

  it('insère et lit un event', () => {
    insertEvent(db, {
      source: 'wled',
      topic: 'wled/chambre/v',
      event_type: 'state_change',
      payload: JSON.stringify({ power: true }),
      raw: '{"on":true}',
      created_at: Date.now(),
    })

    const events = queryEvents(db, { source: 'wled', limit: 10, page: 1 })
    expect(events.data).toHaveLength(1)
    expect(events.data[0].source).toBe('wled')
    expect(events.total).toBe(1)
  })

  it('filtre par source', () => {
    insertEvent(db, {
      source: 'frigate',
      topic: 'frigate/cam/events',
      event_type: 'detection_start',
      payload: '{}',
      raw: '{}',
      created_at: Date.now(),
    })
    insertEvent(db, {
      source: 'wled',
      topic: 'wled/chambre/v',
      event_type: 'state_change',
      payload: '{}',
      raw: '{}',
      created_at: Date.now(),
    })

    const result = queryEvents(db, { source: 'frigate', limit: 10, page: 1 })
    expect(result.data).toHaveLength(1)
    expect(result.total).toBe(1)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL — `Cannot find module './client'`

- [ ] **Step 3: Implémenter `apps/backend/src/db/client.ts`**

```typescript
import Database from 'better-sqlite3'

export function createDb(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}
```

- [ ] **Step 4: Implémenter `apps/backend/src/db/schema.ts`**

```typescript
import type Database from 'better-sqlite3'

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
  `)
}
```

- [ ] **Step 5: Implémenter `apps/backend/src/db/queries.ts`**

```typescript
import type Database from 'better-sqlite3'

interface InsertEventParams {
  source: string
  topic: string
  event_type: string
  payload: string
  raw: string
  created_at: number
}

interface QueryEventsParams {
  source?: string
  event_type?: string
  from?: number
  to?: number
  page: number
  limit: number
}

interface EventRow {
  id: number
  source: string
  topic: string
  event_type: string
  payload: string
  raw: string
  created_at: number
}

export function insertEvent(db: Database.Database, params: InsertEventParams): void {
  db.prepare(`
    INSERT INTO events (source, topic, event_type, payload, raw, created_at)
    VALUES (@source, @topic, @event_type, @payload, @raw, @created_at)
  `).run(params)
}

export function insertSnapshot(db: Database.Database, source: string, state: string): void {
  db.prepare(`
    INSERT INTO device_snapshots (source, state, created_at)
    VALUES (?, ?, ?)
  `).run(source, state, Date.now())
}

export function queryEvents(
  db: Database.Database,
  params: QueryEventsParams
): { data: EventRow[]; total: number } {
  const conditions: string[] = []
  const bindings: Record<string, unknown> = {}

  if (params.source) {
    conditions.push('source = @source')
    bindings.source = params.source
  }
  if (params.event_type) {
    conditions.push('event_type = @event_type')
    bindings.event_type = params.event_type
  }
  if (params.from) {
    conditions.push('created_at >= @from')
    bindings.from = params.from
  }
  if (params.to) {
    conditions.push('created_at <= @to')
    bindings.to = params.to
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const offset = (params.page - 1) * params.limit

  const total = (db.prepare(`SELECT COUNT(*) as count FROM events ${where}`).get(bindings) as { count: number }).count
  const data = db.prepare(`
    SELECT * FROM events ${where}
    ORDER BY created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...bindings, limit: params.limit, offset }) as EventRow[]

  return { data, total }
}

export function deleteOldEvents(db: Database.Database, beforeTimestamp: number): number {
  const result = db.prepare('DELETE FROM events WHERE created_at < ?').run(beforeTimestamp)
  return result.changes
}
```

- [ ] **Step 6: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS — 3 tests

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db/
git commit -m "feat(backend): SQLite client, schema and queries"
```

---

## Task 5: Redis client

**Files:**
- Create: `apps/backend/src/store/redis.ts`
- Create: `apps/backend/src/store/redis.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/store/redis.test.ts` :

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('ioredis', async () => {
  const { default: RedisMock } = await import('ioredis-mock')
  return { default: RedisMock }
})

describe('Redis store', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('stocke et récupère un état device', async () => {
    const { createRedisStore } = await import('./redis')
    const store = createRedisStore('redis://localhost:6379')

    await store.setDeviceState('wled', {
      source: 'wled',
      event_type: 'state_change',
      state: { power: true, brightness: 80 },
      raw: '{"on":true}',
      timestamp: 1234567890,
    })

    const result = await store.getDeviceState('wled')
    expect(result?.source).toBe('wled')
    expect(result?.state).toEqual({ power: true, brightness: 80 })

    await store.quit()
  })

  it('retourne null si le device n\'existe pas', async () => {
    const { createRedisStore } = await import('./redis')
    const store = createRedisStore('redis://localhost:6379')

    const result = await store.getDeviceState('unknown')
    expect(result).toBeNull()

    await store.quit()
  })

  it('retourne tous les états via getAllDeviceStates', async () => {
    const { createRedisStore } = await import('./redis')
    const store = createRedisStore('redis://localhost:6379')

    await store.setDeviceState('frigate', {
      source: 'frigate',
      event_type: 'detection_start',
      state: { person: true },
      raw: '{}',
      timestamp: 1234567890,
    })
    await store.setDeviceState('wled', {
      source: 'wled',
      event_type: 'state_change',
      state: { power: false },
      raw: '{}',
      timestamp: 1234567890,
    })

    const all = await store.getAllDeviceStates()
    expect(Object.keys(all)).toHaveLength(2)
    expect(all.frigate.state).toEqual({ person: true })

    await store.quit()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL — `Cannot find module './redis'`

- [ ] **Step 3: Implémenter `apps/backend/src/store/redis.ts`**

```typescript
import Redis from 'ioredis'
import type { DeviceState } from '../interpreters/types'

const DEVICE_KEY_PREFIX = 'device:'

export interface RedisStore {
  setDeviceState(source: string, state: DeviceState): Promise<void>
  getDeviceState(source: string): Promise<DeviceState | null>
  getAllDeviceStates(): Promise<Record<string, DeviceState>>
  quit(): Promise<void>
}

export function createRedisStore(url: string): RedisStore {
  const client = new Redis(url, { lazyConnect: false })

  return {
    async setDeviceState(source, state) {
      await client.set(`${DEVICE_KEY_PREFIX}${source}`, JSON.stringify(state))
    },

    async getDeviceState(source) {
      const raw = await client.get(`${DEVICE_KEY_PREFIX}${source}`)
      if (!raw) return null
      return JSON.parse(raw) as DeviceState
    },

    async getAllDeviceStates() {
      const keys = await client.keys(`${DEVICE_KEY_PREFIX}*`)
      if (keys.length === 0) return {}

      const values = await client.mget(...keys)
      const result: Record<string, DeviceState> = {}

      keys.forEach((key, i) => {
        const val = values[i]
        if (val) {
          const source = key.replace(DEVICE_KEY_PREFIX, '')
          result[source] = JSON.parse(val) as DeviceState
        }
      })

      return result
    },

    async quit() {
      await client.quit()
    },
  }
}
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/store/redis.ts apps/backend/src/store/redis.test.ts
git commit -m "feat(backend): Redis store for device state"
```

---

## Task 6: Déduplication en mémoire

**Files:**
- Create: `apps/backend/src/pipeline/dedup.ts`
- Create: `apps/backend/src/pipeline/dedup.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/pipeline/dedup.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { createDedupStore } from './dedup'
import type { DeviceState } from '../interpreters/types'

const makeState = (source: string, overrides: Partial<DeviceState> = {}): DeviceState => ({
  source,
  event_type: 'state_change',
  state: { power: true },
  raw: '{}',
  timestamp: Date.now(),
  ...overrides,
})

describe('DedupStore', () => {
  it('retourne true si c\'est un nouvel état (aucune entrée préalable)', () => {
    const store = createDedupStore()
    const state = makeState('wled')
    expect(store.hasChanged(state)).toBe(true)
  })

  it('retourne false si l\'état est identique', () => {
    const store = createDedupStore()
    const state = makeState('wled', { state: { power: true, brightness: 80 } })
    store.update(state)
    const same = makeState('wled', { state: { power: true, brightness: 80 } })
    expect(store.hasChanged(same)).toBe(false)
  })

  it('retourne true si l\'état a changé', () => {
    const store = createDedupStore()
    const state = makeState('wled', { state: { power: true } })
    store.update(state)
    const changed = makeState('wled', { state: { power: false } })
    expect(store.hasChanged(changed)).toBe(true)
  })

  it('met à jour l\'état en mémoire', () => {
    const store = createDedupStore()
    store.update(makeState('frigate', { state: { person: false } }))
    store.update(makeState('frigate', { state: { person: true } }))
    expect(store.hasChanged(makeState('frigate', { state: { person: true } }))).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL — `Cannot find module './dedup'`

- [ ] **Step 3: Implémenter `apps/backend/src/pipeline/dedup.ts`**

```typescript
import type { DeviceState } from '../interpreters/types'

export interface DedupStore {
  hasChanged(state: DeviceState): boolean
  update(state: DeviceState): void
}

export function createDedupStore(): DedupStore {
  const memory = new Map<string, string>()

  return {
    hasChanged(state: DeviceState): boolean {
      const key = state.source
      const serialized = JSON.stringify(state.state)
      return memory.get(key) !== serialized
    },

    update(state: DeviceState): void {
      memory.set(state.source, JSON.stringify(state.state))
    },
  }
}
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/pipeline/dedup.ts apps/backend/src/pipeline/dedup.test.ts
git commit -m "feat(backend): in-memory deduplication store"
```

---

## Task 7: Debounce par source

**Files:**
- Create: `apps/backend/src/pipeline/debounce.ts`
- Create: `apps/backend/src/pipeline/debounce.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/pipeline/debounce.test.ts` :

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDebounce } from './debounce'

describe('createDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('appelle la fonction après le délai', () => {
    const debounce = createDebounce(300)
    const fn = vi.fn()
    debounce('frigate', fn)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('réinitialise le timer si un second appel arrive avant le délai', () => {
    const debounce = createDebounce(300)
    const fn = vi.fn()
    debounce('frigate', fn)
    vi.advanceTimersByTime(200)
    debounce('frigate', fn)
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('gère des clés différentes indépendamment', () => {
    const debounce = createDebounce(300)
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    debounce('frigate', fn1)
    debounce('wled', fn2)
    vi.advanceTimersByTime(300)
    expect(fn1).toHaveBeenCalledOnce()
    expect(fn2).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL — `Cannot find module './debounce'`

- [ ] **Step 3: Implémenter `apps/backend/src/pipeline/debounce.ts`**

```typescript
export type DebounceFn = (key: string, fn: () => void) => void

export function createDebounce(ms: number): DebounceFn {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  return function debounce(key: string, fn: () => void): void {
    const existing = timers.get(key)
    if (existing) clearTimeout(existing)

    timers.set(key, setTimeout(() => {
      timers.delete(key)
      fn()
    }, ms))
  }
}
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/pipeline/debounce.ts apps/backend/src/pipeline/debounce.test.ts
git commit -m "feat(backend): configurable per-source debounce"
```

---

## Task 8: Interpréteur Frigate

**Files:**
- Create: `apps/backend/src/interpreters/frigate.ts`
- Create: `apps/backend/src/interpreters/frigate.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/interpreters/frigate.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { frigateInterpreter } from './frigate'

const toBuffer = (obj: unknown) => Buffer.from(JSON.stringify(obj))

describe('frigateInterpreter', () => {
  it('a les bons topics', () => {
    expect(frigateInterpreter.topics).toContain('frigate/+/events')
  })

  it('retourne null pour un topic inconnu', () => {
    const result = frigateInterpreter.parse('frigate/cam/unknown', toBuffer({}))
    expect(result).toBeNull()
  })

  it('parse un événement de début de détection (type: new)', () => {
    const payload = {
      type: 'new',
      after: {
        id: 'abc123',
        label: 'person',
        camera: 'chambre_cam',
        current_zones: ['chambre'],
        score: 0.92,
      },
    }
    const result = frigateInterpreter.parse('frigate/chambre_cam/events', toBuffer(payload))
    expect(result).not.toBeNull()
    expect(result?.event_type).toBe('detection_start')
    expect(result?.state).toMatchObject({
      object: 'person',
      zone: 'chambre',
      confidence: 0.92,
      camera: 'chambre_cam',
      session_id: 'abc123',
    })
  })

  it('parse un événement de fin de détection (type: end)', () => {
    const payload = {
      type: 'end',
      after: {
        id: 'abc123',
        label: 'person',
        camera: 'chambre_cam',
        current_zones: ['chambre'],
        score: 0.85,
      },
    }
    const result = frigateInterpreter.parse('frigate/chambre_cam/events', toBuffer(payload))
    expect(result?.event_type).toBe('detection_end')
  })

  it('ignore les événements de type update', () => {
    const payload = {
      type: 'update',
      after: {
        id: 'abc123',
        label: 'person',
        camera: 'chambre_cam',
        current_zones: ['chambre'],
        score: 0.88,
      },
    }
    const result = frigateInterpreter.parse('frigate/chambre_cam/events', toBuffer(payload))
    expect(result).toBeNull()
  })

  it('retourne null si le payload est invalide', () => {
    const result = frigateInterpreter.parse('frigate/cam/events', Buffer.from('invalid json{'))
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL — `Cannot find module './frigate'`

- [ ] **Step 3: Implémenter `apps/backend/src/interpreters/frigate.ts`**

```typescript
import type { Interpreter, DeviceState } from './types'

interface FrigateEventAfter {
  id: string
  label: string
  camera: string
  current_zones: string[]
  score: number
}

interface FrigatePayload {
  type: 'new' | 'update' | 'end'
  after: FrigateEventAfter
}

export const frigateInterpreter: Interpreter = {
  source: 'frigate',
  topics: ['frigate/+/events'],
  debounceMs: 300,

  parse(topic: string, payload: Buffer): DeviceState | null {
    if (!topic.endsWith('/events')) return null

    let data: FrigatePayload
    try {
      data = JSON.parse(payload.toString()) as FrigatePayload
    } catch {
      return null
    }

    if (data.type === 'update') return null

    const { after } = data
    const event_type = data.type === 'new' ? 'detection_start' : 'detection_end'

    return {
      source: 'frigate',
      event_type,
      state: {
        object: after.label,
        zone: after.current_zones[0] ?? 'unknown',
        confidence: Math.round(after.score * 100) / 100,
        camera: after.camera,
        session_id: after.id,
        active: data.type === 'new',
      },
      raw: payload.toString(),
      timestamp: Date.now(),
    }
  },
}
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS — 6 tests pour Frigate

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/interpreters/frigate.ts apps/backend/src/interpreters/frigate.test.ts
git commit -m "feat(backend): Frigate interpreter with session tracking"
```

---

## Task 9: Interpréteur WLED

**Files:**
- Create: `apps/backend/src/interpreters/wled.ts`
- Create: `apps/backend/src/interpreters/wled.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/interpreters/wled.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { wledInterpreter } from './wled'

const toBuffer = (obj: unknown) => Buffer.from(JSON.stringify(obj))

describe('wledInterpreter', () => {
  it('a les bons topics', () => {
    expect(wledInterpreter.topics).toContain('wled/+/v')
  })

  it('retourne null pour un topic inconnu', () => {
    const result = wledInterpreter.parse('wled/chambre/unknown', toBuffer({}))
    expect(result).toBeNull()
  })

  it('parse un état allumé avec couleur et effet', () => {
    const payload = {
      on: true,
      bri: 204,
      seg: [
        {
          col: [[255, 68, 0]],
          fx: 65,
          pal: 0,
        },
      ],
    }
    const result = wledInterpreter.parse('wled/chambre/v', toBuffer(payload))
    expect(result).not.toBeNull()
    expect(result?.event_type).toBe('state_change')
    expect(result?.state).toMatchObject({
      power: true,
      brightness: 80,
      color: '#ff4400',
    })
    expect(result?.state.effect_id).toBe(65)
  })

  it('parse un état éteint', () => {
    const payload = { on: false, bri: 0, seg: [{ col: [[0, 0, 0]], fx: 0, pal: 0 }] }
    const result = wledInterpreter.parse('wled/chambre/v', toBuffer(payload))
    expect(result?.state.power).toBe(false)
    expect(result?.state.brightness).toBe(0)
  })

  it('retourne null si le payload est invalide', () => {
    const result = wledInterpreter.parse('wled/chambre/v', Buffer.from('not json'))
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL — `Cannot find module './wled'`

- [ ] **Step 3: Implémenter `apps/backend/src/interpreters/wled.ts`**

```typescript
import type { Interpreter, DeviceState } from './types'

interface WledSegment {
  col: number[][]
  fx: number
  pal: number
}

interface WledPayload {
  on: boolean
  bri: number
  seg?: WledSegment[]
}

function toHex(rgb: number[]): string {
  return '#' + rgb.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')
}

export const wledInterpreter: Interpreter = {
  source: 'wled',
  topics: ['wled/+/v'],

  parse(topic: string, payload: Buffer): DeviceState | null {
    if (!topic.endsWith('/v')) return null

    let data: WledPayload
    try {
      data = JSON.parse(payload.toString()) as WledPayload
    } catch {
      return null
    }

    const segment = data.seg?.[0]
    const color = segment?.col?.[0] ? toHex(segment.col[0]) : '#000000'
    const brightness = Math.round((data.bri / 255) * 100)

    return {
      source: 'wled',
      event_type: 'state_change',
      state: {
        power: data.on,
        brightness,
        color,
        effect_id: segment?.fx ?? 0,
        palette_id: segment?.pal ?? 0,
      },
      raw: payload.toString(),
      timestamp: Date.now(),
    }
  },
}
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/interpreters/wled.ts apps/backend/src/interpreters/wled.test.ts
git commit -m "feat(backend): WLED interpreter"
```

---

## Task 10: Interpréteur Tasmota

**Files:**
- Create: `apps/backend/src/interpreters/tasmota.ts`
- Create: `apps/backend/src/interpreters/tasmota.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/interpreters/tasmota.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { tasmotaInterpreter } from './tasmota'

const toBuffer = (obj: unknown) => Buffer.from(JSON.stringify(obj))

describe('tasmotaInterpreter', () => {
  it('a les bons topics', () => {
    expect(tasmotaInterpreter.topics).toContain('tele/+/STATE')
    expect(tasmotaInterpreter.topics).toContain('tele/+/SENSOR')
  })

  it('retourne null pour un topic inconnu', () => {
    const result = tasmotaInterpreter.parse('stat/device/SOMETHING', toBuffer({}))
    expect(result).toBeNull()
  })

  it('parse un STATE (interrupteur/prise)', () => {
    const payload = {
      Time: '2024-01-01T12:00:00',
      POWER: 'ON',
      Wifi: { RSSI: 72 },
    }
    const result = tasmotaInterpreter.parse('tele/prise_bureau/STATE', toBuffer(payload))
    expect(result).not.toBeNull()
    expect(result?.event_type).toBe('state_change')
    expect(result?.state).toMatchObject({
      power: true,
      device_id: 'prise_bureau',
    })
  })

  it('parse un SENSOR avec énergie', () => {
    const payload = {
      Time: '2024-01-01T12:00:00',
      ENERGY: {
        Power: 45,
        Voltage: 230,
        Current: 0.196,
        Today: 0.123,
        Total: 1.234,
      },
    }
    const result = tasmotaInterpreter.parse('tele/prise_bureau/SENSOR', toBuffer(payload))
    expect(result?.event_type).toBe('sensor_update')
    expect(result?.state).toMatchObject({
      watt: 45,
      voltage: 230,
      kwh_today: 0.123,
      kwh_total: 1.234,
      device_id: 'prise_bureau',
    })
  })

  it('parse un SENSOR avec température/humidité', () => {
    const payload = {
      Time: '2024-01-01T12:00:00',
      AM2301: { Temperature: 21.5, Humidity: 58.0 },
    }
    const result = tasmotaInterpreter.parse('tele/capteur/SENSOR', toBuffer(payload))
    expect(result?.state).toMatchObject({
      temperature: 21.5,
      humidity: 58.0,
    })
  })

  it('retourne null si le payload est invalide', () => {
    const result = tasmotaInterpreter.parse('tele/device/STATE', Buffer.from('bad json'))
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL — `Cannot find module './tasmota'`

- [ ] **Step 3: Implémenter `apps/backend/src/interpreters/tasmota.ts`**

```typescript
import type { Interpreter, DeviceState } from './types'

interface TasmotaStatePayload {
  Time?: string
  POWER?: 'ON' | 'OFF'
  POWER1?: 'ON' | 'OFF'
  Wifi?: { RSSI?: number }
}

interface TasmotaEnergy {
  Power?: number
  Voltage?: number
  Current?: number
  Today?: number
  Total?: number
}

interface TasmotaSensorPayload {
  Time?: string
  ENERGY?: TasmotaEnergy
  [key: string]: unknown
}

function extractDeviceId(topic: string): string {
  const parts = topic.split('/')
  return parts[1] ?? 'unknown'
}

export const tasmotaInterpreter: Interpreter = {
  source: 'tasmota',
  topics: ['tele/+/STATE', 'tele/+/SENSOR'],

  parse(topic: string, payload: Buffer): DeviceState | null {
    const parts = topic.split('/')
    const msgType = parts[2]

    if (msgType !== 'STATE' && msgType !== 'SENSOR') return null

    const device_id = extractDeviceId(topic)
    let data: TasmotaStatePayload & TasmotaSensorPayload

    try {
      data = JSON.parse(payload.toString())
    } catch {
      return null
    }

    if (msgType === 'STATE') {
      const powerRaw = data.POWER ?? data.POWER1
      if (powerRaw === undefined) return null

      return {
        source: 'tasmota',
        event_type: 'state_change',
        state: {
          device_id,
          power: powerRaw === 'ON',
          rssi: data.Wifi?.RSSI,
        },
        raw: payload.toString(),
        timestamp: Date.now(),
      }
    }

    if (msgType === 'SENSOR') {
      const state: Record<string, unknown> = { device_id }

      if (data.ENERGY) {
        state.watt = data.ENERGY.Power
        state.voltage = data.ENERGY.Voltage
        state.current = data.ENERGY.Current
        state.kwh_today = data.ENERGY.Today
        state.kwh_total = data.ENERGY.Total
        return {
          source: 'tasmota',
          event_type: 'sensor_update',
          state,
          raw: payload.toString(),
          timestamp: Date.now(),
        }
      }

      for (const [key, val] of Object.entries(data)) {
        if (key === 'Time') continue
        if (typeof val === 'object' && val !== null) {
          const sensor = val as Record<string, unknown>
          if ('Temperature' in sensor) state.temperature = sensor.Temperature
          if ('Humidity' in sensor) state.humidity = sensor.Humidity
          if ('Pressure' in sensor) state.pressure = sensor.Pressure
        }
      }

      if (Object.keys(state).length <= 1) return null

      return {
        source: 'tasmota',
        event_type: 'sensor_update',
        state,
        raw: payload.toString(),
        timestamp: Date.now(),
      }
    }

    return null
  },
}
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/interpreters/tasmota.ts apps/backend/src/interpreters/tasmota.test.ts
git commit -m "feat(backend): Tasmota interpreter (power, energy, sensors)"
```

---

## Task 11: Registre des interpréteurs

**Files:**
- Create: `apps/backend/src/interpreters/index.ts`
- Create: `apps/backend/src/interpreters/index.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/interpreters/index.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { createInterpreterRegistry } from './index'
import { frigateInterpreter } from './frigate'
import { wledInterpreter } from './wled'

describe('InterpreterRegistry', () => {
  it('collecte tous les topics des interpréteurs enregistrés', () => {
    const registry = createInterpreterRegistry([frigateInterpreter, wledInterpreter])
    const topics = registry.getAllTopics()
    expect(topics).toContain('frigate/+/events')
    expect(topics).toContain('wled/+/v')
  })

  it('route un message vers le bon interpréteur', () => {
    const registry = createInterpreterRegistry([frigateInterpreter, wledInterpreter])
    const payload = Buffer.from(JSON.stringify({ on: true, bri: 255, seg: [{ col: [[255, 0, 0]], fx: 0, pal: 0 }] }))
    const result = registry.route('wled/chambre/v', payload)
    expect(result).not.toBeNull()
    expect(result?.source).toBe('wled')
  })

  it('retourne null si aucun interpréteur ne correspond', () => {
    const registry = createInterpreterRegistry([frigateInterpreter])
    const result = registry.route('zigbee/device/state', Buffer.from('{}'))
    expect(result).toBeNull()
  })

  it('expose le debounceMs de l\'interpréteur correspondant', () => {
    const registry = createInterpreterRegistry([frigateInterpreter])
    const debounce = registry.getDebounceMs('frigate')
    expect(debounce).toBe(300)
  })

  it('retourne undefined si pas de debounce configuré', () => {
    const registry = createInterpreterRegistry([wledInterpreter])
    const debounce = registry.getDebounceMs('wled')
    expect(debounce).toBeUndefined()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL

- [ ] **Step 3: Implémenter `apps/backend/src/interpreters/index.ts`**

```typescript
import type { Interpreter, DeviceState } from './types'
import { frigateInterpreter } from './frigate'
import { wledInterpreter } from './wled'
import { tasmotaInterpreter } from './tasmota'

export const DEFAULT_INTERPRETERS: Interpreter[] = [
  frigateInterpreter,
  wledInterpreter,
  tasmotaInterpreter,
]

export interface InterpreterRegistry {
  getAllTopics(): string[]
  route(topic: string, payload: Buffer): DeviceState | null
  getDebounceMs(source: string): number | undefined
}

export function createInterpreterRegistry(interpreters: Interpreter[]): InterpreterRegistry {
  return {
    getAllTopics() {
      return interpreters.flatMap(i => i.topics)
    },

    route(topic: string, payload: Buffer): DeviceState | null {
      for (const interpreter of interpreters) {
        const result = interpreter.parse(topic, payload)
        if (result !== null) return result
      }
      return null
    },

    getDebounceMs(source: string): number | undefined {
      return interpreters.find(i => i.source === source)?.debounceMs
    },
  }
}
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/interpreters/index.ts apps/backend/src/interpreters/index.test.ts
git commit -m "feat(backend): interpreter registry with auto topic routing"
```

---

## Task 12: Client MQTT & pipeline

**Files:**
- Create: `apps/backend/src/mqtt/client.ts`
- Create: `apps/backend/src/mqtt/client.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/mqtt/client.test.ts` :

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('mqtt', () => ({
  connect: vi.fn(() => ({
    on: vi.fn(),
    subscribe: vi.fn((_topics, _opts, cb) => cb && cb(null)),
    end: vi.fn(),
  })),
}))

describe('createMqttClient', () => {
  beforeEach(() => vi.clearAllMocks())

  it('se connecte au broker et souscrit aux topics', async () => {
    const mqtt = await import('mqtt')
    const { createMqttClient } = await import('./client')

    const onMessage = vi.fn()
    createMqttClient({
      host: 'localhost',
      port: 1883,
      topics: ['frigate/+/events', 'wled/+/v'],
      onMessage,
    })

    expect(mqtt.connect).toHaveBeenCalledWith('mqtt://localhost:1883')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL

- [ ] **Step 3: Implémenter `apps/backend/src/mqtt/client.ts`**

```typescript
import mqtt from 'mqtt'
import type { DeviceState } from '../interpreters/types'

interface MqttClientOptions {
  host: string
  port: number
  topics: string[]
  onMessage: (topic: string, payload: Buffer) => void
}

export function createMqttClient(options: MqttClientOptions): mqtt.MqttClient {
  const client = mqtt.connect(`mqtt://${options.host}:${options.port}`)

  client.on('connect', () => {
    console.log(`[MQTT] Connected to ${options.host}:${options.port}`)
    client.subscribe(options.topics, { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscribe error:', err)
      else console.log(`[MQTT] Subscribed to ${options.topics.length} topics`)
    })
  })

  client.on('message', (topic, payload) => {
    options.onMessage(topic, payload)
  })

  client.on('error', (err) => {
    console.error('[MQTT] Error:', err)
  })

  client.on('disconnect', () => {
    console.warn('[MQTT] Disconnected')
  })

  return client
}
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/mqtt/client.ts apps/backend/src/mqtt/client.test.ts
git commit -m "feat(backend): MQTT client"
```

---

## Task 13: WebSocket server

**Files:**
- Create: `apps/backend/src/ws/server.ts`
- Create: `apps/backend/src/ws/server.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/ws/server.test.ts` :

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createBroadcaster } from './server'
import type { DeviceState } from '../interpreters/types'

describe('createBroadcaster', () => {
  it('envoie un message à tous les clients connectés', () => {
    const broadcaster = createBroadcaster()

    const client1 = { readyState: 1, send: vi.fn() }
    const client2 = { readyState: 1, send: vi.fn() }
    broadcaster.addClient(client1 as never)
    broadcaster.addClient(client2 as never)

    const state: DeviceState = {
      source: 'wled',
      event_type: 'state_change',
      state: { power: true },
      raw: '{}',
      timestamp: Date.now(),
    }
    broadcaster.broadcast('wled', state)

    expect(client1.send).toHaveBeenCalledOnce()
    expect(client2.send).toHaveBeenCalledOnce()

    const msg = JSON.parse(client1.send.mock.calls[0][0] as string)
    expect(msg.type).toBe('update')
    expect(msg.source).toBe('wled')
  })

  it('n\'envoie pas aux clients déconnectés (readyState !== 1)', () => {
    const broadcaster = createBroadcaster()
    const client = { readyState: 3, send: vi.fn() }
    broadcaster.addClient(client as never)

    broadcaster.broadcast('wled', {
      source: 'wled',
      event_type: 'state_change',
      state: {},
      raw: '{}',
      timestamp: Date.now(),
    })

    expect(client.send).not.toHaveBeenCalled()
  })

  it('retire un client via removeClient', () => {
    const broadcaster = createBroadcaster()
    const client = { readyState: 1, send: vi.fn() }
    broadcaster.addClient(client as never)
    broadcaster.removeClient(client as never)

    broadcaster.broadcast('wled', {
      source: 'wled',
      event_type: 'state_change',
      state: {},
      raw: '{}',
      timestamp: Date.now(),
    })

    expect(client.send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL

- [ ] **Step 3: Implémenter `apps/backend/src/ws/server.ts`**

```typescript
import type { WebSocket } from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { DeviceState } from '../interpreters/types'
import type { RedisStore } from '../store/redis'

interface WsMessage {
  type: 'snapshot' | 'update'
  data?: Record<string, DeviceState>
  source?: string
  state?: DeviceState
}

export interface Broadcaster {
  addClient(ws: WebSocket): void
  removeClient(ws: WebSocket): void
  broadcast(source: string, state: DeviceState): void
}

export function createBroadcaster(): Broadcaster {
  const clients = new Set<WebSocket>()

  return {
    addClient(ws: WebSocket) {
      clients.add(ws)
    },

    removeClient(ws: WebSocket) {
      clients.delete(ws)
    },

    broadcast(source: string, state: DeviceState) {
      const message: WsMessage = { type: 'update', source, state }
      const payload = JSON.stringify(message)

      for (const client of clients) {
        if (client.readyState === 1) {
          client.send(payload)
        }
      }
    },
  }
}

export async function registerWsRoutes(
  fastify: FastifyInstance,
  broadcaster: Broadcaster,
  redisStore: RedisStore
): Promise<void> {
  fastify.get('/ws', { websocket: true }, async (socket) => {
    broadcaster.addClient(socket)

    const snapshot = await redisStore.getAllDeviceStates()
    const message: WsMessage = { type: 'snapshot', data: snapshot }
    socket.send(JSON.stringify(message))

    socket.on('close', () => {
      broadcaster.removeClient(socket)
    })
  })
}
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ws/server.ts apps/backend/src/ws/server.test.ts
git commit -m "feat(backend): WebSocket broadcaster and route"
```

---

## Task 14: Routes REST

**Files:**
- Create: `apps/backend/src/api/devices.ts`
- Create: `apps/backend/src/api/history.ts`
- Create: `apps/backend/src/api/history.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/api/history.test.ts` :

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { createDb } from '../db/client'
import { applySchema } from '../db/schema'
import { insertEvent } from '../db/queries'
import { registerHistoryRoutes } from './history'
import type Database from 'better-sqlite3'

describe('GET /api/events', () => {
  let app: ReturnType<typeof Fastify>
  let db: Database.Database

  beforeEach(async () => {
    db = createDb(':memory:')
    applySchema(db)
    app = Fastify()
    registerHistoryRoutes(app, db)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    db.close()
  })

  it('retourne une liste vide', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data).toEqual([])
    expect(body.total).toBe(0)
  })

  it('retourne les events avec pagination', async () => {
    insertEvent(db, {
      source: 'wled',
      topic: 'wled/chambre/v',
      event_type: 'state_change',
      payload: '{"power":true}',
      raw: '{}',
      created_at: Date.now(),
    })

    const res = await app.inject({ method: 'GET', url: '/api/events?page=1&limit=10' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('filtre par source', async () => {
    insertEvent(db, { source: 'frigate', topic: 'f/c/events', event_type: 'detection_start', payload: '{}', raw: '{}', created_at: Date.now() })
    insertEvent(db, { source: 'wled', topic: 'wled/c/v', event_type: 'state_change', payload: '{}', raw: '{}', created_at: Date.now() })

    const res = await app.inject({ method: 'GET', url: '/api/events?source=frigate' })
    const body = JSON.parse(res.body)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].source).toBe('frigate')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL

- [ ] **Step 3: Implémenter `apps/backend/src/api/devices.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import type { RedisStore } from '../store/redis'

export function registerDeviceRoutes(fastify: FastifyInstance, redisStore: RedisStore): void {
  fastify.get('/api/devices', async (_req, reply) => {
    const devices = await redisStore.getAllDeviceStates()
    return reply.send({ devices })
  })
}
```

- [ ] **Step 4: Implémenter `apps/backend/src/api/history.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { queryEvents } from '../db/queries'

interface EventQueryParams {
  source?: string
  event_type?: string
  from?: string
  to?: string
  page?: string
  limit?: string
}

export function registerHistoryRoutes(fastify: FastifyInstance, db: Database.Database): void {
  fastify.get<{ Querystring: EventQueryParams }>('/api/events', async (req, reply) => {
    const {
      source,
      event_type,
      from,
      to,
      page = '1',
      limit = '50',
    } = req.query

    const result = queryEvents(db, {
      source,
      event_type,
      from: from ? parseInt(from, 10) : undefined,
      to: to ? parseInt(to, 10) : undefined,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 200),
    })

    return reply.send(result)
  })
}
```

- [ ] **Step 5: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/api/
git commit -m "feat(backend): REST routes for devices and event history"
```

---

## Task 15: Job de rétention SQLite

**Files:**
- Create: `apps/backend/src/db/retention.ts`
- Create: `apps/backend/src/db/retention.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/backend/src/db/retention.test.ts` :

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createDb } from './client'
import { applySchema } from './schema'
import { insertEvent } from './queries'
import { createRetentionJob } from './retention'
import type Database from 'better-sqlite3'

describe('RetentionJob', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDb(':memory:')
    applySchema(db)
    vi.useFakeTimers()
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  it('supprime les events plus vieux que retentionDays', () => {
    const now = Date.now()
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000

    insertEvent(db, {
      source: 'wled',
      topic: 'wled/c/v',
      event_type: 'state_change',
      payload: '{}',
      raw: '{}',
      created_at: thirtyOneDaysAgo,
    })
    insertEvent(db, {
      source: 'wled',
      topic: 'wled/c/v',
      event_type: 'state_change',
      payload: '{}',
      raw: '{}',
      created_at: now,
    })

    const job = createRetentionJob(db, 30)
    job.runOnce()

    const remaining = db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number }
    expect(remaining.count).toBe(1)
  })

  it('planifie l\'exécution toutes les 24h', () => {
    const job = createRetentionJob(db, 30)
    const spy = vi.spyOn(job, 'runOnce')
    job.start()
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(spy).toHaveBeenCalledOnce()
    job.stop()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/backend && npm test
```

Expected: FAIL

- [ ] **Step 3: Implémenter `apps/backend/src/db/retention.ts`**

```typescript
import type Database from 'better-sqlite3'
import { deleteOldEvents } from './queries'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export interface RetentionJob {
  runOnce(): void
  start(): void
  stop(): void
}

export function createRetentionJob(db: Database.Database, retentionDays: number): RetentionJob {
  let timer: ReturnType<typeof setInterval> | null = null

  const job: RetentionJob = {
    runOnce() {
      const cutoff = Date.now() - retentionDays * ONE_DAY_MS
      const deleted = deleteOldEvents(db, cutoff)
      if (deleted > 0) {
        console.log(`[Retention] Deleted ${deleted} events older than ${retentionDays} days`)
      }
    },

    start() {
      timer = setInterval(() => job.runOnce(), ONE_DAY_MS)
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }

  return job
}
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/backend && npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/db/retention.ts apps/backend/src/db/retention.test.ts
git commit -m "feat(backend): SQLite retention job"
```

---

## Task 16: Backend entry point

**Files:**
- Create: `apps/backend/src/index.ts`

- [ ] **Step 1: Implémenter `apps/backend/src/index.ts`**

```typescript
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
import { createInterpreterRegistry, DEFAULT_INTERPRETERS } from './interpreters/index'
import { createMqttClient } from './mqtt/client'
import { createBroadcaster, registerWsRoutes } from './ws/server'
import { registerDeviceRoutes } from './api/devices'
import { registerHistoryRoutes } from './api/history'
import { insertEvent, insertSnapshot } from './db/queries'

async function main() {
  const db = createDb(config.db.path)
  applySchema(db)

  const redisStore = createRedisStore(config.redis.url)
  const dedupStore = createDedupStore()
  const registry = createInterpreterRegistry(DEFAULT_INTERPRETERS)
  const broadcaster = createBroadcaster()

  const fastify = Fastify({ logger: true })
  await fastify.register(cors, { origin: true })
  await fastify.register(websocket)

  registerWsRoutes(fastify, broadcaster, redisStore)
  registerDeviceRoutes(fastify, redisStore)
  registerHistoryRoutes(fastify, db)

  const retentionJob = createRetentionJob(db, config.retention.days)
  retentionJob.start()

  const debounceMap = new Map<string, ReturnType<typeof createDebounce>>()

  function getDebounce(source: string): ReturnType<typeof createDebounce> | null {
    const ms = registry.getDebounceMs(source)
    if (!ms) return null
    if (!debounceMap.has(source)) {
      debounceMap.set(source, createDebounce(ms))
    }
    return debounceMap.get(source)!
  }

  function processState(topic: string, payload: Buffer) {
    const state = registry.route(topic, payload)
    if (!state) return

    const debounce = getDebounce(state.source)

    const handle = () => {
      if (!dedupStore.hasChanged(state)) return
      dedupStore.update(state)

      broadcaster.broadcast(state.source, state)

      redisStore.setDeviceState(state.source, state).catch(console.error)

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

  createMqttClient({
    host: config.mqtt.host,
    port: config.mqtt.port,
    topics: registry.getAllTopics(),
    onMessage: processState,
  })

  await fastify.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`[Server] Backend running on port ${config.port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Vérifier que le backend démarre sans erreur de compilation TypeScript**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Lancer tous les tests**

```bash
cd apps/backend && npm test
```

Expected: PASS — tous les tests existants

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "feat(backend): entry point wiring all components"
```

---

## Task 17: Frontend setup

**Files:**
- Create: `apps/frontend/` (Next.js app)

- [ ] **Step 1: Initialiser le projet Next.js**

```bash
cd apps/frontend && npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-git
```

Répondre : Yes à tout ce qui est proposé.

- [ ] **Step 2: Installer les dépendances supplémentaires**

```bash
cd apps/frontend && npm install zustand @tanstack/react-query framer-motion lucide-react
```

- [ ] **Step 3: Initialiser shadcn/ui**

```bash
cd apps/frontend && npx shadcn@latest init
```

Sélectionner : Default style, Gray color, CSS variables: yes.

- [ ] **Step 4: Ajouter les composants shadcn nécessaires**

```bash
cd apps/frontend && npx shadcn@latest add card badge button select
```

- [ ] **Step 5: Installer vitest pour le frontend**

```bash
cd apps/frontend && npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/user-event jsdom
```

- [ ] **Step 6: Créer `apps/frontend/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 7: Créer `apps/frontend/src/test-setup.ts`**

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 8: Ajouter le script test dans `apps/frontend/package.json`**

Dans la section `scripts`, ajouter :
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 9: Créer `apps/frontend/next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
}

export default nextConfig
```

- [ ] **Step 10: Vérifier que le projet compile**

```bash
cd apps/frontend && npm run build
```

Expected: Build succeeds

- [ ] **Step 11: Commit**

```bash
git add apps/frontend/
git commit -m "feat(frontend): Next.js setup with shadcn/ui, Zustand, TanStack Query"
```

---

## Task 18: Zustand store

**Files:**
- Create: `apps/frontend/src/store/room.ts`
- Create: `apps/frontend/src/store/room.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/frontend/src/store/room.test.ts` :

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useRoomStore } from './room'

describe('useRoomStore', () => {
  beforeEach(() => {
    useRoomStore.setState({ devices: {}, connected: false })
  })

  it('commence déconnecté sans devices', () => {
    const { devices, connected } = useRoomStore.getState()
    expect(connected).toBe(false)
    expect(devices).toEqual({})
  })

  it('setConnected met à jour l\'état de connexion', () => {
    useRoomStore.getState().setConnected(true)
    expect(useRoomStore.getState().connected).toBe(true)
  })

  it('setDevice ajoute un device', () => {
    const state = {
      source: 'wled',
      event_type: 'state_change',
      state: { power: true, brightness: 80 },
      timestamp: Date.now(),
    }
    useRoomStore.getState().setDevice('wled', state)
    expect(useRoomStore.getState().devices.wled).toEqual(state)
  })

  it('setDevices remplace tous les devices (snapshot initial)', () => {
    const snapshot = {
      frigate: { source: 'frigate', event_type: 'detection_start', state: { person: true }, timestamp: 123 },
      wled: { source: 'wled', event_type: 'state_change', state: { power: false }, timestamp: 456 },
    }
    useRoomStore.getState().setDevices(snapshot)
    expect(Object.keys(useRoomStore.getState().devices)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/frontend && npm test
```

Expected: FAIL

- [ ] **Step 3: Implémenter `apps/frontend/src/store/room.ts`**

```typescript
import { create } from 'zustand'

export interface FrontendDeviceState {
  source: string
  event_type: string
  state: Record<string, unknown>
  timestamp: number
}

interface RoomStore {
  devices: Record<string, FrontendDeviceState>
  connected: boolean
  setDevice: (source: string, state: FrontendDeviceState) => void
  setDevices: (devices: Record<string, FrontendDeviceState>) => void
  setConnected: (connected: boolean) => void
}

export const useRoomStore = create<RoomStore>((set) => ({
  devices: {},
  connected: false,

  setDevice: (source, state) =>
    set((prev) => ({ devices: { ...prev.devices, [source]: state } })),

  setDevices: (devices) => set({ devices }),

  setConnected: (connected) => set({ connected }),
}))
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/frontend && npm test
```

Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/store/
git commit -m "feat(frontend): Zustand room store"
```

---

## Task 19: WebSocket client

**Files:**
- Create: `apps/frontend/src/lib/ws.ts`
- Create: `apps/frontend/src/lib/ws.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `apps/frontend/src/lib/ws.test.ts` :

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

class MockWebSocket {
  static OPEN = 1
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((e: Event) => void) | null = null
  send = vi.fn()
  close = vi.fn()
}

vi.stubGlobal('WebSocket', MockWebSocket)

describe('createWsClient', () => {
  beforeEach(() => vi.clearAllMocks())

  it('appelle onSnapshot à la réception d\'un message snapshot', async () => {
    const { createWsClient } = await import('./ws')
    const onSnapshot = vi.fn()
    const onUpdate = vi.fn()

    const client = createWsClient({ url: 'ws://localhost:3001/ws', onSnapshot, onUpdate, onConnectionChange: vi.fn() })

    const ws = client.getSocket() as unknown as MockWebSocket
    ws.onmessage?.({ data: JSON.stringify({ type: 'snapshot', data: { wled: { source: 'wled', event_type: 'state_change', state: {}, timestamp: 123 } } }) })

    expect(onSnapshot).toHaveBeenCalledOnce()
    expect(onSnapshot.mock.calls[0][0]).toHaveProperty('wled')
  })

  it('appelle onUpdate à la réception d\'un message update', async () => {
    const { createWsClient } = await import('./ws')
    const onUpdate = vi.fn()

    const client = createWsClient({ url: 'ws://localhost:3001/ws', onSnapshot: vi.fn(), onUpdate, onConnectionChange: vi.fn() })

    const ws = client.getSocket() as unknown as MockWebSocket
    ws.onmessage?.({ data: JSON.stringify({ type: 'update', source: 'wled', state: { source: 'wled', event_type: 'state_change', state: { power: true }, timestamp: 456 } }) })

    expect(onUpdate).toHaveBeenCalledWith('wled', expect.objectContaining({ source: 'wled' }))
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/frontend && npm test
```

Expected: FAIL

- [ ] **Step 3: Implémenter `apps/frontend/src/lib/ws.ts`**

```typescript
import type { FrontendDeviceState } from '@/store/room'

interface WsClientOptions {
  url: string
  onSnapshot: (devices: Record<string, FrontendDeviceState>) => void
  onUpdate: (source: string, state: FrontendDeviceState) => void
  onConnectionChange: (connected: boolean) => void
}

interface WsClient {
  disconnect(): void
  getSocket(): WebSocket
}

export function createWsClient(options: WsClientOptions): WsClient {
  let ws: WebSocket
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 1000

  function connect() {
    ws = new WebSocket(options.url)

    ws.onopen = () => {
      reconnectDelay = 1000
      options.onConnectionChange(true)
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.type === 'snapshot') {
          options.onSnapshot(msg.data as Record<string, FrontendDeviceState>)
        } else if (msg.type === 'update') {
          options.onUpdate(msg.source as string, msg.state as FrontendDeviceState)
        }
      } catch {
        console.error('[WS] Failed to parse message')
      }
    }

    ws.onclose = () => {
      options.onConnectionChange(false)
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000)
        connect()
      }, reconnectDelay)
    }

    ws.onerror = () => {
      ws.close()
    }
  }

  connect()

  return {
    disconnect() {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws.close()
    },
    getSocket() {
      return ws
    },
  }
}
```

- [ ] **Step 4: Lancer le test**

```bash
cd apps/frontend && npm test
```

Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/ws.ts apps/frontend/src/lib/ws.test.ts
git commit -m "feat(frontend): WebSocket client with exponential backoff reconnection"
```

---

## Task 20: Composants device cards

**Files:**
- Create: `apps/frontend/src/components/StatusIndicator.tsx`
- Create: `apps/frontend/src/components/DeviceCard.tsx`
- Create: `apps/frontend/src/components/devices/FrigateCard.tsx`
- Create: `apps/frontend/src/components/devices/WledCard.tsx`
- Create: `apps/frontend/src/components/devices/TasmotaCard.tsx`

- [ ] **Step 1: Créer `apps/frontend/src/components/StatusIndicator.tsx`**

```tsx
'use client'

interface StatusIndicatorProps {
  connected: boolean
}

export function StatusIndicator({ connected }: StatusIndicatorProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400 animate-pulse'}`}
      />
      <span className={connected ? 'text-green-600' : 'text-gray-500'}>
        {connected ? 'Connected' : 'Reconnecting...'}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Créer `apps/frontend/src/components/DeviceCard.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { FrontendDeviceState } from '@/store/room'

interface DeviceCardProps {
  title: string
  state: FrontendDeviceState | undefined
  children?: React.ReactNode
}

export function DeviceCard({ title, state, children }: DeviceCardProps) {
  const isActive = !!state
  const lastSeen = state ? new Date(state.timestamp).toLocaleTimeString('fr-FR') : null

  return (
    <Card className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-50'}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          {title}
          <span className="text-xs text-muted-foreground font-normal">
            {lastSeen ? `Mis à jour ${lastSeen}` : 'En attente...'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isActive ? children : (
          <p className="text-sm text-muted-foreground">Aucune donnée reçue</p>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Créer `apps/frontend/src/components/devices/FrigateCard.tsx`**

```tsx
import { User, Camera } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DeviceCard } from '@/components/DeviceCard'
import type { FrontendDeviceState } from '@/store/room'

interface FrigateCardProps {
  state: FrontendDeviceState | undefined
}

export function FrigateCard({ state }: FrigateCardProps) {
  const s = state?.state as { object?: string; zone?: string; confidence?: number; camera?: string; active?: boolean } | undefined

  return (
    <DeviceCard title="Frigate" state={state}>
      {s && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <User className={`h-5 w-5 ${s.active ? 'text-blue-500' : 'text-gray-400'}`} />
            <span className="font-medium">
              {s.active ? `${s.object ?? 'Objet'} détecté` : 'Aucune détection'}
            </span>
          </div>
          {s.zone && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Camera className="h-4 w-4" />
              <span>{s.camera} — {s.zone}</span>
            </div>
          )}
          {s.confidence !== undefined && (
            <Badge variant={s.active ? 'default' : 'secondary'}>
              Confiance : {Math.round(s.confidence * 100)}%
            </Badge>
          )}
        </div>
      )}
    </DeviceCard>
  )
}
```

- [ ] **Step 4: Créer `apps/frontend/src/components/devices/WledCard.tsx`**

```tsx
import { Lightbulb } from 'lucide-react'
import { DeviceCard } from '@/components/DeviceCard'
import type { FrontendDeviceState } from '@/store/room'

interface WledCardProps {
  state: FrontendDeviceState | undefined
}

export function WledCard({ state }: WledCardProps) {
  const s = state?.state as { power?: boolean; brightness?: number; color?: string; effect_id?: number } | undefined

  return (
    <DeviceCard title="WLED" state={state}>
      {s && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className={`h-5 w-5 ${s.power ? 'text-yellow-500' : 'text-gray-400'}`} />
            <span className="font-medium">{s.power ? 'Allumé' : 'Éteint'}</span>
          </div>
          {s.power && (
            <>
              <div className="flex items-center gap-3">
                <div
                  className="h-6 w-6 rounded-full border border-border flex-shrink-0"
                  style={{ backgroundColor: s.color ?? '#ffffff' }}
                />
                <span className="text-sm text-muted-foreground">{s.color}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div
                    className="bg-yellow-400 h-2 rounded-full"
                    style={{ width: `${s.brightness ?? 0}%` }}
                  />
                </div>
                <span className="text-muted-foreground w-10 text-right">{s.brightness}%</span>
              </div>
            </>
          )}
        </div>
      )}
    </DeviceCard>
  )
}
```

- [ ] **Step 5: Créer `apps/frontend/src/components/devices/TasmotaCard.tsx`**

```tsx
import { Plug, Zap, Thermometer } from 'lucide-react'
import { DeviceCard } from '@/components/DeviceCard'
import type { FrontendDeviceState } from '@/store/room'

interface TasmotaCardProps {
  state: FrontendDeviceState | undefined
  label?: string
}

export function TasmotaCard({ state, label = 'Tasmota' }: TasmotaCardProps) {
  const s = state?.state as {
    power?: boolean
    watt?: number
    voltage?: number
    kwh_today?: number
    temperature?: number
    humidity?: number
    device_id?: string
  } | undefined

  return (
    <DeviceCard title={label} state={state}>
      {s && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Plug className={`h-5 w-5 ${s.power ? 'text-green-500' : 'text-gray-400'}`} />
            <span className="font-medium">{s.power ? 'Allumé' : 'Éteint'}</span>
          </div>
          {s.watt !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span>{s.watt} W</span>
              {s.kwh_today !== undefined && (
                <span className="text-muted-foreground">— {s.kwh_today} kWh aujourd'hui</span>
              )}
            </div>
          )}
          {s.temperature !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <Thermometer className="h-4 w-4 text-blue-500" />
              <span>{s.temperature}°C</span>
              {s.humidity !== undefined && <span className="text-muted-foreground">· {s.humidity}%</span>}
            </div>
          )}
        </div>
      )}
    </DeviceCard>
  )
}
```

- [ ] **Step 6: Vérifier la compilation TypeScript**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/
git commit -m "feat(frontend): device card components (Frigate, WLED, Tasmota)"
```

---

## Task 21: Dashboard page

**Files:**
- Create: `apps/frontend/src/app/page.tsx`
- Modify: `apps/frontend/src/app/layout.tsx`

- [ ] **Step 1: Modifier `apps/frontend/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Signal Room',
  description: 'Dashboard de monitoring chambre connectée',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Créer `apps/frontend/src/app/providers.tsx`**

```tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
```

- [ ] **Step 3: Créer `apps/frontend/src/app/page.tsx`**

```tsx
'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusIndicator } from '@/components/StatusIndicator'
import { FrigateCard } from '@/components/devices/FrigateCard'
import { WledCard } from '@/components/devices/WledCard'
import { TasmotaCard } from '@/components/devices/TasmotaCard'
import { useRoomStore } from '@/store/room'
import { createWsClient } from '@/lib/ws'

const WS_URL = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? 'ws://localhost:3001/ws'

export default function DashboardPage() {
  const { devices, connected, setDevice, setDevices, setConnected } = useRoomStore()

  useEffect(() => {
    const client = createWsClient({
      url: WS_URL,
      onSnapshot: setDevices,
      onUpdate: setDevice,
      onConnectionChange: setConnected,
    })
    return () => client.disconnect()
  }, [setDevice, setDevices, setConnected])

  const tasmotaSources = Object.values(devices).filter(d => d.source === 'tasmota')

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
            <Link href="/history">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <FrigateCard state={devices.frigate} />
        <WledCard state={devices.wled} />
        {tasmotaSources.length > 0 ? (
          tasmotaSources.map((d) => (
            <TasmotaCard
              key={d.state.device_id as string}
              state={d}
              label={`Tasmota — ${d.state.device_id}`}
            />
          ))
        ) : (
          <TasmotaCard state={devices.tasmota} />
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Ajouter la variable d'environnement frontend dans `.env.example`**

Ajouter à la fin de `.env.example` :
```env
# Frontend
NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:3001/ws
NEXT_PUBLIC_BACKEND_API_URL=http://localhost:3001
```

- [ ] **Step 5: Vérifier la compilation**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/ .env.example
git commit -m "feat(frontend): dashboard page with live device state"
```

---

## Task 22: API helper & page historique

**Files:**
- Create: `apps/frontend/src/lib/api.ts`
- Create: `apps/frontend/src/components/history/Filters.tsx`
- Create: `apps/frontend/src/components/history/Timeline.tsx`
- Create: `apps/frontend/src/app/history/page.tsx`

- [ ] **Step 1: Créer `apps/frontend/src/lib/api.ts`**

```typescript
const API_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL ?? 'http://localhost:3001'

export interface StoredEvent {
  id: number
  source: string
  topic: string
  event_type: string
  payload: string
  raw: string
  created_at: number
}

export interface EventsResponse {
  data: StoredEvent[]
  total: number
}

export async function fetchEvents(params: {
  source?: string
  event_type?: string
  from?: number
  to?: number
  page: number
  limit: number
}): Promise<EventsResponse> {
  const url = new URL(`${API_URL}/api/events`)
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined) url.searchParams.set(key, String(val))
  })

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json() as Promise<EventsResponse>
}
```

- [ ] **Step 2: Créer `apps/frontend/src/components/history/Filters.tsx`**

```tsx
'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

interface FiltersProps {
  source: string
  onSourceChange: (value: string) => void
  onReset: () => void
}

const SOURCES = ['frigate', 'wled', 'tasmota']

export function Filters({ source, onSourceChange, onReset }: FiltersProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Select value={source} onValueChange={onSourceChange}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les sources</SelectItem>
          {SOURCES.map((s) => (
            <SelectItem key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {source !== 'all' && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <X className="h-4 w-4 mr-1" />
          Réinitialiser
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Créer `apps/frontend/src/components/history/Timeline.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'
import type { StoredEvent } from '@/lib/api'

interface TimelineProps {
  events: StoredEvent[]
}

const SOURCE_COLORS: Record<string, string> = {
  frigate: 'bg-blue-100 text-blue-800',
  wled: 'bg-yellow-100 text-yellow-800',
  tasmota: 'bg-green-100 text-green-800',
}

const EVENT_LABELS: Record<string, string> = {
  detection_start: 'Début de détection',
  detection_end: 'Fin de détection',
  state_change: 'Changement d\'état',
  sensor_update: 'Mise à jour capteur',
  power_update: 'Mise à jour énergie',
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (days > 0) return `il y a ${days}j`
  if (hours > 0) return `il y a ${hours}h`
  if (minutes > 0) return `il y a ${minutes}min`
  return 'à l\'instant'
}

export function Timeline({ events }: TimelineProps) {
  if (events.length === 0) {
    return <p className="text-muted-foreground text-sm py-8 text-center">Aucun événement</p>
  }

  return (
    <div className="space-y-2">
      {events.map((event) => {
        const colorClass = SOURCE_COLORS[event.source] ?? 'bg-gray-100 text-gray-800'
        const label = EVENT_LABELS[event.event_type] ?? event.event_type
        const absoluteTime = new Date(event.created_at).toLocaleString('fr-FR')

        return (
          <div
            key={event.id}
            className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
          >
            <Badge className={`${colorClass} border-0 flex-shrink-0 mt-0.5`}>
              {event.source}
            </Badge>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {JSON.stringify(JSON.parse(event.payload))}
              </p>
            </div>
            <time
              className="text-xs text-muted-foreground flex-shrink-0"
              title={absoluteTime}
            >
              {relativeTime(event.created_at)}
            </time>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Créer `apps/frontend/src/app/history/page.tsx`**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Filters } from '@/components/history/Filters'
import { Timeline } from '@/components/history/Timeline'
import { fetchEvents } from '@/lib/api'

const PAGE_SIZE = 50

export default function HistoryPage() {
  const [source, setSource] = useState('all')
  const [page, setPage] = useState(1)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['events', source, page],
    queryFn: () =>
      fetchEvents({
        source: source !== 'all' ? source : undefined,
        page,
        limit: PAGE_SIZE,
      }),
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  function handleSourceChange(value: string) {
    setSource(value)
    setPage(1)
  }

  return (
    <main className="min-h-screen bg-background p-6 max-w-3xl mx-auto">
      <header className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Dashboard
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">Historique</h1>
          {data && (
            <p className="text-sm text-muted-foreground">{data.total} événements</p>
          )}
        </div>
      </header>

      <div className="mb-4">
        <Filters
          source={source}
          onSourceChange={handleSourceChange}
          onReset={() => handleSourceChange('all')}
        />
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Chargement...</p>}
      {isError && <p className="text-destructive text-sm">Erreur de chargement</p>}
      {data && <Timeline events={data.data} />}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 5: Vérifier la compilation**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/lib/api.ts apps/frontend/src/components/history/ apps/frontend/src/app/history/
git commit -m "feat(frontend): history page with timeline and filters"
```

---

## Task 23: Docker

**Files:**
- Create: `apps/backend/Dockerfile`
- Create: `apps/frontend/Dockerfile`
- Create: `docker-compose.yml`
- Create: `docker-compose.dev.yml`

- [ ] **Step 1: Créer `apps/backend/Dockerfile`**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package.json ./
RUN npm install --omit=dev
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Créer `apps/frontend/Dockerfile`**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: Créer `docker-compose.yml`**

```yaml
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data

  backend:
    build: ./apps/backend
    restart: unless-stopped
    env_file: .env
    depends_on:
      - redis
    ports:
      - "3001:3001"
    volumes:
      - ./data:/data

  frontend:
    build: ./apps/frontend
    restart: unless-stopped
    env_file: .env
    depends_on:
      - backend
    ports:
      - "3000:3000"

volumes:
  redis_data:
```

- [ ] **Step 4: Créer `docker-compose.dev.yml`**

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

- [ ] **Step 5: Créer le dossier de données SQLite**

```bash
mkdir -p data && echo "signal-room.db" >> data/.gitignore
```

- [ ] **Step 6: Vérifier le build Docker du backend**

```bash
docker build -t signal-room-backend ./apps/backend
```

Expected: Successfully built

- [ ] **Step 7: Commit**

```bash
git add apps/backend/Dockerfile apps/frontend/Dockerfile docker-compose.yml docker-compose.dev.yml data/
git commit -m "feat: Docker configuration for backend, frontend and Redis"
```

---

## Récapitulatif des commandes de vérification

```bash
# Tests backend complets
cd apps/backend && npm test

# Tests frontend complets
cd apps/frontend && npm test

# TypeScript check backend
cd apps/backend && npx tsc --noEmit

# TypeScript check frontend
cd apps/frontend && npx tsc --noEmit

# Dev local (3 terminaux)
docker run -p 6379:6379 redis:7-alpine
cd apps/backend && npm run dev
cd apps/frontend && npm run dev

# Production Docker
cp .env.example .env  # renseigner les valeurs
docker compose up --build
```
