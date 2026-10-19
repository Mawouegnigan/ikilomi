-- ikilomi : schéma MVP (motos d'abord, extensible aux autres objets)
-- PostgreSQL 15+ avec PostGIS

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ENUMS
CREATE TYPE object_category AS ENUM ('MOTO','VELO','HIGHTECH','LUXE','DOCUMENT','ANIMAL');
CREATE TYPE object_status   AS ENUM ('NORMAL','EN_RECHERCHE','SECURISE');
CREATE TYPE alert_kind      AS ENUM ('VOL','PERTE');
CREATE TYPE alert_status    AS ENUM ('ACTIVE','CLOTUREE','REJETEE');
CREATE TYPE tip_status      AS ENUM ('NOUVEAU','VU','TRANSMIS','ECARTE');
CREATE TYPE device_status   AS ENUM ('DESARME','ARME','ALARME','HORS_LIGNE');

-- UTILISATEURS
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text UNIQUE,                 -- OTP SMS
  email         text UNIQUE,
  display_name  text,
  locale        text NOT NULL DEFAULT 'fr',  -- fr, yo
  role          text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','MODERATOR','ADMIN')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- APPAREILS MOBILES (push + zone approximative, pas de suivi continu)
CREATE TABLE user_phones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token    text NOT NULL UNIQUE,
  home_zone    geography(Point,4326),        -- position grossière (arrondie), consentie
  zone_updated_at timestamptz,
  push_enabled boolean NOT NULL DEFAULT true
);
CREATE INDEX user_phones_zone_gix ON user_phones USING GIST (home_zone);

-- OBJETS (coffre-fort)
CREATE TABLE objects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category     object_category NOT NULL DEFAULT 'MOTO',
  brand        text NOT NULL,
  model        text,
  year         int,
  color        text,
  status       object_status NOT NULL DEFAULT 'NORMAL',
  verified     boolean NOT NULL DEFAULT false,  -- preuve validée par modération
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- IDENTIFIANTS UNIQUES (plusieurs par objet : VIN, plaque, IMEI...)
CREATE TABLE object_identifiers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id   uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind        text NOT NULL,                   -- VIN, PLAQUE, IMEI, SERIAL, MAC, PUCE...
  value_norm  text NOT NULL,                   -- normalisé : majuscules, sans espaces
  UNIQUE (kind, value_norm)                    -- empêche le double enregistrement
);
CREATE INDEX object_identifiers_value_idx ON object_identifiers (value_norm);

CREATE TABLE object_photos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id  uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  url        text NOT NULL,
  angle      text,                             -- face, profil, plaque...
  created_at timestamptz NOT NULL DEFAULT now()
);

-- PREUVES DE PROPRIETE (non publiques)
CREATE TABLE proofs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id   uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind        text NOT NULL,                   -- CARTE_GRISE, FACTURE...
  file_url    text NOT NULL,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz
);

-- ALERTES (vol / perte)
CREATE TABLE alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id     uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind          alert_kind NOT NULL DEFAULT 'VOL',
  status        alert_status NOT NULL DEFAULT 'ACTIVE',
  last_seen_at  timestamptz NOT NULL,          -- heure approximative saisie
  last_seen_geo geography(Point,4326) NOT NULL,
  radius_m      int NOT NULL DEFAULT 5000 CHECK (radius_m BETWEEN 1000 AND 10000),
  public_slug   text NOT NULL UNIQUE,          -- page publique SEO
  source        text NOT NULL DEFAULT 'MANUEL' CHECK (source IN ('MANUEL','DEVICE')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);
CREATE INDEX alerts_geo_gix ON alerts USING GIST (last_seen_geo);
-- une seule alerte active par objet
CREATE UNIQUE INDEX alerts_one_active_per_object ON alerts (object_id) WHERE status = 'ACTIVE';

-- INDICES DES TEMOINS (jamais publics)
CREATE TABLE tips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id    uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  message     text NOT NULL,
  photo_url   text,
  geo         geography(Point,4326),
  seen_at     timestamptz NOT NULL DEFAULT now(),
  status      tip_status NOT NULL DEFAULT 'NOUVEAU'
);
CREATE INDEX tips_alert_idx ON tips (alert_id);

-- ENVOIS DE NOTIFICATIONS (anti-doublon et audit)
CREATE TABLE alert_notifications (
  alert_id  uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  phone_id  uuid NOT NULL REFERENCES user_phones(id) ON DELETE CASCADE,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_id, phone_id)
);

-- COUCHE APPAREIL (IoT) : prête dès le MVP
CREATE TABLE devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id    uuid NOT NULL UNIQUE REFERENCES objects(id) ON DELETE CASCADE,
  hw_id        text NOT NULL UNIQUE,           -- identifiant du boîtier (ex. ESP32)
  mqtt_topic   text NOT NULL UNIQUE,
  status       device_status NOT NULL DEFAULT 'DESARME',
  last_seen_at timestamptz,
  last_geo     geography(Point,4326)
);

CREATE TABLE device_events (
  id          bigserial PRIMARY KEY,
  device_id   uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type        text NOT NULL,                   -- MOUVEMENT, PERTE_SIGNAL, BATTERIE_FAIBLE
  payload     jsonb,
  geo         geography(Point,4326),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_events_device_idx ON device_events (device_id, created_at DESC);

-- REQUETE TYPE : téléphones à notifier dans le rayon d'une alerte
-- SELECT p.id, p.fcm_token
-- FROM user_phones p, alerts a
-- WHERE a.id = $1
--   AND p.push_enabled
--   AND ST_DWithin(p.home_zone, a.last_seen_geo, a.radius_m)
--   AND p.user_id <> (SELECT owner_id FROM objects WHERE id = a.object_id);
