# Design — Registre dynamique de devices MQTT

**Date :** 2026-05-31  
**Scope :** Découverte progressive des topics MQTT et gestion des devices sans modifier le code

---

## Contexte et problème

L'application Signal Room écoute des capteurs (Frigate, Tasmota, WLED) via MQTT. Aujourd'hui, ajouter un nouvel équipement exige de toucher au code : écrire un interpréteur, hardcoder les topics, ajouter une carte dans le dashboard.

Objectif : permettre d'ajouter un device depuis l'UI, sans redémarrage ni modification de code.

Contrainte fondamentale : MQTT n'a pas de commande native pour lister les topics d'un broker. Frigate et Tasmota sont des firmwares tiers que l'on ne contrôle pas. Une fenêtre de scan de N secondes raterait les topics silencieux. La solution est donc un **catalogue progressif** : on enregistre chaque topic vu, et la liste se construit naturellement dans le temps.

---

## Architecture générale

Le client MQTT souscrit à `#` (wildcard total) dès le démarrage, à la place de la liste actuelle de topics spécifiques.

Chaque message entrant passe par deux étapes en séquence :

1. **Catalogue passif** — upsert dans `topics_seen` : insert si topic inconnu, update `last_seen` + `message_count` si connu. Non bloquant : une erreur ici ne stoppe pas le pipeline.

2. **Traitement actif** — le topic est comparé aux entrées actives du `DeviceRegistry` chargé en mémoire. Si une entrée correspond → interpréteur → broadcast WebSocket + persistance SQLite + Redis. Sinon → ignoré.

L'`InterpreterRegistry` actuel (hardcodé) est remplacé par un `DeviceRegistry` dynamique chargé depuis SQLite. Au premier lancement, si la table `device_registry` est vide, les trois devices existants (Frigate, Tasmota, WLED) sont insérés comme seed.

Ajouter un device via l'UI = écriture en base + mise à jour du registre en mémoire. Aucune nouvelle souscription MQTT n'est nécessaire : le message arrive déjà via `#`.

---

## Schéma de base de données

### `topics_seen` — catalogue passif

```sql
CREATE TABLE IF NOT EXISTS topics_seen (
  topic         TEXT    PRIMARY KEY,
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 1,
  detected_type TEXT    -- 'frigate' | 'tasmota' | 'wled' | null
);
```

`detected_type` est renseigné si un interpréteur existant reconnaît le topic lors du premier message reçu.

### `device_registry` — devices configurés

```sql
CREATE TABLE IF NOT EXISTS device_registry (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  topic_patterns   TEXT    NOT NULL,  -- JSON array, ex: '["tele/+/STATE","tele/+/SENSOR"]'
  interpreter_type TEXT    NOT NULL CHECK(interpreter_type IN ('frigate','tasmota','wled','raw')),
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL
);
```

`topic_patterns` est un JSON array de strings. Chaque pattern supporte les wildcards MQTT standard (`+` pour un segment, `#` pour tout ce qui suit). Le matching en mémoire utilise une fonction `mqttTopicMatches(pattern, topic)` implémentée côté backend — la même logique que le broker : `+` correspond à exactement un segment, `#` correspond à zéro ou plusieurs segments en fin de pattern.

### Seed au premier lancement

Si `device_registry` est vide au démarrage :

| name | topic_patterns | interpreter_type |
|---|---|---|
| Frigate | `["frigate/+/events"]` | frigate |
| Tasmota | `["tele/+/STATE","tele/+/SENSOR","stat/+/RESULT"]` | tasmota |
| WLED | `["wled/+/v"]` | wled |

---

## API backend

Endpoints ajoutés au serveur Fastify existant.

### Catalogue de topics

```
GET /api/topics?since=<secondes>
```

Retourne les topics vus, triés par `last_seen` DESC. Le paramètre `since` est optionnel ; s'il est fourni, filtre les topics dont `last_seen >= now - since`.

```json
{
  "topics": [
    {
      "topic": "tele/bureau/STATE",
      "first_seen": 1748650000,
      "last_seen": 1748736400,
      "message_count": 142,
      "detected_type": "tasmota"
    }
  ]
}
```

### Registre des devices

```
GET /api/registry
→ { "devices": [...] }

POST /api/registry
body: { "name": string, "topic_patterns": string[], "interpreter_type": "frigate"|"tasmota"|"wled"|"raw" }
→ 201 { "id": number }
  Erreurs : 400 si interpreter_type invalide, topic_patterns vide, ou champs manquants

DELETE /api/registry/:id
→ 204
  Erreurs : 404 si id inexistant
```

`POST /api/registry` met à jour le `DeviceRegistry` en mémoire immédiatement après l'écriture en base. `DELETE` retire l'entrée du registre en mémoire.

---

## Interpréteur `raw`

Nouvel interpréteur minimal qui implémente l'interface `Interpreter` existante. Il accepte n'importe quel topic et retourne le payload JSON brut sans transformation métier :

```typescript
{
  source: 'raw',
  event_type: 'raw_message',
  state: { payload: <parsed JSON ou string si non-JSON> },
  raw: <payload string>,
  timestamp: Date.now()
}
```

---

## Frontend

### Dashboard `/`

Le dashboard n'a plus de cards hardcodées. Il charge :
- `/api/registry` → devices configurés et actifs
- `/api/topics?since=86400` → topics vus dans les 24h

Il affiche deux sections :

**Devices configurés** — une card par entry du registre, sélectionnée selon `interpreter_type` :
- `frigate` → `FrigateCard` (existante)
- `tasmota` → `TasmotaCard` (existante)
- `wled` → `WledCard` (existante)
- `raw` → `GenericCard` (nouvelle)

**Topics découverts** — topics présents dans `topics_seen` (filtrés sur 24h) mais absents du registre configuré. Chaque topic est affiché via une `DiscoveredCard` :
- Nom du topic
- Dernier payload JSON reçu (formaté)
- Timestamp du dernier message
- Bouton "Configurer" → navigue vers `/devices` avec le topic pré-rempli

### Page `/devices`

Nouvelle page de gestion :
- Liste des entries de `/api/registry` (nom, type, topic pattern, bouton supprimer)
- Formulaire d'ajout : champ topic pattern (texte libre ou sélection depuis `/api/topics`), nom, type d'interpréteur
- La liste `/api/topics` pour le sélecteur est chargée à la demande (pas en temps réel)

Navigation : lien "Devices" ajouté dans le header existant, à côté du bouton "Historique".

### `GenericCard`

Card minimaliste pour les devices `raw` : nom du device, topic, dernier payload JSON formaté dans un bloc code, timestamp.

### `DiscoveredCard`

Card pour les topics non configurés : topic, `detected_type` si disponible, `message_count`, `last_seen`, bouton "Configurer".

---

## Gestion des erreurs

**Backend :**
- Upsert `topics_seen` échoue → log, pipeline continue
- `parse()` d'un interpréteur lève une exception → log + `null`, message ignoré
- `POST /api/registry` avec `interpreter_type` invalide → 400
- `DELETE /api/registry/:id` inexistant → 404
- Device configuré dont le topic ne reçoit plus de messages → Redis contient le dernier état connu, la card s'affiche en "En attente de données" sans planter

**Frontend :**
- `/api/topics` inaccessible → message d'erreur dans le sélecteur, saisie manuelle toujours possible
- Device dans le registre sans état Redis correspondant → card affichée en état "En attente de données"

---

## Tests à ajouter

- `topics_seen` upsert : insert pour nouveau topic, update pour topic existant (message_count incrémenté)
- `DeviceRegistry` : ajout en mémoire reflété immédiatement dans le routing ; suppression retire le device du traitement
- `rawInterpreter` : retourne le payload sans transformation, accepte JSON valide et string brute
- Seed : Frigate/Tasmota/WLED insérés uniquement si `device_registry` est vide
- `GET /api/topics?since=86400` : filtre correct sur `last_seen`

Les tests existants (interpreters, pipeline, WS server) ne changent pas — l'interface `Interpreter` reste identique.
