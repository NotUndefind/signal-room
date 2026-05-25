# Signal Room — État du projet

**Dernière mise à jour :** 2026-05-25
**Branche :** Main

---

## Ce qui est fait

### Infrastructure monorepo

- npm workspaces : `apps/backend` + `apps/frontend`
- Scripts racine : `dev:backend`, `dev:frontend`, `test:backend`, `test:frontend`
- `.env.example` avec toutes les variables (MQTT, Redis, SQLite, ports, rétention, debounce)
- Docker : Dockerfiles multi-stage pour backend et frontend, `docker-compose.yml` prod, `docker-compose.dev.yml` (Redis seul)
- Dossier `data/` pour SQLite, ignoré par git sauf `.gitignore`

### Backend (`apps/backend/`)

**Config**
- `src/config.ts` — `loadConfig()` lit toutes les variables d'env avec valeurs par défaut

**Interpréteurs MQTT**
- `interpreters/types.ts` — interfaces `DeviceState` et `Interpreter`
- `interpreters/frigate.ts` — parse `frigate/+/events` : `new` → `detection_start`, `end` → `detection_end`, `update` → ignoré. Debounce 300ms hardcodé.
- `interpreters/wled.ts` — parse `wled/+/v` : power, brightness (0–100%), couleur hex, effect_id, palette_id
- `interpreters/tasmota.ts` — parse `tele/+/STATE` (power on/off + RSSI) et `tele/+/SENSOR` (énergie : watt/voltage/kwh, ou capteurs : température/humidité)
- `interpreters/index.ts` — `createInterpreterRegistry` : agrège topics, route messages, expose debounceMs par source. `DEFAULT_INTERPRETERS` = [frigate, wled, tasmota]

**Pipeline**
- `pipeline/dedup.ts` — `createDedupStore` : Map mémoire, compare `JSON.stringify(state.state)` pour détecter les changements
- `pipeline/debounce.ts` — `createDebounce(ms)` : timers indépendants par clé source

**Stockage**
- `store/redis.ts` — `createRedisStore` : `setDeviceState`, `getDeviceState`, `getAllDeviceStates`, `quit`. Préfixe clé `device:`
- `db/client.ts` — `createDb(path)` : WAL mode + foreign keys
- `db/schema.ts` — tables `events` et `device_snapshots` + index sur source et created_at
- `db/queries.ts` — `insertEvent`, `insertSnapshot`, `queryEvents` (pagination + filtres source/event_type/from/to), `deleteOldEvents`
- `db/retention.ts` — `createRetentionJob(db, days)` : `runOnce()`, `start()` (setInterval 24h), `stop()`

**Serveur**
- `mqtt/client.ts` — `createMqttClient` : connect, subscribe, route vers `onMessage`
- `ws/server.ts` — `createBroadcaster` : Set de WebSockets, filtre `readyState === 1`. `registerWsRoutes` : GET /ws, envoie snapshot Redis à la connexion
- `api/devices.ts` — GET /api/devices → `{ devices }` depuis Redis
- `api/history.ts` — GET /api/events → pagination + filtres, limit max 200
- `index.ts` — câblage de tous les composants : MQTT → registry → debounce → dedup → broadcast + Redis + SQLite (setImmediate)

**Tests :** 49 tests, 14 fichiers, tous verts

### Frontend (`apps/frontend/`)

- Next.js App Router, TypeScript, Tailwind v4, shadcn/ui
- Composants shadcn installés : card, badge, button, select
- Vitest + jsdom + @testing-library/react configurés

**Store et communication**
- `store/room.ts` — `useRoomStore` (Zustand) : `devices`, `connected`, `setDevice`, `setDevices`, `setConnected`
- `lib/ws.ts` — `createWsClient` : WebSocket avec reconnexion backoff exponentiel (1s → 30s max). Guard `destroyed` pour éviter les reconnexions zombies après `disconnect()`
- `lib/api.ts` — `fetchEvents` : builder URL + fetch REST

**Composants**
- `components/StatusIndicator.tsx` — point vert/gris + label connected/reconnecting
- `components/DeviceCard.tsx` — wrapper card générique (title, state, children)
- `components/devices/FrigateCard.tsx` — icône User, zone, caméra, badge confiance
- `components/devices/WledCard.tsx` — icône Lightbulb, couleur (swatch + hex), barre brightness
- `components/devices/TasmotaCard.tsx` — icône Plug, watt, kWh, température/humidité
- `components/history/Filters.tsx` — Select source + bouton reset
- `components/history/Timeline.tsx` — liste d'events avec badge coloré par source, timestamp relatif

**Pages**
- `app/page.tsx` — dashboard temps réel : connexion WS dans useEffect, grille de cards. Tasmota multi-device supporté dynamiquement.
- `app/history/page.tsx` — useQuery TanStack Query + Filters + Timeline + pagination
- `app/providers.tsx` — QueryClientProvider
- `app/layout.tsx` — metadata Signal Room + Providers

**Tests :** 6 tests, 2 fichiers, tous verts

---

## Ce qui manque ou est flou

### Fonctionnel certain

- [ ] **Connexion à un vrai broker MQTT** — jamais testé contre un vrai Frigate/WLED/Tasmota. Les interpréteurs sont testés avec des payloads synthétiques, pas avec du trafic réel. Il y aura probablement des ajustements de parsing.
- [ ] **Page `/history` : filtre par plage horaire** — les paramètres `from`/`to` existent côté API et SQLite mais l'UI n'expose pas de date picker. Actuellement seul le filtre source est disponible.
- [ ] **Pas d'authentification** — l'app est entièrement ouverte. Acceptable en réseau local, à adresser si exposée.
- [ ] **GET /api/devices non utilisé côté frontend** — la page dashboard reçoit l'état via WebSocket (snapshot + updates). La route REST `/api/devices` existe mais aucun composant ne l'appelle.

### Comportements connus imparfaits

- **FRIGATE_DEBOUNCE_MS inutilisée** — la variable d'env est dans `.env.example` et chargée dans `config.frigate.debounceMs`, mais `frigateInterpreter` a son `debounceMs` hardcodé à 300. La config n'est pas câblée à l'interpréteur. Impact : impossible de changer le debounce sans modifier le code.
- **Debounce Frigate multi-caméra** — toutes les caméras Frigate partagent la même clé de debounce (`'frigate'`). Sur un setup multi-caméra, un événement d'une caméra réinitialise le timer de l'autre. Impact nul sur mono-caméra (cas nominal).
- **Race condition WS snapshot/update** — le client est ajouté au broadcaster *avant* que le snapshot Redis soit envoyé. Un update MQTT arrivant dans cette fenêtre sera écrasé par le snapshot. Impact très faible en pratique (fenêtre <1ms sur loopback), non bloquant.
- **`getAllDeviceStates` utilise KEYS** — sur un large dataset Redis, KEYS est bloquant. Négligeable pour le cas d'usage (3–10 devices max).

### Flou / à définir

- [ ] **Notifications** — pas prévu dans la spec, mais naturel pour Frigate (détection de nuit, zone sensible). Push ? Son ? Badge navigateur ?
- [ ] **Multi-instance Tasmota** — l'app supporte plusieurs devices Tasmota (détection par `device_id`), mais Redis stocke tout sous la clé `device:tasmota`. Si deux Tasmota envoient des messages, le second écrase le premier dans Redis. À corriger : utiliser `device:tasmota:<device_id>` comme clé.
- [ ] **Frigate stats globales** — le topic `frigate/stats` n'est pas interprété. FPS, latence caméra, charge CPU Frigate pourraient être affichés.
- [ ] **Animations** — framer-motion est installé mais pas utilisé. Les cards pourraient s'animer lors des mises à jour.
- [ ] **Mode historique avancé** — device_snapshots est peuplé mais jamais lu. Une vue "état de la chambre à T" utilisant les snapshots n'est pas implémentée.
- [ ] **Tests E2E** — pas de test d'intégration frontend/backend. Playwright ou Cypress pourrait simuler un flux MQTT complet.
- [ ] **Gestion d'erreur Redis** — si Redis est down, le backend crashe ou tourne en mode dégradé ? Non testé.
- [ ] **Variable FRONTEND_PORT** — déclarée dans `.env.example` mais Next.js utilise le port via `npm run dev`, pas lu automatiquement.

---

## Comment démarrer en local

```bash
# Prérequis : Docker (pour Redis), Node.js 22

# 1. Redis
docker compose -f docker-compose.dev.yml up -d

# 2. Copier et remplir les variables
cp .env.example .env
# Renseigner MQTT_HOST avec l'IP du broker

# 3. Backend
npm run dev:backend

# 4. Frontend (autre terminal)
npm run dev:frontend

# Accès : http://localhost:3000
```

## Tests

```bash
npm run test:backend   # 49 tests
npm run test:frontend  # 6 tests
```

---

## Dépendances clés et versions notables

| Package | Version | Note |
|---|---|---|
| Node.js | 22 | Requis |
| Fastify | 5.x | (v4 était incompatible avec @fastify/websocket v10) |
| Next.js | 15/16 | App Router, Tailwind v4 |
| better-sqlite3 | 11.x | WAL mode |
| ioredis | 5.x | |
| mqtt.js | 5.x | Import nommé `{ connect }` |
| Vitest | 2.x | `vitest.config.mts` côté frontend (ESM) |
