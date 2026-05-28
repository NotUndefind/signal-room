# Signal Room — État du projet

**Dernière mise à jour :** 2026-05-26 (fix Tasmota multi-relais + Frigate multi-caméra)
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

- [~] **Connexion à un vrai broker MQTT** — connexion établie avec le broker réel (192.168.1.101:1883, user `mqtt_nlp`). Topics réels découverts : `home/chambre/lumiere/stat/chambre/RESULT`, `home/chambre/lumiere/stat/chambre/POWER2`, `frigate/principale/status/detect`. **Fix appliqué** : le Tasmota de ce setup utilise un full_topic custom `home/chambre/lumiere/` (préfixe) et `stat` au lieu de `tele`. `tasmotaInterpreter` refactorisé en `createTasmotaInterpreter(prefix)` avec support du topic `stat/+/RESULT`. Variable `TASMOTA_TOPIC_PREFIX=home/chambre/lumiere/` ajoutée. Le backend souscrit désormais à `home/chambre/lumiere/stat/+/RESULT`, `home/chambre/lumiere/tele/+/STATE`, `home/chambre/lumiere/tele/+/SENSOR`. Frigate : seul le topic de status (`frigate/principale/status/detect`) a été observé — les events (`frigate/+/events`) s'attendent à un payload JSON `{type, after}` déclenché par une détection réelle. À tester lors d'un prochain mouvement détecté.
- [ ] **Page `/history` : filtre par plage horaire** — les paramètres `from`/`to` existent côté API et SQLite mais l'UI n'expose pas de date picker. Actuellement seul le filtre source est disponible.
- [ ] **Pas d'authentification** — l'app est entièrement ouverte. Acceptable en réseau local, à adresser si exposée.
- [ ] **GET /api/devices non utilisé côté frontend** — la page dashboard reçoit l'état via WebSocket (snapshot + updates). La route REST `/api/devices` existe mais aucun composant ne l'appelle.

### Comportements connus imparfaits

- **FRIGATE_DEBOUNCE_MS inutilisée** — chargée dans `config.frigate.debounceMs`, mais `frigateInterpreter` a son `debounceMs` hardcodé à 300. La config n'est pas câblée à l'interpréteur. Impact : impossible de changer le debounce sans modifier le code.
- **Race condition WS snapshot/update** — le client est ajouté au broadcaster *avant* que le snapshot Redis soit envoyé. Un update MQTT arrivant dans cette fenêtre sera écrasé par le snapshot. Impact très faible en pratique (fenêtre <1ms sur loopback), non bloquant.
- **`getAllDeviceStates` utilise KEYS** — sur un large dataset Redis, KEYS est bloquant. Négligeable pour le cas d'usage (3–10 devices max).

### Flou / à définir

- [ ] **Notifications** — pas prévu dans la spec, mais naturel pour Frigate (détection de nuit, zone sensible). Push ? Son ? Badge navigateur ?
- [x] **Multi-instance Tasmota / Multi-caméra Frigate** — résolu. La clé unique par device est calculée dans `index.ts` : `source:camera` ou `source:device_id`. Redis stocke `device:tasmota:chambre`, `device:frigate:principale`, etc. Le frontend filtre par `source` pour afficher une card par device.
- [ ] **Frigate stats globales** — le topic `frigate/stats` n'est pas interprété. FPS, latence caméra, charge CPU Frigate pourraient être affichés.
- [ ] **Animations** — framer-motion est installé mais pas utilisé. Les cards pourraient s'animer lors des mises à jour.
- [ ] **Mode historique avancé** — device_snapshots est peuplé mais jamais lu. Une vue "état de la chambre à T" utilisant les snapshots n'est pas implémentée.
- [ ] **Tests E2E** — pas de test d'intégration frontend/backend. Playwright ou Cypress pourrait simuler un flux MQTT complet.
- [ ] **Gestion d'erreur Redis** — si Redis est down, le backend crashe ou tourne en mode dégradé ? Non testé.
- [ ] **Variable FRONTEND_PORT** — déclarée dans `.env.example` mais Next.js utilise le port via `npm run dev`, pas lu automatiquement.

