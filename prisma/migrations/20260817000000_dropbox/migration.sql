-- Conexión con Dropbox: una sola para toda la plataforma (la cuenta del fondo),
-- más el mapeo de cada carpeta con su empresa.
-- Idempotente: db-deploy.mjs corre esto dentro de BEGIN/COMMIT y puede
-- reintentarse sobre una base que ya lo tiene.

CREATE TABLE IF NOT EXISTS "DropboxConnection" (
  "id"                  TEXT PRIMARY KEY DEFAULT 'unica',
  -- El refresh token abre TODA la carpeta financiera del grupo: se guarda
  -- cifrado con AES-256-GCM (src/lib/cripto.ts), nunca en claro.
  "refreshTokenCifrado" TEXT NOT NULL,
  "scopes"              TEXT,
  "cuentaNombre"        TEXT,
  "cuentaEmail"         TEXT,
  -- Dropbox Business guarda los archivos del equipo en otro espacio.
  "esEquipo"            BOOLEAN NOT NULL DEFAULT false,
  "rootNamespaceId"     TEXT,
  "carpetaRaiz"         TEXT,
  -- Cursor de list_folder: con esto se pregunta "¿qué cambió?" sin releer todo.
  "cursor"              TEXT,
  "conectadoPorId"      TEXT,
  "conectadoEl"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ultimaMiradaEl"      TIMESTAMP(3),
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  ALTER TABLE "DropboxConnection"
    ADD CONSTRAINT "DropboxConnection_conectadoPorId_fkey"
    FOREIGN KEY ("conectadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DropboxCarpeta" (
  "id"         TEXT PRIMARY KEY,
  "conexionId" TEXT NOT NULL,
  -- Ruta relativa a la carpeta raíz, ej. "/01_Administradora de Fondos".
  "ruta"       TEXT NOT NULL,
  -- NULL = carpeta reconocida pero sin empresa: se ignora y se dice en pantalla.
  "companyId"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  ALTER TABLE "DropboxCarpeta"
    ADD CONSTRAINT "DropboxCarpeta_conexionId_fkey"
    FOREIGN KEY ("conexionId") REFERENCES "DropboxConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "DropboxCarpeta"
    ADD CONSTRAINT "DropboxCarpeta_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Una carpeta se mapea una sola vez: dos filas para la misma ruta dejarían
-- los archivos de una empresa entrando en otra según cuál gane.
CREATE UNIQUE INDEX IF NOT EXISTS "DropboxCarpeta_conexionId_ruta_key"
  ON "DropboxCarpeta" ("conexionId", "ruta");
CREATE INDEX IF NOT EXISTS "DropboxCarpeta_companyId_idx"
  ON "DropboxCarpeta" ("companyId");

-- Cinturón: que el deploy se caiga acá y no que la base y el schema queden
-- divergiendo en silencio.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'DropboxConnection') THEN
    RAISE EXCEPTION 'Falta la tabla DropboxConnection: la migración no puede darse por aplicada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'DropboxCarpeta_conexionId_ruta_key') THEN
    RAISE EXCEPTION 'Falta el índice único DropboxCarpeta(conexionId,ruta)';
  END IF;
END $$;
