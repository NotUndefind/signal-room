# Signal Room — Design Spec

**Date** : 2026-05-25
**Statut** : validé

---

## 1. Contexte et objectif

Signal Room est un dashboard d'observation pour une chambre connectée. L'objectif n'est pas l'automatisation mais la compréhension en temps réel de ce que le système détecte et reçoit.

Les sources d'information transitent par MQTT :
- **Frigate** — caméra, détections de présence
- **WLED** — lampes LED, état lumineux
- **Tasmota** — équipements connectés (prises, capteurs, interrupteurs)

L'application est une couche d'observation et d'interprétation, pas une boîte d'automatisation.

---

## 2. Stack technique

| Composant | Technologie |
|---|---|
| Backend | Fastify + TypeScript |
| Frontend | Next.js + TypeScript |
| Temps réel | WebSocket (Fastify server / Next.js client) |
| Session courante | Redis 7 |
| Historique persistant | SQLite + better-sqlite3 (WAL mode) |
| UI | Tailwind CSS + shadcn/ui + Motion + Lucide |
| State frontend | Zustand |
| Data fetching | TanStack Query (REST) |
| Déploiement | Docker + docker-compose |

---

## 3. Architecture globale

### Structure du monorepo

```
signal-room/
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── mqtt/          # client MQTT + routing topics
│   │   │   ├── interpreters/  # frigate.ts, wled.ts, tasmota.ts
│   │   │   ├── pipeline/      # dedup, debounce, session tracking
│   │   │   ├── store/         # Redis client + in-memory Map
│   │   │   ├── db/            # SQLite schema, queries
│   │   │   ├── ws/            # WebSocket server Fastify
│   │   │   └── api/           # routes REST (history, search)
│   │   ├── Dockerfile
│   │   └── package.json
│   └── frontend/
│       ├── src/
│       │   ├── app/           # Next.js App Router
│       │   ├── components/    # cartes device, timeline, filtres
│       │   ├── store/         # Zustand
│       │   └── lib/           # WebSocket client, api helpers
│       ├── Dockerfile
│       └── package.json
├── docker-compose.yml
├── docker-compose.dev.yml
└── package.json               # scripts racine uniquement
```

### Deux chemins de données séparés

```
MQTT Broker
    │
    ▼
[MQTT Client] (Fastify)
    │
    ▼
[Parser/Interpréteur]
    │
    ├──► [Déduplication] ──► [In-memory Map] ──► [WebSocket push] → Frontend
    │         └─ état inchangé → DROP
    │
    ├──► [Redis]   (état session courante, chargé à la connexion frontend)
    └──► [SQLite]  (historique persistant, écriture async non-bloquante)
```

**Règle fondamentale** : SQLite n'est jamais dans le chemin WebSocket. La persistance ne bloque pas le broadcast temps réel.

**Rôle distinct de l'in-memory Map et Redis** : la Map Node.js sert uniquement à la déduplication (comparaison ultra-rapide sans appel réseau). Redis stocke l'état courant pour le servir aux clients qui se connectent — y compris après un redémarrage du backend.

---

## 4. Pipeline de données

### Filtrage

Deux niveaux :

1. **Déduplication d'état** — on ne broadcast et n'écrit en base que si l'état interprété a changé par rapport à l'état en mémoire. Élimine le bruit de répétition.
2. **Debounce par source** — configurable par device. Par défaut 300ms pour Frigate (source haute fréquence lors des détections).

### Interface commune des interpréteurs

```typescript
interface Interpreter {
  source: string
  topics: string[]
  parse(topic: string, payload: Buffer): DeviceState | null
}

interface DeviceState {
  source: string
  event_type: string
  state: Record<string, unknown>
  raw: string
}
```

`null` = message à ignorer (heartbeat, topic non pertinent).

**Ajout d'une nouvelle source** : créer `interpreters/mon-device.ts` qui implémente `Interpreter` et l'enregistrer dans `interpreters/index.ts`. Le pipeline MQTT souscrit automatiquement aux topics déclarés. Le dashboard s'adapte dynamiquement : chaque source enregistrée obtient une carte et apparaît dans les filtres de l'historique sans modification du reste du code.

Frigate, WLED et Tasmota sont les trois sources initiales. L'architecture n'est pas limitée à ces sources.

---

## 5. Interpréteurs initiaux

### Frigate

**Topics** : `frigate/+/events`, `frigate/+/state`, `frigate/stats`

**État produit** :
```typescript
{
  source: "frigate",
  event_type: "detection_start" | "detection_end",
  state: {
    object: "person",
    zone: "chambre",
    confidence: 0.92,
    camera: "chambre_cam",
    session_id: "abc123"
  }
}
```

Les détections sont sessionisées : une session = un début + une fin. Pas d'écriture par frame. Résultat : ~2 lignes SQLite par détection.

### WLED

**Topics** : `wled/+/v`, `wled/+/c`

**État produit** :
```typescript
{
  source: "wled",
  event_type: "state_change",
  state: {
    power: true,
    brightness: 80,
    color: "#FF4400",
    effect: "Rainbow",
    palette: "Default"
  }
}
```

### Tasmota

**Topics** : `stat/+/RESULT`, `tele/+/SENSOR`, `tele/+/STATE`

Détection automatique du type de device selon le payload :

```typescript
{
  source: "tasmota",
  device_id: "prise_bureau",
  event_type: "power_update",
  state: {
    power: true,
    watt: 45.2,
    kwh_today: 0.31
  }
}
```

---

## 6. Modèle de données

### Redis — État session courante

```
device:frigate      → { zone, person, confidence, last_seen }
device:wled         → { power, color, brightness, effect }
device:tasmota:<id> → { power, watt, temp, ... }
```

À la connexion du frontend, Fastify lit Redis et envoie le snapshot complet. Le client voit immédiatement l'état sans attendre le prochain message MQTT.

### SQLite — Historique persistant

```sql
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL,
  topic      TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload    TEXT NOT NULL,   -- JSON interprété
  raw        TEXT NOT NULL,   -- payload MQTT original
  created_at INTEGER NOT NULL -- timestamp Unix ms
);

CREATE TABLE device_snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL,
  state      TEXT NOT NULL,   -- JSON état complet au moment du changement
  created_at INTEGER NOT NULL
);
```

- `events` → debug granulaire, filtres par source / type / plage horaire
- `device_snapshots` → timeline visuelle ("à 14h32, la pièce avait cet état")

### Rétention

Job cron interne Fastify. Supprime les events au-delà de `RETENTION_DAYS` (défaut : 30).

### Volume estimé

| Source | Fréquence brute | Après filtre | Par jour |
|---|---|---|---|
| Frigate | ~10/s lors de détection | ~2 lignes/détection | ~50 lignes |
| WLED | À chaque changement | 1:1 | ~20 lignes |
| Tasmota | Toutes les minutes | Si valeur change | ~30 lignes |

Total réaliste : quelques centaines de lignes/jour.

---

## 7. Frontend

### Vues

**`/` — Dashboard temps réel**

État courant par device, mis à jour instantanément via WebSocket.

```
┌─────────────────────────────────────┐
│  Signal Room          [●] Connected │
├─────────────┬───────────┬───────────┤
│   Frigate   │   WLED    │  Tasmota  │
│  👤 Détecté │  ● ON     │  ⚡ 45W   │
│  Chambre    │  #FF4400  │  Prise 1  │
│  0.92       │  80%      │  ON       │
│  14h32      │  Rainbow  │  0.31kWh  │
└─────────────┴───────────┴───────────┘
```

**`/history` — Timeline & recherche**

Filtres : source, type d'événement, plage horaire.
Timeline scrollable avec events triés par date, timestamps relatifs + absolus au hover.
Pagination via TanStack Query (REST Fastify → SQLite).

### Flux WebSocket

```
WebSocket onopen  → reçoit snapshot complet depuis Redis
WebSocket onmessage → reçoit delta par device → Zustand dispatch
WebSocket onclose → indicateur "reconnecting..." + backoff exponentiel
```

À la reconnexion, Fastify renvoie automatiquement le snapshot Redis complet.

### Store Zustand

```typescript
interface RoomStore {
  devices: Record<string, DeviceState>
  connected: boolean
  lastUpdate: number
  setDevice: (source: string, state: DeviceState) => void
  setConnected: (v: boolean) => void
}
```

TanStack Query gère les appels REST (historique, recherche). WebSocket gère uniquement le temps réel. Les deux ne se mélangent pas.

---

## 8. Déploiement

### docker-compose.yml (production)

```yaml
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped

  backend:
    build: ./apps/backend
    env_file: .env
    depends_on: [redis]
    ports:
      - "3001:3001"
    volumes:
      - ./data:/data   # SQLite persisté sur le host

  frontend:
    build: ./apps/frontend
    env_file: .env
    depends_on: [backend]
    ports:
      - "3000:3000"
```

### Variables d'environnement

```env
MQTT_HOST=192.168.1.x
MQTT_PORT=1883
REDIS_URL=redis://redis:6379
DB_PATH=/data/signal-room.db
RETENTION_DAYS=30
FRIGATE_DEBOUNCE_MS=300
```

### Dev local (Mac)

```bash
# Redis uniquement en Docker
docker run -p 6379:6379 redis:7-alpine

# Backend et frontend en local
cd apps/backend && npm run dev
cd apps/frontend && npm run dev
```

---

## 9. Ce qui est hors scope (v1)

- Authentification / accès multi-utilisateur
- Alertes ou notifications push
- Support multi-pièces

## 10. Roadmap v2

- **Automatisations** — la couche d'observation v1 devient la base de règles déclenchées par les events interprétés (ex: "si Frigate détecte une personne → ajuster WLED").
