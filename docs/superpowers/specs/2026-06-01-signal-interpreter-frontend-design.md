# Signal Interpreter — Phase B Frontend Design

**Date :** 2026-06-01
**Statut :** Validé (brainstorming)
**Plan d'implémentation :** à générer via `writing-plans`
**Dépendance :** backend Phase A mergé sur Main (units, presets, nouveau modèle registry)

---

## Contexte

Le backend a été migré vers un système configurable basé sur des « units » composables (Phase A). Le frontend utilise encore l'ancien modèle : `interpreter_type` (frigate/wled/tasmota/raw), cards spécialisées hardcodées, formulaire avec dropdown de type. Cette phase aligne le frontend sur le nouveau modèle backend.

## Objectif

1. Remplacer les cards spécialisées par une `GenericDeviceCard` pilotée par les units du device.
2. Remplacer le formulaire d'ajout par un sélecteur de preset avec éditeur de units.
3. Ajouter un bouton Éditer sur les devices existants.
4. Mettre à jour la couche API cliente pour le nouveau modèle.

## Critères de réussite

- Le dashboard affiche tous les devices via `GenericDeviceCard` sans aucune référence à `interpreter_type`.
- Le formulaire permet de créer un device depuis un preset, de remplir les placeholders, d'éditer les units (topic_pattern, output_field), et de soumettre.
- Un device existant peut être édité via un bouton "Éditer" qui charge ses units dans le même formulaire.
- `npx tsc --noEmit` passe sans erreur dans `apps/frontend`.
- Aucun test Vitest existant ne régresse.

---

## Section 1 — Couche données (`registry-api.ts`)

Réécriture complète du fichier. Les anciens types (`interpreter_type`, `topic_patterns`) sont supprimés.

### Types

```ts
export interface Unit {
  id: number
  device_id: number
  position: number
  name: string
  topic_pattern: string
  json_path: string | null
  condition: object | null
  transform: object
  output_field: string
  output_type: 'boolean' | 'number' | 'string' | 'color' | 'enum'
  display: {
    label?: string
    icon?: string
    unit?: string
    min?: number
    max?: number
    on_label?: string
    off_label?: string
  } | null
}

export type UnitInput = Omit<Unit, 'id' | 'device_id'>

export interface RegistryDevice {
  id: number
  name: string
  debounce_ms: number | null
  layout: {
    groups?: { title?: string; fields: string[] }[]
    hidden?: string[]
  } | null
  units: Unit[]
  active: boolean
  created_at: number
}

export interface DevicePayload {
  name: string
  debounce_ms?: number | null
  layout?: object | null
  units: UnitInput[]
}

export interface Preset {
  key: string
  name: string
  description: string
  debounce_ms: number | null
  placeholders: string[]
  units: UnitInput[]
}

export interface TopicSeen {
  topic: string
  first_seen: number
  last_seen: number
  message_count: number
  detected_type: string | null
}
```

### Fonctions

```ts
fetchRegistry(): Promise<RegistryDevice[]>       // GET /api/registry
fetchTopicsSeen(sinceSeconds?: number): Promise<TopicSeen[]>  // GET /api/topics
fetchPresets(): Promise<Preset[]>                // GET /api/presets
addDevice(payload: DevicePayload): Promise<number>  // POST /api/registry
patchDevice(id: number, payload: DevicePayload): Promise<void>  // PATCH /api/registry/:id
removeDevice(id: number): Promise<void>          // DELETE /api/registry/:id
```

`addDevice` envoie désormais `{ name, debounce_ms, units }` au lieu de `{ name, topic_patterns, interpreter_type }`.

### Utilitaire client

```ts
export function applyPresetClient(
  preset: Preset,
  vars: Record<string, string>,
): UnitInput[]
```

Remplace `{placeholder}` dans `topic_pattern` et `json_path` de chaque unit. Environ 5 lignes, regex `/{(\w+)}/g`. Même logique que le backend, pas de dépendance partagée.

---

## Section 2 — Widgets, icônes, `GenericDeviceCard`

### `components/devices/icons.ts`

Whitelist des icônes lucide utilisées dans les presets. Toute icône absente de cette liste est silencieusement ignorée (pas d'erreur).

```ts
import { User, Camera, Lightbulb, Sun, Plug, Zap, Thermometer } from 'lucide-react'

export const ICON_MAP = { User, Camera, Lightbulb, Sun, Plug, Zap, Thermometer }

export function getIcon(name: string | null | undefined): React.ComponentType<{ className?: string }> | null {
  if (!name || !(name in ICON_MAP)) return null
  return ICON_MAP[name as keyof typeof ICON_MAP]
}
```

### Widgets (`components/devices/widgets/`)

Chaque widget reçoit `value: unknown` et les champs `display` pertinents. Si `value` est `undefined` ou `null`, le widget retourne `null` (pas rendu).

| Fichier | `output_type` | Rendu |
|---|---|---|
| `BooleanIndicator.tsx` | `boolean` | Icône colorée (vert/gris) + `on_label`/`off_label` |
| `NumericValue.tsx` | `number` | Nombre formaté + `unit` (ex: `W`, `°C`) ; barre progress si `min`/`max` définis |
| `TextField.tsx` | `string` | Texte tronqué à 80 chars avec `title` natif pour le complet |
| `ColorSwatch.tsx` | `color` | Cercle coloré (css `background`) + valeur hex en `font-mono` |
| `EnumBadge.tsx` | `enum` | `Badge` shadcn `variant="secondary"` avec la valeur string |

### `GenericDeviceCard`

Props : `device: RegistryDevice`, `state: FrontendDeviceState | undefined`

Rendu :
1. Wrapper `DeviceCard` existant — titre = `device.name`, timestamp depuis `state?.timestamp`.
2. Si `device.layout?.groups` défini : afficher les groupes avec titre `CardTitle` de taille réduite, chaque `output_field` du groupe → lookup dans `device.units` → widget.
3. Sinon : itérer `device.units` triés par `position` → widget par unit.
4. Lookup valeur : `state?.state[unit.output_field]` — si `undefined`, widget non rendu.
5. Chaque champ affiché : label à gauche (`unit.display?.label ?? unit.name`), icône optionnelle via `getIcon`, widget à droite.

---

## Section 3 — Dashboard `page.tsx`

### Avant

```ts
function renderDevice(device: RegistryDevice): React.ReactNode[] {
  if (device.interpreter_type === 'frigate') { ... }
  if (device.interpreter_type === 'wled') { ... }
  // ...
}
{registry.filter(d => d.active).flatMap(renderDevice)}
```

### Après

```ts
{registry.filter(d => d.active).map(device => (
  <GenericDeviceCard
    key={device.id}
    device={device}
    state={devices[`device:${device.id}`]}
  />
))}
```

Le store Zustand utilise `source` comme clé. Le backend émet `source: "device:${id}"` depuis la Task 13. Le lookup est donc direct, sans ambiguïté.

Suppressions dans ce fichier : imports `FrigateCard`, `WledCard`, `TasmotaCard`, `GenericCard`, fonction `renderDevice`.

---

## Section 4 — Formulaire `devices/page.tsx`

### État du formulaire

```ts
type FormMode = 'add' | 'edit'
type FormStep = 'preset' | 'placeholders' | 'units'

// état local dans DevicesContent
mode: FormMode                           // 'add' par défaut
editingId: number | null                 // id du device en cours d'édition
step: FormStep                           // étape courante
name: string
selectedPreset: Preset | null
placeholderValues: Record<string, string>
units: UnitInput[]
formError: string | null
```

### Étape 1 — Sélection du preset (`step === 'preset'`)

- Champ Nom (input texte).
- Dropdown des presets chargé via `fetchPresets()` au mount.
- Bouton "Suivant" → si preset sans placeholders : génère les units immédiatement et passe à `'units'` ; sinon passe à `'placeholders'`.

### Étape 2 — Placeholders (`step === 'placeholders'`)

- Un champ par entrée dans `preset.placeholders` (ex: `camera`, `device_id`, `prefix`).
- Bouton retour → `'preset'`.
- Bouton "Générer les units" → appelle `applyPresetClient(preset, placeholderValues)` → `setUnits(result)` → `step = 'units'`.

### Étape 3 — Éditeur de units (`step === 'units'`)

Liste des units avec pour chaque unit :
- `topic_pattern` : `<input>` éditable, `font-mono`.
- `output_field` : `<input>` éditable.
- Champs lecture seule : transform type, json_path (affichés en `text-muted-foreground text-xs`).
- Bouton supprimer (icône `Trash2`).

En bas de la liste :
- Bouton "Ajouter un unit" → ajoute un unit vide avec `transform: { type: 'passthrough' }`, `output_type: 'string'`.
- Bouton "Reset au preset" → recalcule `applyPresetClient(preset, placeholderValues)` et remplace `units`.
- Bouton "Enregistrer" → `addDevice` (mode add) ou `patchDevice(editingId, …)` (mode edit) → reset formulaire.

### Mode édition

Bouton "Éditer" sur chaque device de la liste de gauche :
- `mode = 'edit'`, `editingId = device.id`.
- `name = device.name`.
- `units = device.units.map(u => ({ position: u.position, name: u.name, … }))` (strip `id` et `device_id`).
- `selectedPreset = null` (on ne tente pas de détecter le preset d'origine).
- `step = 'units'` directement.

Le formulaire affiche "Modifier le device" au lieu de "Ajouter un device".

---

## Section 5 — Structure des fichiers

### Nouveaux fichiers

```
apps/frontend/src/
  components/devices/
    icons.ts
    GenericDeviceCard.tsx
    widgets/
      BooleanIndicator.tsx
      NumericValue.tsx
      TextField.tsx
      ColorSwatch.tsx
      EnumBadge.tsx
```

### Fichiers modifiés

```
apps/frontend/src/
  lib/registry-api.ts          réécriture complète
  app/page.tsx                 remplace renderDevice + imports
  app/devices/page.tsx         nouveau formulaire multi-étapes
```

### Fichiers supprimés

```
apps/frontend/src/components/devices/
  FrigateCard.tsx
  WledCard.tsx
  TasmotaCard.tsx
  GenericCard.tsx
```

---

## Tests

Pas de nouveaux tests Vitest. Les widgets et `GenericDeviceCard` sont de la logique de présentation pure. `applyPresetClient` est triviale (~5 lignes). La vérification se fait via :

```bash
cd apps/frontend && npx tsc --noEmit
cd apps/frontend && npx vitest run
```

Attendu : aucune erreur TypeScript, aucune régression sur la suite existante.

---

## Commandes de vérification

```bash
cd apps/frontend && npx tsc --noEmit
cd apps/frontend && npx vitest run
```
