# Custom Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'utilisateur de modifier les champs d'un unit (output_field, label, topic, transform) et de sauvegarder/éditer/supprimer des presets personnalisés réutilisables, sans casser les presets built-in ni le flux existant.

**Architecture:** Une nouvelle table SQLite `custom_presets` stocke les presets utilisateur. L'endpoint `GET /api/presets` est étendu pour retourner built-in + custom dans une même liste taguée par `source`. Trois nouveaux endpoints CRUD (`POST/PATCH/DELETE /api/presets/custom`) gèrent la persistance. Côté frontend, l'étape "units" du formulaire devices reçoit un éditeur structuré par unit (composant `UnitEditor` avec un sous-composant `TransformEditor`), et un bouton "Sauvegarder comme preset" ouvre une modale (`SavePresetModal`). Les presets custom apparaissent dans la liste à côté des built-in, avec icônes crayon/poubelle.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, vitest (backend) / Next.js 16, React 19, Tailwind, lucide-react, vitest + @testing-library/react (frontend).

**Pré-requis :**
- Branche courante : `feat/custom-presets` (déjà créée, contient le commit `957142cb docs: add custom presets design spec`)
- **Avant de commencer, rebase `feat/custom-presets` sur `Main`** pour intégrer les 3 commits de fix (`refactor(backend): remove MQTT authentication...`, `fix(frontend): surface backend errors...`, `test(frontend): strengthen typing...`). Sans ce rebase, le plan suppose un état antérieur de `page.tsx` et `registry-api.ts` :
  ```bash
  cd /Volumes/JulesB/projet/saas/signal-room
  git switch feat/custom-presets
  git rebase Main
  ```
- Repo root : `/Volumes/JulesB/projet/saas/signal-room/`
- Toutes les commandes shell sont à exécuter depuis le repo root sauf indication contraire.
- Les commandes de test : `cd apps/backend && npm test` pour le backend, `cd apps/frontend && npm test` pour le frontend.

---

## File Structure

### Fichiers créés

| Path | Responsabilité |
|------|---------------|
| `apps/backend/src/db/custom-presets.ts` | CRUD SQL des presets custom (insert, list, update, delete, getById) |
| `apps/backend/src/db/custom-presets.test.ts` | Tests des queries CRUD |
| `apps/backend/src/api/custom-presets-routes.ts` | Endpoints REST POST/PATCH/DELETE |
| `apps/backend/src/api/custom-presets-routes.test.ts` | Tests d'intégration des routes |
| `apps/frontend/src/components/devices/TransformEditor.tsx` | Éditeur structuré pour le `transform` d'un unit |
| `apps/frontend/src/components/devices/TransformEditor.test.tsx` | Tests du TransformEditor |
| `apps/frontend/src/components/devices/UnitEditor.tsx` | Accordion expand/collapse pour éditer un unit |
| `apps/frontend/src/components/devices/UnitEditor.test.tsx` | Tests du UnitEditor |
| `apps/frontend/src/components/devices/SavePresetModal.tsx` | Modale "Sauvegarder comme preset" |
| `apps/frontend/src/components/devices/SavePresetModal.test.tsx` | Tests de la modale |

### Fichiers modifiés

| Path | Modification |
|------|-------------|
| `apps/backend/src/db/schema.ts` | Ajout de la table `custom_presets` dans `applySchema()` |
| `apps/backend/src/api/presets-routes.ts` | Étend `GET /api/presets` pour fusionner built-in + custom avec tag `source` |
| `apps/backend/src/index.ts` | Registre la nouvelle route `registerCustomPresetsRoutes()` |
| `apps/frontend/src/lib/registry-api.ts` | Type `CustomPreset` + fonctions `createCustomPreset`, `updateCustomPreset`, `deleteCustomPreset`, et mise à jour de `Preset`/`fetchPresets` pour gérer `source` |
| `apps/frontend/src/app/devices/page.tsx` | Utilise `UnitEditor` à l'étape "units", ajoute bouton "Sauvegarder comme preset", gère édition/suppression presets custom à l'étape "preset" |

---

## Task 1: Backend — Schéma DB pour `custom_presets`

**Files:**
- Modify: `apps/backend/src/db/schema.ts`

- [ ] **Step 1.1: Lire le fichier actuel**

Lire `apps/backend/src/db/schema.ts` pour repérer l'endroit où ajouter la nouvelle table dans `applySchema()`, juste après le bloc `device_units`.

- [ ] **Step 1.2: Ajouter la table `custom_presets`**

Dans `apps/backend/src/db/schema.ts`, insérer ce bloc SQL à la fin du `db.exec(\`...\`)` (avant la fermeture du backtick), après le `CREATE INDEX idx_units_device` :

```ts
    CREATE TABLE IF NOT EXISTS custom_presets (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      debounce_ms INTEGER,
      layout_json TEXT,
      units_json  TEXT    NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_custom_presets_created_at ON custom_presets (created_at);
```

- [ ] **Step 1.3: Vérifier la compilation**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 1.4: Commit**

```bash
cd /Volumes/JulesB/projet/saas/signal-room
git add apps/backend/src/db/schema.ts
git commit -m "feat(backend): add custom_presets table to schema"
```

---

## Task 2: Backend — Type `CustomPreset` et queries CRUD

**Files:**
- Create: `apps/backend/src/db/custom-presets.ts`
- Create: `apps/backend/src/db/custom-presets.test.ts`

- [ ] **Step 2.1: Écrire le test (TDD red phase)**

Créer `apps/backend/src/db/custom-presets.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { applySchema } from './schema'
import {
  insertCustomPreset, listCustomPresets, getCustomPresetById,
  updateCustomPreset, deleteCustomPreset,
} from './custom-presets'
import type { UnitInput } from '../interpreters/types'

function freshDb(): Database.Database {
  const db = new BetterSqlite3(':memory:')
  applySchema(db)
  return db
}

const sampleUnits: UnitInput[] = [
  {
    position: 0,
    name: 'Power',
    topic_pattern: 'wled/lamp/v',
    json_path: 'on',
    condition: null,
    transform: { type: 'passthrough' },
    output_field: 'power',
    output_type: 'boolean',
    display: { label: 'Allumé' },
  },
]

describe('insertCustomPreset + listCustomPresets', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('insère un preset et le récupère par listCustomPresets', () => {
    const id = insertCustomPreset(db, {
      name: 'WLED ajusté',
      description: 'WLED avec bri scalé',
      debounce_ms: null,
      layout: null,
      units: sampleUnits,
    })
    expect(id).toMatch(/^custom_/)
    const list = listCustomPresets(db)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].name).toBe('WLED ajusté')
    expect(list[0].description).toBe('WLED avec bri scalé')
    expect(list[0].units).toEqual(sampleUnits)
    expect(list[0].created_at).toBeGreaterThan(0)
    expect(list[0].updated_at).toBeGreaterThan(0)
  })

  it('liste vide quand aucun preset', () => {
    expect(listCustomPresets(db)).toEqual([])
  })

  it('description par défaut est une chaîne vide', () => {
    const id = insertCustomPreset(db, {
      name: 'Sans description',
      description: '',
      debounce_ms: null,
      layout: null,
      units: sampleUnits,
    })
    const p = getCustomPresetById(db, id)
    expect(p?.description).toBe('')
  })
})

describe('getCustomPresetById', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('retourne le preset existant', () => {
    const id = insertCustomPreset(db, {
      name: 'P',
      description: '',
      debounce_ms: 100,
      layout: { groups: [{ title: 'G', fields: ['power'] }] },
      units: sampleUnits,
    })
    const p = getCustomPresetById(db, id)
    expect(p?.id).toBe(id)
    expect(p?.debounce_ms).toBe(100)
    expect(p?.layout).toEqual({ groups: [{ title: 'G', fields: ['power'] }] })
  })

  it('retourne null si introuvable', () => {
    expect(getCustomPresetById(db, 'custom_inexistant')).toBeNull()
  })
})

describe('updateCustomPreset', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('met à jour nom, description et units', () => {
    const id = insertCustomPreset(db, {
      name: 'V1',
      description: 'old',
      debounce_ms: null,
      layout: null,
      units: sampleUnits,
    })
    const before = getCustomPresetById(db, id)!.updated_at
    const newUnits: UnitInput[] = [{
      ...sampleUnits[0],
      output_field: 'state',
      transform: { type: 'enum_map', map: { true: 'on' } },
    }]
    const ok = updateCustomPreset(db, id, {
      name: 'V2',
      description: 'new',
      units: newUnits,
    })
    expect(ok).toBe(true)
    const after = getCustomPresetById(db, id)!
    expect(after.name).toBe('V2')
    expect(after.description).toBe('new')
    expect(after.units[0].output_field).toBe('state')
    expect(after.updated_at).toBeGreaterThanOrEqual(before)
  })

  it('retourne false si id inconnu', () => {
    const ok = updateCustomPreset(db, 'custom_inconnu', {
      name: 'X',
      description: '',
      units: sampleUnits,
    })
    expect(ok).toBe(false)
  })
})

describe('deleteCustomPreset', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('supprime et retourne true', () => {
    const id = insertCustomPreset(db, {
      name: 'X',
      description: '',
      debounce_ms: null,
      layout: null,
      units: sampleUnits,
    })
    expect(deleteCustomPreset(db, id)).toBe(true)
    expect(getCustomPresetById(db, id)).toBeNull()
  })

  it('retourne false si introuvable', () => {
    expect(deleteCustomPreset(db, 'custom_nope')).toBe(false)
  })
})
```

- [ ] **Step 2.2: Lancer les tests pour confirmer l'échec**

Run: `cd apps/backend && npx vitest run src/db/custom-presets.test.ts`
Expected: échec avec `Cannot find module './custom-presets'`.

- [ ] **Step 2.3: Implémenter le module**

Créer `apps/backend/src/db/custom-presets.ts` :

```ts
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { UnitInput, LayoutDescriptor } from '../interpreters/types'

export interface CustomPreset {
  id: string
  name: string
  description: string
  debounce_ms: number | null
  layout: LayoutDescriptor | null
  units: UnitInput[]
  created_at: number
  updated_at: number
}

interface Row {
  id: string
  name: string
  description: string
  debounce_ms: number | null
  layout_json: string | null
  units_json: string
  created_at: number
  updated_at: number
}

function parse(row: Row): CustomPreset {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    debounce_ms: row.debounce_ms,
    layout: row.layout_json ? JSON.parse(row.layout_json) : null,
    units: JSON.parse(row.units_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function insertCustomPreset(
  db: Database.Database,
  payload: {
    name: string
    description: string
    debounce_ms: number | null
    layout: LayoutDescriptor | null
    units: UnitInput[]
  },
): string {
  const id = `custom_${randomUUID()}`
  const now = Date.now()
  db.prepare(`
    INSERT INTO custom_presets (id, name, description, debounce_ms, layout_json, units_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    payload.name,
    payload.description,
    payload.debounce_ms,
    payload.layout ? JSON.stringify(payload.layout) : null,
    JSON.stringify(payload.units),
    now,
    now,
  )
  return id
}

export function listCustomPresets(db: Database.Database): CustomPreset[] {
  const rows = db.prepare('SELECT * FROM custom_presets ORDER BY created_at ASC').all() as Row[]
  return rows.map(parse)
}

export function getCustomPresetById(db: Database.Database, id: string): CustomPreset | null {
  const row = db.prepare('SELECT * FROM custom_presets WHERE id = ?').get(id) as Row | undefined
  return row ? parse(row) : null
}

export function updateCustomPreset(
  db: Database.Database,
  id: string,
  patch: { name: string; description: string; units: UnitInput[] },
): boolean {
  const now = Date.now()
  const res = db.prepare(`
    UPDATE custom_presets
       SET name = ?, description = ?, units_json = ?, updated_at = ?
     WHERE id = ?
  `).run(patch.name, patch.description, JSON.stringify(patch.units), now, id)
  return res.changes > 0
}

export function deleteCustomPreset(db: Database.Database, id: string): boolean {
  const res = db.prepare('DELETE FROM custom_presets WHERE id = ?').run(id)
  return res.changes > 0
}
```

- [ ] **Step 2.4: Lancer les tests pour confirmer le succès**

Run: `cd apps/backend && npx vitest run src/db/custom-presets.test.ts`
Expected: tous les tests passent.

- [ ] **Step 2.5: Commit**

```bash
cd /Volumes/JulesB/projet/saas/signal-room
git add apps/backend/src/db/custom-presets.ts apps/backend/src/db/custom-presets.test.ts
git commit -m "feat(backend): add custom presets CRUD queries"
```

---

## Task 3: Backend — Routes REST pour custom presets

**Files:**
- Create: `apps/backend/src/api/custom-presets-routes.ts`
- Create: `apps/backend/src/api/custom-presets-routes.test.ts`
- Modify: `apps/backend/src/api/presets-routes.ts`
- Modify: `apps/backend/src/index.ts`

- [ ] **Step 3.1: Écrire les tests d'intégration (TDD red phase)**

Créer `apps/backend/src/api/custom-presets-routes.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { applySchema } from '../db/schema'
import { registerCustomPresetsRoutes } from './custom-presets-routes'
import { registerPresetsRoutes } from './presets-routes'

function build(): { app: FastifyInstance; db: Database.Database } {
  const db = new BetterSqlite3(':memory:')
  applySchema(db)
  const app = Fastify()
  registerPresetsRoutes(app, db)
  registerCustomPresetsRoutes(app, db)
  return { app, db }
}

const samplePayload = {
  name: 'WLED ajusté',
  description: 'WLED avec bri scalé',
  units: [{
    position: 0,
    name: 'Power',
    topic_pattern: 'wled/lamp/v',
    json_path: 'on',
    condition: null,
    transform: { type: 'passthrough' },
    output_field: 'power',
    output_type: 'boolean',
    display: { label: 'Allumé' },
  }],
}

describe('POST /api/presets/custom', () => {
  it('crée un preset et retourne 201 + id', async () => {
    const { app } = build()
    const res = await app.inject({
      method: 'POST',
      url: '/api/presets/custom',
      payload: samplePayload,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { id: string }
    expect(body.id).toMatch(/^custom_/)
  })

  it('retourne 400 si units invalides', async () => {
    const { app } = build()
    const res = await app.inject({
      method: 'POST',
      url: '/api/presets/custom',
      payload: { name: '', description: '', units: [] },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/presets (merged)', () => {
  it('retourne built-in tagués source=builtin', async () => {
    const { app } = build()
    const res = await app.inject({ method: 'GET', url: '/api/presets' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { presets: Array<{ source: 'builtin' | 'custom' }> }
    expect(body.presets.length).toBeGreaterThan(0)
    expect(body.presets.every(p => p.source === 'builtin')).toBe(true)
  })

  it('inclut les presets custom après les built-in', async () => {
    const { app } = build()
    await app.inject({ method: 'POST', url: '/api/presets/custom', payload: samplePayload })
    const res = await app.inject({ method: 'GET', url: '/api/presets' })
    const body = res.json() as { presets: Array<{ source: string; name: string }> }
    const sources = body.presets.map(p => p.source)
    expect(sources).toContain('custom')
    const custom = body.presets.find(p => p.source === 'custom')
    expect(custom?.name).toBe('WLED ajusté')
  })
})

describe('PATCH /api/presets/custom/:id', () => {
  it('met à jour un preset existant', async () => {
    const { app } = build()
    const created = await app.inject({
      method: 'POST', url: '/api/presets/custom', payload: samplePayload,
    })
    const { id } = created.json() as { id: string }
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/presets/custom/${id}`,
      payload: { ...samplePayload, name: 'WLED V2' },
    })
    expect(res.statusCode).toBe(200)
    const list = await app.inject({ method: 'GET', url: '/api/presets' })
    const body = list.json() as { presets: Array<{ id?: string; name: string }> }
    expect(body.presets.find(p => p.id === id)?.name).toBe('WLED V2')
  })

  it('retourne 404 si id inconnu', async () => {
    const { app } = build()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/presets/custom/custom_nope',
      payload: samplePayload,
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/presets/custom/:id', () => {
  it('supprime un preset existant', async () => {
    const { app } = build()
    const created = await app.inject({
      method: 'POST', url: '/api/presets/custom', payload: samplePayload,
    })
    const { id } = created.json() as { id: string }
    const res = await app.inject({ method: 'DELETE', url: `/api/presets/custom/${id}` })
    expect(res.statusCode).toBe(204)
    const list = await app.inject({ method: 'GET', url: '/api/presets' })
    const body = list.json() as { presets: Array<{ id?: string }> }
    expect(body.presets.find(p => p.id === id)).toBeUndefined()
  })

  it('retourne 404 si id inconnu', async () => {
    const { app } = build()
    const res = await app.inject({ method: 'DELETE', url: '/api/presets/custom/custom_nope' })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 3.2: Lancer les tests pour confirmer l'échec**

Run: `cd apps/backend && npx vitest run src/api/custom-presets-routes.test.ts`
Expected: échec — modules manquants.

- [ ] **Step 3.3: Implémenter `custom-presets-routes.ts`**

Créer `apps/backend/src/api/custom-presets-routes.ts` :

```ts
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import {
  insertCustomPreset, updateCustomPreset, deleteCustomPreset,
} from '../db/custom-presets'
import { validateDevicePayload } from '../interpreters/validate'

export function registerCustomPresetsRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
): void {
  fastify.post('/api/presets/custom', async (req, reply) => {
    const body = req.body as { name?: string; description?: string; units?: unknown }
    const res = validateDevicePayload({ name: body.name, units: body.units })
    if (!res.ok) return reply.status(400).send({ error: res.error })

    const id = insertCustomPreset(db, {
      name: res.value.name,
      description: typeof body.description === 'string' ? body.description : '',
      debounce_ms: res.value.debounce_ms ?? null,
      layout: res.value.layout ?? null,
      units: res.value.units,
    })
    return reply.status(201).send({ id })
  })

  fastify.patch('/api/presets/custom/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as { name?: string; description?: string; units?: unknown }
    const res = validateDevicePayload({ name: body.name, units: body.units })
    if (!res.ok) return reply.status(400).send({ error: res.error })

    const ok = updateCustomPreset(db, id, {
      name: res.value.name,
      description: typeof body.description === 'string' ? body.description : '',
      units: res.value.units,
    })
    if (!ok) return reply.status(404).send({ error: 'Preset introuvable' })
    return reply.send({ ok: true })
  })

  fastify.delete('/api/presets/custom/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const ok = deleteCustomPreset(db, id)
    if (!ok) return reply.status(404).send({ error: 'Preset introuvable' })
    return reply.status(204).send()
  })
}
```

- [ ] **Step 3.4: Étendre `GET /api/presets` pour fusionner built-in + custom**

Remplacer le contenu de `apps/backend/src/api/presets-routes.ts` par :

```ts
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { PRESETS } from '../interpreters/presets'
import { listCustomPresets } from '../db/custom-presets'

export function registerPresetsRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
): void {
  fastify.get('/api/presets', async (_req, reply) => {
    const builtin = PRESETS.map(p => ({ ...p, source: 'builtin' as const }))
    const custom = listCustomPresets(db).map(p => ({
      key: p.id,
      id: p.id,
      name: p.name,
      description: p.description,
      debounce_ms: p.debounce_ms,
      layout: p.layout,
      placeholders: [] as string[],
      units: p.units,
      source: 'custom' as const,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }))
    return reply.send({ presets: [...builtin, ...custom] })
  })
}
```

- [ ] **Step 3.5: Mettre à jour l'enregistrement des routes dans `index.ts`**

Dans `apps/backend/src/index.ts`, trouver la ligne `registerPresetsRoutes(fastify)` et :
1. La remplacer par `registerPresetsRoutes(fastify, db)`.
2. Importer `registerCustomPresetsRoutes` et l'enregistrer juste en dessous.

Lire d'abord `apps/backend/src/index.ts` pour repérer les imports et l'appel actuel, puis appliquer ces deux edits :

Edit 1 — import (en haut du fichier, à côté de l'import existant `registerPresetsRoutes`) :
```ts
import { registerCustomPresetsRoutes } from './api/custom-presets-routes'
```

Edit 2 — call site (là où `registerPresetsRoutes(fastify)` est appelé) :
```ts
registerPresetsRoutes(fastify, db)
registerCustomPresetsRoutes(fastify, db)
```

- [ ] **Step 3.6: Lancer la suite backend complète**

Run: `cd apps/backend && npm test`
Expected: tous les tests passent, y compris les nouveaux et les existants.

- [ ] **Step 3.7: Commit**

```bash
cd /Volumes/JulesB/projet/saas/signal-room
git add apps/backend/src/api/custom-presets-routes.ts \
        apps/backend/src/api/custom-presets-routes.test.ts \
        apps/backend/src/api/presets-routes.ts \
        apps/backend/src/index.ts
git commit -m "feat(backend): add custom presets REST endpoints and merge into GET /api/presets"
```

---

## Task 4: Frontend — Client API pour les presets custom

**Files:**
- Modify: `apps/frontend/src/lib/registry-api.ts`

- [ ] **Step 4.1: Étendre le type `Preset` et ajouter les fonctions CRUD**

Lire `apps/frontend/src/lib/registry-api.ts` puis :

1. Ajouter le champ `source` et `id?` à l'interface `Preset` (juste après le bloc actuel `export interface Preset { ... }`).
2. Ajouter les fonctions CRUD à la fin du fichier (avant `applyPresetClient`).

Remplacer l'interface `Preset` existante par :

```ts
export interface Preset {
  key: string
  id?: string
  name: string
  description: string
  debounce_ms: number | null
  placeholders: string[]
  units: UnitInput[]
  source: 'builtin' | 'custom'
}
```

Ajouter avant la fonction `applyPresetClient` :

```ts
export interface CustomPresetPayload {
  name: string
  description: string
  units: UnitInput[]
}

export async function createCustomPreset(payload: CustomPresetPayload): Promise<string> {
  const res = await fetch(`${API_URL}/api/presets/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  const data = await res.json() as { id: string }
  return data.id
}

export async function updateCustomPreset(id: string, payload: CustomPresetPayload): Promise<void> {
  const res = await fetch(`${API_URL}/api/presets/custom/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  }
}

export async function deleteCustomPreset(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/presets/custom/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}
```

- [ ] **Step 4.2: Vérifier la compilation TypeScript**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: la compilation peut signaler des erreurs dans `page.tsx` car `Preset` n'a plus `source` partout. C'est attendu — `page.tsx` sera mis à jour aux tâches suivantes. Si une erreur autre que sur `page.tsx` apparaît, la corriger maintenant.

- [ ] **Step 4.3: Commit**

```bash
cd /Volumes/JulesB/projet/saas/signal-room
git add apps/frontend/src/lib/registry-api.ts
git commit -m "feat(frontend): add custom preset CRUD client and source tag on Preset"
```

---

## Task 5: Frontend — Composant `TransformEditor`

**Files:**
- Create: `apps/frontend/src/components/devices/TransformEditor.tsx`
- Create: `apps/frontend/src/components/devices/TransformEditor.test.tsx`

- [ ] **Step 5.1: Écrire les tests (TDD red phase)**

Créer `apps/frontend/src/components/devices/TransformEditor.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransformEditor } from './TransformEditor'

describe('TransformEditor', () => {
  it('affiche le type courant dans le select', () => {
    render(<TransformEditor value={{ type: 'passthrough' }} onChange={vi.fn()} />)
    expect(screen.getByLabelText(/type/i)).toHaveValue('passthrough')
  })

  it('change de type vers scale via le select et émet la valeur par défaut', async () => {
    const onChange = vi.fn()
    render(<TransformEditor value={{ type: 'passthrough' }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText(/type/i), 'scale')
    expect(onChange).toHaveBeenCalledWith({
      type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100, round: false,
    })
  })

  it('affiche les champs de scale et émet la mise à jour', async () => {
    const onChange = vi.fn()
    render(<TransformEditor
      value={{ type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100, round: true }}
      onChange={onChange}
    />)
    const inMax = screen.getByLabelText(/in_max/i)
    await userEvent.clear(inMax)
    await userEvent.type(inMax, '1023')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'scale', in_max: 1023,
    }))
  })

  it('affiche le champ decimals pour round', () => {
    render(<TransformEditor value={{ type: 'round', decimals: 2 }} onChange={vi.fn()} />)
    expect(screen.getByLabelText(/decimals/i)).toHaveValue(2)
  })

  it('gère enum_map avec ajout/suppression de paires', async () => {
    const onChange = vi.fn()
    render(<TransformEditor
      value={{ type: 'enum_map', map: { ON: true, OFF: false } }}
      onChange={onChange}
    />)
    await userEvent.click(screen.getByRole('button', { name: /ajouter une paire/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      type: 'enum_map',
      map: expect.objectContaining({ ON: true, OFF: false }),
    }))
  })

  it('ne rend aucun champ pour passthrough', () => {
    render(<TransformEditor value={{ type: 'passthrough' }} onChange={vi.fn()} />)
    expect(screen.queryByLabelText(/in_min/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/decimals/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 5.2: Lancer les tests — échec attendu**

Run: `cd apps/frontend && npx vitest run src/components/devices/TransformEditor.test.tsx`
Expected: module introuvable.

- [ ] **Step 5.3: Implémenter le composant**

Créer `apps/frontend/src/components/devices/TransformEditor.tsx` :

```tsx
'use client'

import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type TransformType =
  | 'passthrough' | 'enum_map' | 'scale' | 'round'
  | 'rgb_to_hex' | 'array_first' | 'array_contains'

export type Transform =
  | { type: 'passthrough' }
  | { type: 'enum_map'; map: Record<string, unknown>; default?: unknown }
  | { type: 'scale'; in_min: number; in_max: number; out_min: number; out_max: number; round?: boolean }
  | { type: 'round'; decimals: number }
  | { type: 'rgb_to_hex' }
  | { type: 'array_first' }
  | { type: 'array_contains'; value: string | number }

interface Props {
  value: Transform
  onChange: (t: Transform) => void
}

const TYPES: TransformType[] = [
  'passthrough', 'scale', 'round', 'enum_map',
  'rgb_to_hex', 'array_first', 'array_contains',
]

function defaultFor(type: TransformType): Transform {
  switch (type) {
    case 'passthrough': return { type: 'passthrough' }
    case 'scale': return { type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100, round: false }
    case 'round': return { type: 'round', decimals: 2 }
    case 'enum_map': return { type: 'enum_map', map: {} }
    case 'rgb_to_hex': return { type: 'rgb_to_hex' }
    case 'array_first': return { type: 'array_first' }
    case 'array_contains': return { type: 'array_contains', value: '' }
  }
}

export function TransformEditor({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="transform-type">
          type
        </label>
        <select
          id="transform-type"
          className="w-full border rounded px-2 py-1 text-xs bg-background"
          value={value.type}
          onChange={e => onChange(defaultFor(e.target.value as TransformType))}
        >
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {value.type === 'scale' && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="in_min" value={value.in_min}
            onChange={v => onChange({ ...value, in_min: v })} />
          <NumberField label="in_max" value={value.in_max}
            onChange={v => onChange({ ...value, in_max: v })} />
          <NumberField label="out_min" value={value.out_min}
            onChange={v => onChange({ ...value, out_min: v })} />
          <NumberField label="out_max" value={value.out_max}
            onChange={v => onChange({ ...value, out_max: v })} />
          <label className="flex items-center gap-2 text-xs col-span-2">
            <input
              type="checkbox"
              checked={value.round ?? false}
              onChange={e => onChange({ ...value, round: e.target.checked })}
            />
            round (arrondir le résultat)
          </label>
        </div>
      )}

      {value.type === 'round' && (
        <NumberField label="decimals" value={value.decimals}
          onChange={v => onChange({ ...value, decimals: v })} />
      )}

      {value.type === 'enum_map' && (
        <EnumMapEditor
          map={value.map}
          defaultValue={value.default}
          onChange={(map, def) => onChange({ ...value, map, default: def })}
        />
      )}

      {value.type === 'array_contains' && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="contains-value">
            value
          </label>
          <input
            id="contains-value"
            className="w-full border rounded px-2 py-1 text-xs bg-background"
            value={String(value.value)}
            onChange={e => onChange({ ...value, value: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}

function NumberField({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  const id = `nf-${label}`
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        className="w-full border rounded px-2 py-1 text-xs bg-background"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function EnumMapEditor({
  map, defaultValue, onChange,
}: {
  map: Record<string, unknown>
  defaultValue: unknown
  onChange: (map: Record<string, unknown>, def: unknown) => void
}) {
  const entries = Object.entries(map)
  function updateKey(oldKey: string, newKey: string) {
    if (newKey === oldKey || newKey === '') return
    const next: Record<string, unknown> = {}
    for (const [k, v] of entries) next[k === oldKey ? newKey : k] = v
    onChange(next, defaultValue)
  }
  function updateValue(key: string, newVal: string) {
    onChange({ ...map, [key]: newVal }, defaultValue)
  }
  function removeEntry(key: string) {
    const next = { ...map }
    delete next[key]
    onChange(next, defaultValue)
  }
  function addEntry() {
    const base = 'new_key'
    let key = base
    let i = 1
    while (key in map) { key = `${base}_${i++}` }
    onChange({ ...map, [key]: '' }, defaultValue)
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">map (clé → valeur)</p>
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1 items-center">
          <input
            aria-label={`key-${k}`}
            className="flex-1 border rounded px-2 py-1 text-xs bg-background"
            defaultValue={k}
            onBlur={e => updateKey(k, e.target.value)}
          />
          <span className="text-xs">→</span>
          <input
            aria-label={`value-${k}`}
            className="flex-1 border rounded px-2 py-1 text-xs bg-background"
            value={String(v)}
            onChange={e => updateValue(k, e.target.value)}
          />
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            onClick={() => removeEntry(k)} aria-label={`Supprimer paire ${k}`}
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addEntry}>
        Ajouter une paire
      </Button>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="enum-default">
          default (optionnel)
        </label>
        <input
          id="enum-default"
          className="w-full border rounded px-2 py-1 text-xs bg-background"
          value={defaultValue === undefined ? '' : String(defaultValue)}
          onChange={e => onChange(map, e.target.value === '' ? undefined : e.target.value)}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 5.4: Lancer les tests pour confirmer le succès**

Run: `cd apps/frontend && npx vitest run src/components/devices/TransformEditor.test.tsx`
Expected: tous les tests passent.

- [ ] **Step 5.5: Commit**

```bash
cd /Volumes/JulesB/projet/saas/signal-room
git add apps/frontend/src/components/devices/TransformEditor.tsx \
        apps/frontend/src/components/devices/TransformEditor.test.tsx
git commit -m "feat(frontend): add structured TransformEditor component"
```

---

## Task 6: Frontend — Composant `UnitEditor` (accordion d'édition)

**Files:**
- Create: `apps/frontend/src/components/devices/UnitEditor.tsx`
- Create: `apps/frontend/src/components/devices/UnitEditor.test.tsx`

- [ ] **Step 6.1: Écrire les tests (TDD red phase)**

Créer `apps/frontend/src/components/devices/UnitEditor.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnitEditor } from './UnitEditor'
import type { UnitInput } from '@/lib/registry-api'

const baseUnit: UnitInput = {
  position: 0,
  name: 'Power',
  topic_pattern: 'wled/lamp/v',
  json_path: 'on',
  condition: null,
  transform: { type: 'passthrough' },
  output_field: 'power',
  output_type: 'boolean',
  display: { label: 'Allumé' },
}

describe('UnitEditor', () => {
  it('affiche le label de l\'unit replié par défaut', () => {
    render(<UnitEditor unit={baseUnit} onChange={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Allumé')).toBeInTheDocument()
    expect(screen.queryByLabelText('topic_pattern')).not.toBeInTheDocument()
  })

  it('ouvre l\'accordion au clic sur Modifier', async () => {
    render(<UnitEditor unit={baseUnit} onChange={vi.fn()} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /modifier/i }))
    expect(screen.getByLabelText('topic_pattern')).toBeInTheDocument()
    expect(screen.getByLabelText('output_field')).toBeInTheDocument()
    expect(screen.getByLabelText('label')).toBeInTheDocument()
    expect(screen.getByLabelText('json_path')).toBeInTheDocument()
  })

  it('émet onChange quand topic_pattern change', async () => {
    const onChange = vi.fn()
    render(<UnitEditor unit={baseUnit} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /modifier/i }))
    const input = screen.getByLabelText('topic_pattern')
    await userEvent.clear(input)
    await userEvent.type(input, 'wled/x/v')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      topic_pattern: 'wled/x/v',
    }))
  })

  it('émet onChange quand label change', async () => {
    const onChange = vi.fn()
    render(<UnitEditor unit={baseUnit} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /modifier/i }))
    const input = screen.getByLabelText('label')
    await userEvent.clear(input)
    await userEvent.type(input, 'État')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      display: expect.objectContaining({ label: 'État' }),
    }))
  })

  it('émet onChange quand output_field change', async () => {
    const onChange = vi.fn()
    render(<UnitEditor unit={baseUnit} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /modifier/i }))
    const input = screen.getByLabelText('output_field')
    await userEvent.clear(input)
    await userEvent.type(input, 'state')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      output_field: 'state',
    }))
  })

  it('émet onDelete quand le bouton supprimer est cliqué', async () => {
    const onDelete = vi.fn()
    render(<UnitEditor unit={baseUnit} onChange={vi.fn()} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: /supprimer l'unit/i }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('intègre TransformEditor et propage onChange du transform', async () => {
    const onChange = vi.fn()
    render(<UnitEditor unit={baseUnit} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /modifier/i }))
    await userEvent.selectOptions(screen.getByLabelText(/type/i), 'round')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      transform: { type: 'round', decimals: 2 },
    }))
  })
})
```

- [ ] **Step 6.2: Lancer les tests — échec attendu**

Run: `cd apps/frontend && npx vitest run src/components/devices/UnitEditor.test.tsx`
Expected: module introuvable.

- [ ] **Step 6.3: Implémenter le composant**

Créer `apps/frontend/src/components/devices/UnitEditor.tsx` :

```tsx
'use client'

import { useState } from 'react'
import { Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TransformEditor, type Transform } from './TransformEditor'
import type { UnitInput } from '@/lib/registry-api'

interface Props {
  unit: UnitInput
  onChange: (u: UnitInput) => void
  onDelete: () => void
}

export function UnitEditor({ unit, onChange, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const label = unit.display?.label || unit.output_field || '(sans label)'

  function patch(partial: Partial<UnitInput>) {
    onChange({ ...unit, ...partial })
  }
  function patchDisplay(partial: Partial<NonNullable<UnitInput['display']>>) {
    onChange({ ...unit, display: { ...(unit.display ?? {}), ...partial } })
  }

  return (
    <Card>
      <CardContent className="pt-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-medium text-left flex-1 min-w-0"
            onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Replier' : 'Modifier'}
          >
            {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <span className="truncate">{label}</span>
          </button>
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            onClick={onDelete} aria-label="Supprimer l'unit"
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>

        {!open && (
          <p className="text-xs font-mono text-muted-foreground truncate">
            {unit.topic_pattern}
          </p>
        )}

        {open && (
          <div className="space-y-2 pt-1 border-t">
            <TextField
              label="output_field" value={unit.output_field}
              onChange={v => patch({ output_field: v })}
            />
            <TextField
              label="label" value={unit.display?.label ?? ''}
              onChange={v => patchDisplay({ label: v })}
            />
            <TextField
              label="topic_pattern" value={unit.topic_pattern}
              onChange={v => patch({ topic_pattern: v })}
            />
            <TextField
              label="json_path" value={unit.json_path ?? ''}
              onChange={v => patch({ json_path: v === '' ? null : v })}
            />
            <div className="pt-1">
              <TransformEditor
                value={unit.transform as Transform}
                onChange={t => patch({ transform: t })}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TextField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const id = `uf-${label}`
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="w-full border rounded px-2 py-1 text-xs font-mono bg-background"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}
```

- [ ] **Step 6.4: Lancer les tests pour confirmer le succès**

Run: `cd apps/frontend && npx vitest run src/components/devices/UnitEditor.test.tsx`
Expected: tous les tests passent.

- [ ] **Step 6.5: Commit**

```bash
cd /Volumes/JulesB/projet/saas/signal-room
git add apps/frontend/src/components/devices/UnitEditor.tsx \
        apps/frontend/src/components/devices/UnitEditor.test.tsx
git commit -m "feat(frontend): add UnitEditor accordion with per-field editing"
```

---

## Task 7: Frontend — Composant `SavePresetModal`

**Files:**
- Create: `apps/frontend/src/components/devices/SavePresetModal.tsx`
- Create: `apps/frontend/src/components/devices/SavePresetModal.test.tsx`

- [ ] **Step 7.1: Écrire les tests (TDD red phase)**

Créer `apps/frontend/src/components/devices/SavePresetModal.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SavePresetModal } from './SavePresetModal'

describe('SavePresetModal', () => {
  it('ne rend rien quand fermé', () => {
    render(<SavePresetModal
      open={false} initialName="" onSave={vi.fn()} onClose={vi.fn()}
    />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('affiche le formulaire quand ouvert avec nom pré-rempli', () => {
    render(<SavePresetModal
      open={true} initialName="WLED salon" onSave={vi.fn()} onClose={vi.fn()}
    />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/nom/i)).toHaveValue('WLED salon')
  })

  it('appelle onSave avec nom + description', async () => {
    const onSave = vi.fn()
    render(<SavePresetModal
      open={true} initialName="WLED" onSave={onSave} onClose={vi.fn()}
    />)
    const desc = screen.getByLabelText(/description/i)
    await userEvent.type(desc, 'Ma version')
    await userEvent.click(screen.getByRole('button', { name: /sauvegarder/i }))
    expect(onSave).toHaveBeenCalledWith({ name: 'WLED', description: 'Ma version' })
  })

  it('bloque la sauvegarde si le nom est vide', async () => {
    const onSave = vi.fn()
    render(<SavePresetModal
      open={true} initialName="" onSave={onSave} onClose={vi.fn()}
    />)
    await userEvent.click(screen.getByRole('button', { name: /sauvegarder/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/nom requis/i)).toBeInTheDocument()
  })

  it('appelle onClose au clic sur Annuler', async () => {
    const onClose = vi.fn()
    render(<SavePresetModal
      open={true} initialName="X" onSave={vi.fn()} onClose={onClose}
    />)
    await userEvent.click(screen.getByRole('button', { name: /annuler/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 7.2: Lancer les tests — échec attendu**

Run: `cd apps/frontend && npx vitest run src/components/devices/SavePresetModal.test.tsx`
Expected: module introuvable.

- [ ] **Step 7.3: Implémenter le composant**

Créer `apps/frontend/src/components/devices/SavePresetModal.tsx` :

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  initialName: string
  initialDescription?: string
  submitLabel?: string
  onSave: (data: { name: string; description: string }) => void
  onClose: () => void
}

export function SavePresetModal({
  open, initialName, initialDescription = '', submitLabel = 'Sauvegarder',
  onSave, onClose,
}: Props) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setDescription(initialDescription)
      setError(null)
    }
  }, [open, initialName, initialDescription])

  if (!open) return null

  function handleSubmit() {
    if (!name.trim()) { setError('Nom requis'); return }
    onSave({ name: name.trim(), description: description.trim() })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="bg-background border rounded-lg p-6 w-full max-w-md space-y-4">
        <h3 className="text-lg font-semibold">Sauvegarder comme preset</h3>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="preset-name">Nom</label>
          <input
            id="preset-name"
            className="w-full border rounded px-3 py-2 text-sm bg-background"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="preset-desc">Description</label>
          <textarea
            id="preset-desc"
            rows={3}
            className="w-full border rounded px-3 py-2 text-sm bg-background"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit}>{submitLabel}</Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7.4: Lancer les tests pour confirmer le succès**

Run: `cd apps/frontend && npx vitest run src/components/devices/SavePresetModal.test.tsx`
Expected: tous les tests passent.

- [ ] **Step 7.5: Commit**

```bash
cd /Volumes/JulesB/projet/saas/signal-room
git add apps/frontend/src/components/devices/SavePresetModal.tsx \
        apps/frontend/src/components/devices/SavePresetModal.test.tsx
git commit -m "feat(frontend): add SavePresetModal for naming a custom preset"
```

---

## Task 8: Frontend — Intégration dans `page.tsx` : éditeur d'unit + bouton "Sauvegarder comme preset"

**Files:**
- Modify: `apps/frontend/src/app/devices/page.tsx`

- [ ] **Step 8.1: Remplacer le rendu d'unit par `UnitEditor` et ajouter le bouton "Sauvegarder comme preset"**

Ouvrir `apps/frontend/src/app/devices/page.tsx`.

1. Mettre à jour les imports en haut du fichier :

Remplacer le bloc :
```ts
import {
  fetchRegistry, fetchTopicsSeen, fetchPresets,
  addDevice, patchDevice, removeDevice, applyPresetClient,
} from '@/lib/registry-api'
import type { RegistryDevice, TopicSeen, Preset, UnitInput } from '@/lib/registry-api'
```

par :

```ts
import {
  fetchRegistry, fetchTopicsSeen, fetchPresets,
  addDevice, patchDevice, removeDevice, applyPresetClient,
  createCustomPreset, updateCustomPreset, deleteCustomPreset,
} from '@/lib/registry-api'
import type { RegistryDevice, TopicSeen, Preset, UnitInput } from '@/lib/registry-api'
import { UnitEditor } from '@/components/devices/UnitEditor'
import { SavePresetModal } from '@/components/devices/SavePresetModal'
```

2. Ajouter trois nouveaux états après `const [formError, setFormError] = useState<string | null>(null)` :

```ts
const [saveModalOpen, setSaveModalOpen] = useState(false)
const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
const [presetDraft, setPresetDraft] = useState<{ name: string; description: string }>({ name: '', description: '' })
```

3. Remplacer la fonction `handleUnitChange` existante par une version qui prend l'unit complet :

Remplacer :
```ts
function handleUnitChange(index: number, field: 'topic_pattern' | 'output_field', value: string) {
  setUnits(prev => prev.map((u, i) => i === index ? { ...u, [field]: value } : u))
}
```

par :

```ts
function handleUnitReplace(index: number, next: UnitInput) {
  setUnits(prev => prev.map((u, i) => i === index ? next : u))
}
```

4. Ajouter les handlers pour les presets custom, juste après `handleSave` :

```ts
function handleOpenSaveModal() {
  if (!name.trim() && !presetDraft.name) {
    setFormError('Renseignez d\'abord le nom du device ou ouvrez la modale après')
    return
  }
  setFormError(null)
  setEditingPresetId(null)
  setPresetDraft({ name: name.trim() || 'Mon preset', description: '' })
  setSaveModalOpen(true)
}

async function handleSavePreset(data: { name: string; description: string }) {
  try {
    if (editingPresetId) {
      await updateCustomPreset(editingPresetId, { ...data, units })
    } else {
      await createCustomPreset({ ...data, units })
    }
    const refreshed = await fetchPresets()
    setPresets(refreshed)
    setSaveModalOpen(false)
    setEditingPresetId(null)
  } catch (err) {
    setFormError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde du preset')
  }
}

function handleEditCustomPreset(preset: Preset) {
  if (preset.source !== 'custom' || !preset.id) return
  setMode('add')
  setEditingId(null)
  setEditingPresetId(preset.id)
  setSelectedPreset(preset)
  setName('')
  setUnits(applyPresetClient(preset, {}))
  setPlaceholderValues({})
  setPresetDraft({ name: preset.name, description: preset.description })
  setStep('units')
  setFormError(null)
}

async function handleDeleteCustomPreset(preset: Preset) {
  if (preset.source !== 'custom' || !preset.id) return
  if (!confirm(`Supprimer le preset "${preset.name}" ?`)) return
  try {
    await deleteCustomPreset(preset.id)
    const refreshed = await fetchPresets()
    setPresets(refreshed)
  } catch (err) {
    setFormError(err instanceof Error ? err.message : 'Erreur lors de la suppression')
  }
}
```

5. Remplacer le bloc qui rend la liste des units à l'étape `'units'` (la `<div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">` et son contenu jusqu'à `</div>`) par :

```tsx
<div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
  {units.map((unit, index) => (
    <UnitEditor
      key={index}
      unit={unit}
      onChange={next => handleUnitReplace(index, next)}
      onDelete={() => handleDeleteUnit(index)}
    />
  ))}
</div>
```

6. Sous le bouton `Ajouter un unit` et juste avant le bouton `Enregistrer`, ajouter le bouton "Sauvegarder comme preset" :

Remplacer le bloc :
```tsx
<Button variant="outline" onClick={handleAddUnit} className="w-full">Ajouter un unit</Button>
{mode === 'add' && selectedPreset && (
  <Button variant="outline" onClick={handleResetToPreset} className="w-full">Reset au preset</Button>
)}
{formError && <p className="text-sm text-destructive">{formError}</p>}
<Button onClick={handleSave} className="w-full">Enregistrer</Button>
```

par :

```tsx
<Button variant="outline" onClick={handleAddUnit} className="w-full">Ajouter un unit</Button>
{mode === 'add' && selectedPreset && (
  <Button variant="outline" onClick={handleResetToPreset} className="w-full">Reset au preset</Button>
)}
<Button variant="outline" onClick={handleOpenSaveModal} className="w-full">
  {editingPresetId ? 'Mettre à jour le preset' : 'Sauvegarder comme preset'}
</Button>
{formError && <p className="text-sm text-destructive">{formError}</p>}
<Button onClick={handleSave} className="w-full">Enregistrer le device</Button>
```

7. Juste avant la fermeture du `</main>`, monter la modale :

```tsx
<SavePresetModal
  open={saveModalOpen}
  initialName={presetDraft.name}
  initialDescription={presetDraft.description}
  submitLabel={editingPresetId ? 'Mettre à jour' : 'Sauvegarder'}
  onSave={handleSavePreset}
  onClose={() => setSaveModalOpen(false)}
/>
```

- [ ] **Step 8.2: Mettre à jour l'étape "preset" pour afficher les icônes crayon/poubelle sur les presets custom**

À l'étape `'preset'`, remplacer le bloc `<select id="preset-select"...>` et son contenu par une liste cliquable :

Remplacer :

```tsx
<select
  id="preset-select"
  className="w-full border rounded px-3 py-2 text-sm bg-background"
  value={selectedPreset?.key ?? ''}
  onChange={e => setSelectedPreset(presets.find(p => p.key === e.target.value) ?? null)}
>
  <option value="">— Sélectionner un preset —</option>
  {presets.map(p => (
    <option key={p.key} value={p.key}>{p.name}</option>
  ))}
</select>
{selectedPreset && (
  <p className="text-xs text-muted-foreground">{selectedPreset.description}</p>
)}
```

par :

```tsx
<div className="border rounded max-h-72 overflow-y-auto divide-y">
  {presets.length === 0 && (
    <p className="text-xs text-muted-foreground p-2">Aucun preset disponible</p>
  )}
  {presets.map(p => {
    const isSelected = selectedPreset?.key === p.key
    return (
      <div
        key={p.key}
        className={`flex items-center justify-between p-2 text-sm cursor-pointer hover:bg-muted ${isSelected ? 'bg-muted' : ''}`}
        onClick={() => setSelectedPreset(p)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate">{p.name}</span>
            {p.source === 'custom' && <Badge variant="secondary">Custom</Badge>}
          </div>
          <p className="text-xs text-muted-foreground truncate">{p.description}</p>
        </div>
        {p.source === 'custom' && (
          <div className="flex gap-1 shrink-0">
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={e => { e.stopPropagation(); handleEditCustomPreset(p) }}
              aria-label="Éditer le preset"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={e => { e.stopPropagation(); handleDeleteCustomPreset(p) }}
              aria-label="Supprimer le preset"
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
        )}
      </div>
    )
  })}
</div>
```

- [ ] **Step 8.3: Vérifier la compilation et les tests existants**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: aucune erreur.

Run: `cd apps/frontend && npm test`
Expected: tous les tests passent.

- [ ] **Step 8.4: Commit**

```bash
cd /Volumes/JulesB/projet/saas/signal-room
git add apps/frontend/src/app/devices/page.tsx
git commit -m "feat(frontend): integrate UnitEditor and custom preset save/edit/delete in devices page"
```

---

## Task 9: Vérification end-to-end manuelle

**Files:** aucun changement de fichier — vérification manuelle.

- [ ] **Step 9.1: Lancer le backend et le frontend**

Run dans un terminal : `cd /Volumes/JulesB/projet/saas/signal-room/apps/backend && npm run dev`
Run dans un autre terminal : `cd /Volumes/JulesB/projet/saas/signal-room/apps/frontend && npm run dev`

Expected: backend sur port 3001, frontend sur port 3000.

- [ ] **Step 9.2: Tester le scénario WLED**

Dans le navigateur, ouvrir `http://localhost:3000/devices`. Puis :

1. Cliquer sur le preset `WLED` dans la liste de droite.
2. Saisir `device_id=lampe1` à l'étape placeholders.
3. À l'étape units, cliquer "Modifier" sur l'unit "Luminosité".
4. Modifier `output_field` de `brightness` à `bri`, `topic_pattern` ajusté au format réel WLED.
5. Cliquer "Sauvegarder comme preset", nommer "WLED ajusté", description "Mon WLED format réel".
6. Sauvegarder.
7. Réinitialiser le formulaire (bouton Annuler ou recharger), retourner à l'étape preset.
8. Vérifier que "WLED ajusté" apparaît avec un badge Custom.
9. Cliquer dessus, vérifier que les units sont chargées avec les modifications.
10. Cliquer sur l'icône crayon, modifier la description, sauvegarder via "Mettre à jour".
11. Cliquer sur l'icône poubelle, confirmer la suppression, vérifier que le preset disparaît.

Expected: chaque étape fonctionne sans erreur dans la console navigateur ni dans le terminal backend.

- [ ] **Step 9.3: Vérifier la non-régression sur les presets built-in**

Dans le même navigateur :

1. Créer un device depuis le preset `frigate-camera` (placeholders : `camera=salon`).
2. Sauvegarder le device.
3. Vérifier qu'il apparaît dans la colonne 1.
4. Cliquer sur l'icône crayon → édition du device.
5. Vérifier que les icônes crayon/poubelle n'apparaissent PAS sur les presets built-in dans la liste.

Expected: comportement identique à avant pour les presets built-in.

- [ ] **Step 9.4: Lancer toute la suite de tests une dernière fois**

Run: `cd apps/backend && npm test`
Run: `cd apps/frontend && npm test`
Expected: toutes les suites passent.

- [ ] **Step 9.5: Commit final si nécessaire**

S'il n'y a aucune modification additionnelle, sauter ce step. Sinon :

```bash
cd /Volumes/JulesB/projet/saas/signal-room
git status
git add <fichiers ajustés>
git commit -m "fix(frontend): <description du fix>"
```

---

## Résumé des commits attendus

À la fin de l'implémentation, la branche `feat/custom-presets` doit contenir, en plus de `957142cb docs: add custom presets design spec` :

1. `feat(backend): add custom_presets table to schema`
2. `feat(backend): add custom presets CRUD queries`
3. `feat(backend): add custom presets REST endpoints and merge into GET /api/presets`
4. `feat(frontend): add custom preset CRUD client and source tag on Preset`
5. `feat(frontend): add structured TransformEditor component`
6. `feat(frontend): add UnitEditor accordion with per-field editing`
7. `feat(frontend): add SavePresetModal for naming a custom preset`
8. `feat(frontend): integrate UnitEditor and custom preset save/edit/delete in devices page`

Soit 8 commits structurés + le commit du spec.
