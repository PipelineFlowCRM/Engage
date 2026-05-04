ALTER TABLE "Delivery" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Delivery_idempotencyKey_key" ON "Delivery"("idempotencyKey");
