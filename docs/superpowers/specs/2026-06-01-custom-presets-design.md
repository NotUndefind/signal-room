# Custom Presets — Design Spec

**Date**: 2026-06-01  
**Branche**: `feat/custom-presets`  
**Statut**: Approuvé

---

## Problème

Les presets sont actuellement hardcodés dans `backend/src/interpreters/presets.ts`. L'utilisateur ne peut ni les modifier, ni en créer de nouveaux, ni ajuster les transforms ou labels des units générées. Pour des appareils comme WLED, dont le format réel (XML, champs `bri`, `cl`, `fx`…) diffère des valeurs par défaut du preset, il est impossible d'adapter la configuration sans toucher au code source.

---

## Objectif

Permettre à l'utilisateur de :
1. Modifier les champs d'un unit lors de la création ou de l'édition d'un device (`output_field`, `display.label`, `topic_pattern`, `json_path`, `transform`).
2. Sauvegarder la configuration courante comme preset personnalisé nommé et réutilisable.
3. Éditer ou supprimer ses presets personnalisés.

Les presets built-in (`wled`, `frigate-camera`, etc.) restent en lecture seule.

---

## Architecture générale

### Ce qui ne change pas

- Le flux 3 steps (preset → placeholders → units) reste intact.
- Les 6 presets built-in dans `presets.ts` ne sont pas modifiés.
- La logique d'évaluation (`eval.ts`, `registry.ts`) est inchangée.
- La validation des units (`validate.ts`) est réutilisée telle quelle.

### Ce qui est ajouté

- Table SQLite `custom_presets` pour persister les presets utilisateur.
- CRUD API `/api/presets/custom`.
- Éditeur d'unit dans l'étape "units" du formulaire.
- Bouton "Sauvegarder comme preset" dans l'étape "units".
- Affichage et gestion des presets custom dans l'étape "preset".

---

## Backend

### Nouvelle table : `custom_presets`

```sql
custom_presets (
  id          TEXT PRIMARY KEY,    -- uuid préfixé "custom_"
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  debounce_ms INTEGER,
  layout_json TEXT,                -- JSON nullable (LayoutDescriptor)
  units_json  TEXT NOT NULL,       -- JSON: UnitInput[]
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
)
```

Les presets custom ne supportent pas les `placeholders` : les topics sont résolus au moment de la création du preset.

### Endpoints

Les endpoints existants (`GET /api/presets`, `GET/POST/PATCH/DELETE /api/registry`) ne changent pas.

**`GET /api/presets`** est étendu : la réponse inclut désormais les presets custom.

```ts
// Avant
{ presets: Preset[] }

// Après
{
  presets: Array<
    | (Preset & { source: 'builtin' })
    | (CustomPreset & { source: 'custom' })
  >
}
```

Nouveaux endpoints :

```
POST   /api/presets/custom           → créer un preset custom
PATCH  /api/presets/custom/:id       → modifier name, description, units
DELETE /api/presets/custom/:id       → supprimer
```

### Validation

Les `units` d'un preset custom sont validées via `validateDevicePayload()` avant persistance — aucune logique de validation supplémentaire.

### Fichiers touchés

| Fichier | Changement |
|---------|-----------|
| `src/db/schema.ts` | Ajout table `custom_presets` |
| `src/db/registry.ts` | CRUD custom presets (insert, update, delete, getAll) |
| `src/api/presets-routes.ts` | Nouveaux endpoints + extension GET |

---

## Frontend

### Étape "preset" — affichage des presets custom

Les presets custom apparaissent dans la même liste que les built-in, triés après eux. Chaque preset custom affiche :
- Un badge `Custom`
- Une icône crayon → déclenche l'édition du preset
- Une icône poubelle → supprime avec confirmation

Les presets built-in n'ont pas ces actions.

### Étape "units" — éditeur d'unit

Chaque unit de la liste gagne un bouton "Modifier". Au clic, un accordion s'ouvre et expose :

| Champ | Input |
|-------|-------|
| `output_field` | Text input |
| `display.label` | Text input |
| `topic_pattern` | Text input |
| `json_path` | Text input (nullable) |
| `transform` | Select + champs dynamiques (voir ci-dessous) |

**Formulaire transform structuré** — les champs affichés dépendent du type sélectionné :

| Type | Champs |
|------|--------|
| `passthrough` | Aucun |
| `scale` | `in_min`, `in_max`, `out_min`, `out_max`, `round` (optionnel) |
| `round` | `decimals` |
| `enum_map` | Paires clé→valeur (ajout/suppression dynamique), `default` |
| `rgb_to_hex` | Aucun |
| `array_first` | Aucun |
| `array_contains` | `value` |

### Étape "units" — sauvegarde comme preset

En bas de l'étape "units" :

```
[+ Ajouter un unit]   [Sauvegarder comme preset]   [Enregistrer le device]
```

Au clic "Sauvegarder comme preset" → modale :
- Champ **Nom** (pré-rempli avec le nom du device courant)
- Champ **Description** (optionnel)
- Bouton "Sauvegarder" → `POST /api/presets/custom`

### Édition d'un preset custom

Depuis l'étape "preset", clic sur l'icône crayon d'un preset custom :
- Le flux va directement à l'étape "units" avec les units du preset chargées.
- Le bouton bas de page devient "Mettre à jour le preset" → `PATCH /api/presets/custom/:id`.
- Un device existant n'est pas affecté par la mise à jour d'un preset (les units sont copiées au moment de la création).

### Fichiers touchés

| Fichier | Changement |
|---------|-----------|
| `src/app/devices/page.tsx` | Éditeur unit + save-as-preset + gestion presets custom |
| `src/lib/registry-api.ts` | Fonctions CRUD custom presets |

---

## Data flow

### Créer un device depuis un preset custom

```
GET /api/presets → { presets: [...builtin, ...custom] }
Sélection preset custom
applyPresetClient() (pas de placeholders à substituer)
→ units pré-remplies dans l'étape "units"
Utilisateur modifie les units (state local React)
POST /api/registry { name, units }
→ validateDevicePayload() → INSERT device_registry + device_units
→ UnitRegistry.addDevice() (mise à jour en mémoire)
```

### Sauvegarder un preset custom

```
Étape "units" → clic "Sauvegarder comme preset"
Modale → nom + description
POST /api/presets/custom { name, description, units }
→ validateDevicePayload() → INSERT custom_presets
→ Invalidation du cache fetch presets côté frontend
```

### Modifier un preset custom

```
Étape "preset" → clic crayon preset custom
→ étape "units" avec units du preset chargées
Utilisateur édite
PATCH /api/presets/custom/:id { name, description, units }
→ UPDATE custom_presets
⚠ Les devices déjà créés depuis ce preset ne sont pas mis à jour
```

---

## Critères de réussite

- [ ] L'utilisateur peut modifier `output_field`, `display.label`, `topic_pattern`, `json_path` et `transform` sur n'importe quel unit lors de la création ou de l'édition d'un device.
- [ ] L'utilisateur peut sauvegarder la configuration courante comme preset custom nommé.
- [ ] Les presets custom apparaissent dans la liste aux côtés des presets built-in.
- [ ] L'utilisateur peut éditer un preset custom existant.
- [ ] L'utilisateur peut supprimer un preset custom.
- [ ] Les presets built-in restent en lecture seule.
- [ ] Modifier un preset custom ne modifie pas les devices déjà créés depuis ce preset.
- [ ] Tous les devices et presets passent par la même validation (`validateDevicePayload`).

---

## Hors périmètre

- Partage de presets entre utilisateurs.
- Import/export de presets.
- Versionning des presets.
- Modification en live des devices existants depuis un preset.
