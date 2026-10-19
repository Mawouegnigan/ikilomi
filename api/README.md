# ikilomi-api

API NestJS (TypeScript) de la plateforme ikilomi : PostgreSQL/PostGIS, Redis, MQTT.

## Démarrage

```bash
cp .env.example .env          # puis remplacer les secrets (openssl rand -hex 32)
docker compose up -d          # PostGIS, Redis, Mosquitto
npm install
export $(grep -v '^#' .env | xargs) && npm run migrate
npm run start:dev
```

- Santé : GET http://localhost:3000/v1/health
- Swagger : http://localhost:3000/docs (hors production)
- En développement, le code OTP s'affiche dans les logs du serveur.

## Authentification

| Route | Rôle |
|---|---|
| POST /v1/auth/otp/request | envoie un code (1 par minute et par numéro) |
| POST /v1/auth/otp/verify | échange le code contre accessToken + refreshToken |
| POST /v1/auth/refresh | rotation du refreshToken |
| POST /v1/auth/logout | révoque le refreshToken |
| GET /v1/auth/me | profil (Bearer) |

## Décisions techniques
- SQL natif (pg) et migrations versionnées dans `db/migrations` : contrôle total des requêtes PostGIS.
- Codes OTP : HMAC-SHA256 en Redis, expiration 5 min, 5 essais max, comparaison à temps constant.
- Refresh tokens : stockés hachés (SHA-256), rotation à chaque usage.
- Configuration validée au démarrage (zod) : l'appli refuse de démarrer si elle est invalide.
- Production : brancher un vrai fournisseur SMS (`src/sms/sms.service.ts`), sécuriser Mosquitto (auth + TLS).
