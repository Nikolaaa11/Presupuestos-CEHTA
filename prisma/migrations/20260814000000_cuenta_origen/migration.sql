-- Cuenta corriente de origen para la nómina de transferencias masivas
-- (columna "Cuenta origen" del formato Santander).
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "cuentaOrigen" TEXT;
