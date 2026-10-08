CREATE TABLE "StripeWebhookEvent" (
  "eventId" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StripeWebhookEvent_status_check" CHECK ("status" IN ('pending','failed','processed','review')),
  CONSTRAINT "StripeWebhookEvent_attempts_check" CHECK ("attempts" >= 0)
);
CREATE INDEX "StripeWebhookEvent_status_updatedAt_idx" ON "StripeWebhookEvent"("status", "updatedAt");
CREATE FUNCTION stripe_event_preserve_evidence() RETURNS trigger AS $$
BEGIN
  IF (NEW."eventId", NEW.type, NEW.payload, NEW."createdAt") IS DISTINCT FROM (OLD."eventId", OLD.type, OLD.payload, OLD."createdAt") THEN
    RAISE EXCEPTION 'Verified Stripe event evidence cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER stripe_event_evidence BEFORE UPDATE ON "StripeWebhookEvent"
  FOR EACH ROW EXECUTE FUNCTION stripe_event_preserve_evidence();
