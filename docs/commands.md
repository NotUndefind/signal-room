# Signal Room — Commandes

## Démarrage local

```bash
# Prérequis : Docker (pour Redis), Node.js 22

# 1. Redis
docker compose -f docker-compose.dev.yml up -d

# 2. Variables d'environnement
cp .env.example .env
# Renseigner MQTT_HOST avec l'IP du broker MQTT

# 3. Backend (terminal 1)
npm run dev:backend

# 4. Frontend (terminal 2)
npm run dev:frontend

# Accès : http://localhost:3000
```

## Tests

```bash
npm run test:backend    # 49 tests
npm run test:frontend   # 6 tests
```

## Build production

```bash
# Backend
cd apps/backend && npm run build   # compile TypeScript → dist/

# Frontend
cd apps/frontend && npm run build  # Next.js build standalone
```

## Docker production

```bash
cp .env.example .env  # renseigner toutes les valeurs
docker compose up --build
```

## Vérification TypeScript

```bash
cd apps/backend && npx tsc --noEmit
cd apps/frontend && npx tsc --noEmit
```

## Dépendances clés et versions

| Package        | Version | Note                                        |
| -------------- | ------- | ------------------------------------------- |
| Node.js        | 22      | Requis                                      |
| Fastify        | 5.x     | v4 incompatible avec @fastify/websocket v10 |
| Next.js        | 15/16   | App Router, Tailwind v4                     |
| better-sqlite3 | 11.x    | WAL mode                                    |
| ioredis        | 5.x     |                                             |
| mqtt.js        | 5.x     | Import nommé `{ connect }`                  |
| Vitest         | 2.x     | `vitest.config.mts` côté frontend (ESM)     |
