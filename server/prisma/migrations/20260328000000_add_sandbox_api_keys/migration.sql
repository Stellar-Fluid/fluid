-- Add sandbox flag and sandbox-specific fields to ApiKey
ALTER TABLE "ApiKey" ADD COLUMN "isSandbox" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ApiKey" ADD COLUMN "sandboxFeePayerSecret" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN "sandboxLastResetAt" DATETIME;

CREATE INDEX "ApiKey_isSandbox_idx" ON "ApiKey"("isSandbox");
