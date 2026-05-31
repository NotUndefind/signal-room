# Signal Interpreter — Système d'interprétation MQTT configurable

**Date :** 2026-05-31
**Branche cible :** à définir au plan
**Spec liée précédente :** [`2026-05-31-dynamic-device-registry-design.md`](./2026-05-31-dynamic-device-registry-design.md)
**Dépendance bloquante :** chantier [`2026-05-31-topics-tree`](../plans/2026-05-31-topics-tree.md) (UI `/devices` et dashboard)

---

## 1. Contexte et problème

### État actuel

Le backend interprète les messages MQTT via trois interpréteurs **codés en dur** en TypeScript : `frigate.ts`, `wled.ts`, `tasmota.ts`, plus un `raw.ts` passthrough. Le registry SQLite (`device_registry`) attache un device à un `interpreter_type ∈ {frigate, tasmota, wled, raw}` — whitelist fermée. Chaque type a une card frontend dédiée (`FrigateCard`, `WledCard`, `TasmotaCard`, `GenericCard`).

Ajouter un nouveau type d'appareil (DHT22 générique, switch Zigbee, ESPHome…) impose aujourd'hui :
1. Écrire `interpreters/<nom>.ts`.
2. L'enregistrer dans `DEFAULT_INTERPRETERS` et le map de `createDynamicRegistry`.
3. Étendre la whitelist `interpreter_type` dans le registry et l'API.
4. Coder une card frontend dédiée.

### Objectif

Permettre à l'utilisateur d'**ajouter un device sur un topic inconnu et d'en configurer l'interprétation depuis l'UI**, sans toucher au code TypeScript. Garantir la parité fonctionnelle avec les 3 interpréteurs existants : Frigate (avec filtrage par zone), Tasmota (POWER, énergie, capteurs ambiants), WLED.

### Contraintes

- TypeScript, npm, exports nommés.
- Pas d'`eval` JS sur des données utilisateur (sécurité).
- Pas de dépendance lourde sans justification.
- Compatibilité avec le pipeline existant : debounce, dedup, broadcast WS, Redis live, SQLite events/snapshots — pas de réécriture.
- Tests Vitest pour la logique d'interprétation et la parité avec les anciens interpréteurs.
- Frontend : rendu piloté par config, **un seul** composant générique de card.

---

## 2. Architecture cible — vue d'ensemble

**Idée centrale :** un device n'a plus de `interpreter_type` ; il a une **liste d'units**. Chaque unit écoute un topic, extrait optionnellement un champ JSON, applique une condition optionnelle, une transformation issue d'un catalogue fini, et produit **un champ** de l'état du device. Le runtime fusionne les sorties des units en un `DeviceState` mergé persistant entre messages.

```
MQTT broker
   │
   ▼
[ MQTT client ] ─── topic + payload
   │
   ▼
[ UnitRegistry.route(topic, payload) ]
   │     pour chaque device :
   │       pour chaque unit dont topic_pattern match :
   │         évalue condition → extrait json_path → transforme → { output_field: value }
   │     produit RouteResult[] (1 par device touché)
   ▼
[ Aggregator ]   maintient Map<device_id, state mergé>
   │     fusionne partial_state dans le state cumulatif
   │     produit DeviceState { source: 'device:<id>', event_type, state, raw, timestamp }
   ▼
[ Debounce par device.id ] ──── [ Dedup par device.id ] ──── [ Broadcast WS + Redis + SQLite ]
```

**Modèle « X » d'identité device** : une entrée `device_registry` = une instance physique (Frigate caméra chambre = un device, Frigate caméra cuisine = un autre device). Plus de logique « sub-identity extraite du state ». La clé device = `device:${id}` partout.

**Système hybride « C »** : des **presets** (Frigate caméra, Tasmota POWER, etc.) sont disponibles comme starters cloneables dans l'UI, mais sous le capot un preset = un pack d'units pré-rempli, identique en structure à n'importe quelle config inline créée à la main.

---

## 3. Modèle de données

### 3.1 Schéma SQLite

#### Table `device_registry` (refactorisée)

```sql
CREATE TABLE device_registry (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  debounce_ms  INTEGER NULL,
  layout_json  TEXT    NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);
```

- `debounce_ms` : override par device. `NULL` = broadcast immédiat.
- `layout_json` : `LayoutDescriptor` sérialisé. `NULL` = rendu par défaut (ordre = `units.position`).
- Les colonnes existantes `topic_patterns` et `interpreter_type` sont **supprimées** après la migration (cf. §9).

#### Table `device_units` (nouvelle)

```sql
CREATE TABLE device_units (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id      INTEGER NOT NULL REFERENCES device_registry(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  name           TEXT    NOT NULL,
  topic_pattern  TEXT    NOT NULL,
  json_path      TEXT    NULL,
  condition_json TEXT    NULL,
  transform_json TEXT    NOT NULL,
  output_field   TEXT    NOT NULL,
  output_type    TEXT    NOT NULL,
  display_json   TEXT    NULL,
  created_at     INTEGER NOT NULL
);

CREATE INDEX idx_units_device ON device_units (device_id);
```

### 3.2 Types TypeScript

```ts
export interface DeviceEntry {
  id: number
  name: string
  debounce_ms: number | null
  layout: LayoutDescriptor | null
  units: Unit[]
  active: boolean
  created_at: number
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

export type OutputType = 'boolean' | 'number' | 'string' | 'color' | 'enum'

export interface Condition {
  path: string
  op: 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'
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
```

### 3.3 Champ réservé `event_type`

Si un unit produit `output_field = "event_type"`, il pilote le `event_type` du `DeviceState` final. Sinon, valeur par défaut `"state_change"`. Son `output_type` doit être `string` ou `enum` (vérifié à la validation).

---

## 4. Format de config d'un unit — exemples canoniques

### 4.1 Personne détectée dans le bureau (Frigate + condition)

```json
{
  "name": "Personne dans bureau",
  "topic_pattern": "frigate/chambre/events",
  "json_path": "after.label",
  "condition": {
    "path": "after.current_zones",
    "op": "contains",
    "value": "bureau"
  },
  "transform": { "type": "enum_map", "map": { "person": true }, "default": false },
  "output_field": "person_in_bureau",
  "output_type": "boolean",
  "display": { "label": "Personne au bureau", "icon": "User" }
}
```

### 4.2 Luminosité WLED (extraction + scale)

```json
{
  "name": "Luminosité",
  "topic_pattern": "wled/salon/v",
  "json_path": "bri",
  "transform": { "type": "scale", "in_min": 0, "in_max": 255, "out_min": 0, "out_max": 100, "round": true },
  "output_field": "brightness",
  "output_type": "number",
  "display": { "label": "Luminosité", "icon": "Sun", "unit": "%", "min": 0, "max": 100 }
}
```

### 4.3 Couleur WLED (RGB → hex)

```json
{
  "name": "Couleur",
  "topic_pattern": "wled/salon/v",
  "json_path": "seg[0].col[0]",
  "transform": { "type": "rgb_to_hex" },
  "output_field": "color",
  "output_type": "color",
  "display": { "label": "Couleur" }
}
```

### 4.4 Tasmota POWER (string → bool)

```json
{
  "name": "Relais",
  "topic_pattern": "home/chambre/lumiere/tele/chambre/STATE",
  "json_path": "POWER",
  "transform": { "type": "enum_map", "map": { "ON": true, "OFF": false } },
  "output_field": "power",
  "output_type": "boolean",
  "display": { "label": "Allumé", "icon": "Plug", "on_label": "Allumé", "off_label": "Éteint" }
}
```

### 4.5 Capteur DHT22 générique (passthrough numérique)

```json
{
  "name": "Température",
  "topic_pattern": "home/garage/temp",
  "json_path": null,
  "transform": { "type": "passthrough" },
  "output_field": "temperature",
  "output_type": "number",
  "display": { "label": "Température", "icon": "Thermometer", "unit": "°C" }
}
```

---

## 5. Pipeline runtime

### 5.1 `createUnitRegistry`

Remplace `createDynamicRegistry`. Charge `device_registry` + `device_units` au boot. Expose :

```ts
export interface UnitRegistry {
  getAllTopics(): string[]
  route(topic: string, payload: Buffer): RouteResult[]
  getDebounceMs(deviceId: number): number | null
  addDevice(entry: DeviceEntry): void
  removeDevice(id: number): void
  reloadDevice(id: number): void
}

export interface RouteResult {
  device_id: number
  partial_state: Record<string, unknown>
  raw: string
}
```

### 5.2 Évaluation d'un unit

Étapes ordonnées, court-circuit dès qu'une étape échoue (l'unit n'émet rien) :

1. **Match topic** : `mqttTopicMatches(unit.topic_pattern, topic)` (utilise `apps/backend/src/mqtt/matcher.ts` existant).
2. **Parse payload** : tentative `JSON.parse` ; échec → utiliser la string brute.
3. **Évaluation de la condition** (si présente) : extraction de `condition.path` sur le **payload entier**, application de `condition.op` avec `condition.value`. Si chemin inexistant ou évaluation impossible → condition échoue (comportement défensif).
4. **Extraction** : application de `json_path` sur le payload pour obtenir la valeur à transformer. `null` ou absent → utiliser le payload entier.
5. **Transform** : dispatch fini sur `transform.type`. Erreur (ex: cast impossible) → log warning, l'unit n'émet rien.
6. **Émission** : `{ [unit.output_field]: transformedValue }`.

### 5.3 Agrégation par device

Module dédié `apps/backend/src/interpreters/aggregator.ts` :

```ts
export interface DeviceAggregator {
  merge(result: RouteResult): DeviceState | null
  hydrate(deviceId: number, state: Record<string, unknown>): void
  reset(deviceId: number): void
}
```

- Maintient en mémoire `Map<device_id, Record<string, unknown>>` : l'état mergé courant.
- Sur chaque `RouteResult` : `state[field] = partial_state[field]` pour chaque champ (les champs non touchés gardent leur dernière valeur).
- Produit le `DeviceState` final :
  ```ts
  {
    source: `device:${device_id}`,
    event_type: (state.event_type as string) ?? 'state_change',
    state: { ...state, event_type: undefined },  // event_type sorti du state public
    raw: result.raw,
    timestamp: Date.now()
  }
  ```
- À l'init, `hydrate(deviceId, state)` peut restaurer l'état depuis Redis si présent (cohérence après redémarrage).

### 5.4 Intégration dans `apps/backend/src/index.ts`

Modifications minimales :
- `deviceKey(state)` → `state.source` directement (déjà au format `device:<id>`).
- `getDebounce(source)` → lit `device.debounce_ms` depuis le registry.
- Ajout d'un appel `aggregator.merge(result)` entre `route(...)` et le debounce.
- Boucle `for (const result of results) { ... }` puisque `route` retourne `RouteResult[]` (un message peut toucher plusieurs devices si les topics se chevauchent).

Le reste — `dedupStore`, `broadcaster.broadcast`, `redisStore.setDeviceState`, `insertEvent`, `insertSnapshot`, `upsertTopicSeen` — reste inchangé.

---

## 6. Presets seed

### 6.1 Fichier `apps/backend/src/interpreters/presets.ts`

Versionné en git, structure exportée :

```ts
export interface Preset {
  key: string
  name: string
  description: string
  debounce_ms: number | null
  layout: LayoutDescriptor | null
  placeholders: string[]               // ex: ['camera'] ou ['device_id', 'prefix']
  units: Omit<Unit, 'id' | 'device_id' | 'created_at'>[]
}

export const PRESETS: Preset[]
```

Presets fournis au démarrage :
- `frigate-camera` — placeholders `['camera']`
- `wled` — placeholders `['device_id']`
- `tasmota-power` — placeholders `['prefix', 'device_id']`
- `tasmota-energy` — placeholders `['prefix', 'device_id']`
- `tasmota-dht` — placeholders `['prefix', 'device_id']`
- `raw-passthrough` — placeholders `['topic']`

**Pourquoi trois presets Tasmota distincts** : un Tasmota n'a pas un usage unique. Un Sonoff Basic publie seulement POWER ; un Sonoff POW R2 publie POWER + ENERGY ; un ESP8266 avec DHT22 publie température/humidité sans POWER. Découper en 3 presets permet à l'utilisateur de choisir celui qui correspond à son appareil. S'il a un Tasmota qui combine plusieurs fonctions (ex: Sonoff POW R2), il part de `tasmota-power` puis ajoute manuellement les units du preset `tasmota-energy`. Cette friction est acceptable : c'est un cas minoritaire et l'édition d'unit est de toute façon nécessaire pour adapter le topic_pattern.

Décomposition détaillée d'au moins ces 6 presets fournie comme annexe au plan d'implémentation (cf. §10 : test de parité avec replay de payloads réels).

### 6.2 Route API

`GET /api/presets` → `{ presets: Preset[] }`. Lecture seule, pas de mutation.

### 6.3 Workflow utilisateur (différé jusqu'au merge topics-tree)

Sur la page `/devices`, dans la colonne « Ajouter un device » :
1. Dropdown « Partir d'un preset » au-dessus du formulaire.
2. Sélection → pré-remplissage du formulaire avec les units du preset et un champ unique « Identifiant » regroupant les placeholders.
3. Saisie de l'identifiant (ex: `chambre`) → substitution dans tous les `topic_pattern` (ex: `frigate/{camera}/events` → `frigate/chambre/events`).
4. Édition libre des units (ajout/suppression/modification) avant soumission.
5. POST `/api/registry` envoie le device finalisé — le backend ne sait pas que c'était un preset.

### 6.4 Substitution des placeholders

Implémentée côté frontend uniquement (le backend reçoit déjà des topics résolus). Format `{nom}` simple, remplacement littéral. Validation côté frontend : tous les placeholders doivent être substitués avant POST.

---

## 7. Rendu frontend

### 7.1 Composant unique `GenericDeviceCard`

`apps/frontend/src/components/devices/GenericDeviceCard.tsx` (à créer après merge topics-tree) :

```ts
interface GenericDeviceCardProps {
  device: RegistryDevice
  state: FrontendDeviceState | undefined
}
```

Algorithme :
1. Trier `device.units` par `position`.
2. Si `device.layout` non nul → appliquer ordre/groupement.
3. Pour chaque `unit`, lire `state.state[unit.output_field]` et router vers le widget correspondant à `unit.output_type`.
4. Header : `device.name`. Timestamp via `<DeviceCard>` wrapper existant.

### 7.2 Widgets

`apps/frontend/src/components/devices/widgets/` :

| Widget | `output_type` | Props |
|---|---|---|
| `BooleanIndicator` | `boolean` | `value, label, icon, on_label, off_label` |
| `NumericValue` | `number` | `value, label, unit, min, max` (gauge si min/max présents) |
| `TextField` | `string` | `value, label` |
| `ColorSwatch` | `color` | `value, label` |
| `EnumBadge` | `enum` | `value, label` |

Chaque widget ~20-40 lignes JSX, importe shadcn/lucide existants. Aucune dépendance nouvelle.

### 7.3 Whitelist d'icônes

`apps/frontend/src/components/devices/icons.ts` :

```ts
import { User, Camera, Lightbulb, Plug, Zap, Thermometer, Sun, /* … */ } from 'lucide-react'

export const ICON_MAP: Record<string, LucideIcon> = {
  User, Camera, Lightbulb, Plug, Zap, Thermometer, Sun, /* … */
}

export function getIcon(name: string | undefined): LucideIcon | null {
  if (!name) return null
  return ICON_MAP[name] ?? null
}
```

Whitelist initiale ~30 icônes, extensible par PR. Empêche les imports dynamiques d'icônes arbitraires.

### 7.4 `LayoutDescriptor` (extension YAGNI)

Le champ `device.layout_json` reste `NULL` au départ. L'UI de customisation de layout n'est **pas** dans le scope initial. Le rendu par défaut (ordre par `position`, tous les fields affichés) couvre 100 % du brief. La structure du `LayoutDescriptor` est définie pour ne pas casser la DB plus tard.

### 7.5 Suppression des cards spécialisées

Après migration validée :
- `FrigateCard.tsx`, `WledCard.tsx`, `TasmotaCard.tsx` → supprimées (couvertes par `GenericDeviceCard`).
- `GenericCard.tsx` actuel → décision à l'implémentation (conserver comme debug ou supprimer).
- `app/page.tsx` (post-merge topics-tree) : `switch (interpreter_type)` remplacé par un simple map des devices vers `<GenericDeviceCard>`.

---

## 8. Validation et sécurité

### 8.1 Module `apps/backend/src/interpreters/validate.ts`

Validation maison déclarative, pas de dépendance externe. Exporte :

```ts
export function validateUnitInput(input: unknown): { ok: true; unit: UnitInput } | { ok: false; error: string }
export function validateLayout(input: unknown): { ok: true; layout: LayoutDescriptor } | { ok: false; error: string }
export function validateDevicePayload(input: unknown): { ok: true; device: DevicePayload } | { ok: false; error: string }
```

### 8.2 Règles par champ

| Champ | Règle |
|---|---|
| `topic_pattern` | string non vide ≤ 256 chars, segments `/`, chaque segment ∈ `+`, `#`, ou `[a-zA-Z0-9_-]+`, `#` seulement en dernier |
| `json_path` | null ou `^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*|\[\d+\])*$` |
| `condition.op` | whitelist fermée |
| `condition.path` | mêmes règles que `json_path` |
| `condition.value` | string, number, boolean, ou array de string/number |
| `transform.type` | whitelist fermée, schéma par type |
| `transform.scale.*` | numériques requis |
| `output_field` | `[a-zA-Z_]\w*`, longueur ≤ 64 |
| `output_type` | whitelist `boolean, number, string, color, enum` |
| `display.icon` | si présent, string non vide ≤ 64 chars (la validation contre le catalogue d'icônes se fait **côté frontend** via `getIcon(name)` qui retourne `null` pour les inconnus — fail-soft : l'icône est simplement omise à l'affichage) |

### 8.3 Cohérence inter-units (au niveau device)

- Deux units produisant le même `output_field` doivent déclarer le même `output_type`.
- Un unit produisant `output_field = "event_type"` doit avoir `output_type ∈ {string, enum}`.

### 8.4 Limites de défense en profondeur

- Payload MQTT max traité : 64 KB.
- Max units par device : 30.
- `topic_pattern` max 256 chars.

### 8.5 Comportement défensif au runtime

- Erreur de transform : log warning, unit n'émet rien, pas de crash.
- Erreur de parse JSON payload : payload pris comme string brute.
- Condition impossible à évaluer (chemin inexistant) : condition = `false`, unit n'émet rien.
- Unit en DB qui échoue la validation au boot : log warning, unit marqué inactif en mémoire (la row reste pour inspection manuelle).

### 8.6 Aucune surface d'eval

Tout est dispatché par `switch` sur des types fermés. Aucun champ utilisateur ne devient du code exécutable. La sécurité est une **propriété** du design, pas une mesure défensive ajoutée.

---

## 9. Migration de l'existant

### 9.1 Stratégie

Migration au boot dans `schema.ts` + remplacement de seed, sans étapes manuelles. Une seule version de DB connue (locale, single user).

### 9.2 Étapes d'implémentation (ordre)

1. **Schéma SQLite étendu** dans `apps/backend/src/db/schema.ts` :
   - `CREATE TABLE IF NOT EXISTS device_units (...)`.
   - `ALTER TABLE device_registry ADD COLUMN debounce_ms INTEGER` (idempotent via `PRAGMA table_info`).
   - `ALTER TABLE device_registry ADD COLUMN layout_json TEXT`.
   - Colonnes `topic_patterns` et `interpreter_type` **conservées** pendant la migration.

2. **Catalogue de presets** dans `apps/backend/src/interpreters/presets.ts`.

3. **Migration de seed dans `seedDeviceRegistry`** :
   - Détecter les rows existantes (qu'elles soient héritées du seed initial ou créées par l'utilisateur via l'UI) — toutes les rows ayant `interpreter_type` défini et **aucun unit associé** après création de `device_units`.
   - Pour chaque row, mapping `interpreter_type` → preset :
     - `'frigate'` → preset `frigate-camera` (clone des units, substitution du placeholder `{camera}` extrait du `topic_patterns[0]` ancien — ex: `frigate/principale/events` → `camera = 'principale'`).
     - `'tasmota'` → preset `tasmota-power` par défaut (POWER + RSSI, le cas le plus fréquent). L'utilisateur enrichira manuellement avec les units `tasmota-energy` ou `tasmota-dht` s'il en a besoin. Substitution de `{prefix}` et `{device_id}` extraits du `topic_patterns[0]` ancien.
     - `'wled'` → preset `wled` (substitution `{device_id}` extrait).
     - `'raw'` → preset `raw-passthrough` (single unit, `topic` = `topic_patterns[0]`).
   - Conserver le `name` original du device (l'utilisateur a pu renommer « Frigate » en « Caméra entrée »).
   - Si l'extraction du placeholder échoue (topic_pattern atypique) : créer le device sans substitution, l'utilisateur édite ensuite manuellement. Log warning au boot.

4. **Nouveau registry runtime** :
   - `apps/backend/src/interpreters/registry.ts` (remplace `dynamic.ts`).
   - `apps/backend/src/interpreters/aggregator.ts` (nouveau).
   - `apps/backend/src/interpreters/eval.ts` (évaluation d'un unit : json_path, condition, transform).

5. **Câblage `apps/backend/src/index.ts`** : substitution `createDynamicRegistry` → `createUnitRegistry`, ajout du `aggregator`, modification de `deviceKey` et `getDebounce`.

6. **Tests de parité** : `apps/backend/src/interpreters/parity.test.ts` (cf. §10).

7. **Routes API étendues** :
   - `GET /api/presets` (nouveau).
   - `POST /api/registry` : accepte `{ name, debounce_ms?, layout?, units: UnitInput[] }`. Refactorisation de `registry-routes.ts`.
   - `GET /api/registry` : retourne devices avec leurs units joints.
   - `PATCH /api/registry/:id` (nouveau) : édition d'un device existant (units add/update/delete).

8. **Suppression du code obsolète** (commit séparé une fois la nouvelle pipeline tournée) :
   - `apps/backend/src/interpreters/frigate.ts`
   - `apps/backend/src/interpreters/wled.ts`
   - `apps/backend/src/interpreters/tasmota.ts`
   - `apps/backend/src/interpreters/raw.ts`
   - L'ancien `apps/backend/src/interpreters/dynamic.ts`
   - L'ancien `apps/backend/src/interpreters/index.ts` (`DEFAULT_INTERPRETERS`).
   - Colonnes `topic_patterns` et `interpreter_type` de `device_registry` (recréation de table SQLite via `CREATE TABLE _new` → `INSERT SELECT` → `DROP` → `RENAME`).

9. **Frontend (différé jusqu'au merge du chantier topics-tree, cf. §11)** :
   - Création des widgets et `GenericDeviceCard`.
   - Adaptation de `app/page.tsx` et `app/devices/page.tsx`.
   - Suppression des cards spécialisées.

### 9.3 Décomposition de référence — preset `frigate-camera`

```ts
{
  key: 'frigate-camera',
  name: 'Caméra Frigate',
  description: 'Détection d\'objets avec zones',
  debounce_ms: 300,
  layout: null,
  placeholders: ['camera'],
  units: [
    {
      position: 0, name: 'Objet détecté',
      topic_pattern: 'frigate/{camera}/events',
      json_path: 'after.label',
      condition: null,
      transform: { type: 'passthrough' },
      output_field: 'object', output_type: 'string',
      display: { label: 'Objet', icon: 'User' }
    },
    {
      position: 1, name: 'Zone',
      topic_pattern: 'frigate/{camera}/events',
      json_path: 'after.current_zones',
      condition: null,
      transform: { type: 'array_first' },
      output_field: 'zone', output_type: 'string',
      display: { label: 'Zone', icon: 'Camera' }
    },
    {
      position: 2, name: 'Confiance',
      topic_pattern: 'frigate/{camera}/events',
      json_path: 'after.score',
      condition: null,
      transform: { type: 'round', decimals: 2 },
      output_field: 'confidence', output_type: 'number',
      display: { label: 'Confiance' }
    },
    {
      position: 3, name: 'Caméra',
      topic_pattern: 'frigate/{camera}/events',
      json_path: 'after.camera',
      condition: null,
      transform: { type: 'passthrough' },
      output_field: 'camera', output_type: 'string',
      display: { label: 'Caméra' }
    },
    {
      position: 4, name: 'État détection',
      topic_pattern: 'frigate/{camera}/events',
      json_path: 'type',
      condition: null,
      transform: { type: 'enum_map', map: { new: true, end: false }, default: false },
      output_field: 'active', output_type: 'boolean',
      display: { label: 'Active', on_label: 'En cours', off_label: 'Terminée' }
    },
    {
      position: 5, name: 'Type d\'événement',
      topic_pattern: 'frigate/{camera}/events',
      json_path: 'type',
      condition: null,
      transform: { type: 'enum_map', map: { new: 'detection_start', end: 'detection_end' } },
      output_field: 'event_type', output_type: 'string',
      display: null
    }
  ]
}
```

Replay du payload `{type:'new', after:{label:'person', camera:'chambre', current_zones:['bureau'], score:0.876}}` → produit :
```json
{ "object":"person", "zone":"bureau", "confidence":0.88,
  "camera":"chambre", "active":true, "event_type":"detection_start" }
```
Parité exacte avec l'ancien `frigate.ts` ✓.

Décompositions équivalentes pour `wled`, `tasmota-power`, `tasmota-energy`, `tasmota-dht` à détailler dans le plan d'implémentation.

### 9.4 Cas brief « personne dans bureau » (non-preset)

Ce cas n'est **pas** un preset — c'est la démonstration d'expressivité custom. Il est documenté comme exemple dans la spec (cf. §4.1) et inclus en exemple de configuration dans le frontend (placeholder dans le formulaire d'ajout d'unit). L'utilisateur le crée manuellement en partant du preset Frigate puis en remplaçant les units par celui de la §4.1.

---

## 10. Tests

### 10.1 Tests unitaires

- `eval.test.ts` : évaluation d'un unit isolé (json_path, condition, transform) avec ~30 cas couvrant chaque type de transform et chaque opérateur de condition.
- `aggregator.test.ts` : merge persistant, gestion d'`event_type`, hydratation Redis.
- `validate.test.ts` : refus de configs invalides, acceptation de configs valides, messages d'erreur explicites.

### 10.2 Tests de parité (`parity.test.ts`)

Pour chaque preset reproductible, un payload réel typique est rejoué dans :
- l'ancien interpréteur (importé tant qu'il existe),
- le nouveau pipeline (preset → units → eval → aggregator).

Assert : égalité stricte du `state` final (champs et valeurs) et du `event_type`.

Cas couverts :
- Frigate `new` (`detection_start`).
- Frigate `end` (`detection_end`).
- Tasmota STATE avec `POWER=ON`.
- Tasmota STATE avec `POWER2=ON` (multi-relais).
- Tasmota SENSOR avec `ENERGY`.
- Tasmota SENSOR avec `AM2301` (température/humidité).
- WLED `v` avec couleur + brightness.

**Changement sémantique assumé** : l'ancien `frigate.ts` ignorait les payloads `type='update'` (`return null`). Le nouveau preset `frigate-camera` les **laisse passer** : chaque `update` reçu met à jour `object`, `zone`, `confidence` dans le state du device. `event_type` n'est pas modifié par les `update` (le mapping ne contient pas la clé `update` et `default` n'est pas spécifié, donc `event_type` reste à sa dernière valeur). Cette différence est volontaire : voir la confiance évoluer en continu pendant une détection est une amélioration UX, pas une régression. Les tests de parité §10.2 ne couvrent donc pas le cas `update`.

Si un utilisateur veut le comportement strict de l'ancien code (filtrer les `update`), il peut ajouter une condition `{ path: 'type', op: 'neq', value: 'update' }` sur chacun de ses units Frigate. C'est documenté mais pas le défaut du preset.

Ces tests sont **supprimés** après la suppression des anciens interpréteurs (perte de la référence de comparaison) — mais ils ont servi à prouver la parité au moment du switch.

### 10.3 Tests d'intégration (`integration.test.ts`)

- POST `/api/registry` avec config valide → device créé + units créés en DB.
- POST avec config invalide → 400 + message clair.
- DELETE `/api/registry/:id` → cascade des units.
- Route MQTT simulée → DeviceState produit conforme.

---

## 11. Dépendances et zones interdites

### 11.1 Chantier topics-tree en cours

Le plan [`2026-05-31-topics-tree.md`](../plans/2026-05-31-topics-tree.md) modifie :
- `apps/frontend/src/app/page.tsx`
- `apps/frontend/src/app/devices/page.tsx`
- Supprime `apps/frontend/src/components/devices/DiscoveredCard.tsx`
- Crée `mqtt-matcher.ts`, `topics-tree.ts`, `TopicNode.tsx`, `TopicsTree.tsx` (et leurs tests).

Toutes les modifications frontend de la présente spec — `GenericDeviceCard`, widgets, dropdown de presets, formulaire d'units, suppression des cards spécialisées — sont **différées jusqu'au merge du chantier topics-tree**. Le plan d'implémentation correspondant placera ces tâches dans une phase postérieure clairement marquée.

### 11.2 Implémentation backend en parallèle

Les modifications backend (schéma SQLite, presets, registry, aggregator, validate, routes API) peuvent commencer immédiatement, en parallèle du chantier topics-tree. Aucun conflit attendu.

### 11.3 Ordre d'implémentation recommandé

1. **Phase backend** : tables + types + eval + aggregator + presets + parity tests + routes API étendues. Migration au boot. Tests verts. Pipeline runtime substituée.
2. **Attente** : merge du chantier topics-tree dans Main.
3. **Phase frontend** : widgets + `GenericDeviceCard` + intégration dans `app/page.tsx` et `app/devices/page.tsx` (sur la base post-topics-tree). Suppression des cards spécialisées.
4. **Phase cleanup** : suppression des anciens interpréteurs hardcoded, suppression des colonnes obsolètes du registry.

---

## 12. Critères de réussite (rappel du brief)

- ✅ L'utilisateur peut, depuis l'UI, ajouter un device sur un topic inconnu et configurer son interprétation sans toucher au code TypeScript. **Couvert par §6 et §7.**
- ✅ Les 3 interpréteurs hardcoded (Frigate, WLED, Tasmota) peuvent être reproduits par config — preuve par tests de parité. **Couvert par §9.3 et §10.2.**
- ✅ Le cas « détection personne dans zone préconfigurée Frigate » est exprimable via la config seule. **Couvert par §4.1.**
- ✅ La spec couvre modèle de données, format de config, exécution, validation, stockage, rendu frontend, migration de l'existant. **§3 à §9.**
- ✅ Pas de régression sur le pipeline runtime (debounce / dedup / broadcast). **§5.4 : modifications minimales, debounce/dedup/broadcast inchangés.**

---

## 13. Hors scope

- UI de customisation du `LayoutDescriptor` (le champ existe en DB mais l'éditeur visuel n'est pas implémenté).
- Conditions composées AND/OR (extension non-cassante du schéma `Condition` si un cas réel le réclame).
- Édition d'unit individuel via UI (la première itération recrée tout le device si besoin de re-config — édition fine à itérer si la friction se ressent).
- Bibliothèque de presets gérable depuis l'UI (les presets restent versionnés en code).
- Migration multi-environnements (single user / single DB).
