-- A record whose mint attempt was closed as cancelled or reverted may be published
-- again for the same confirmed snapshot (decision of 2026-10-26). The one-publication
-- rule now covers only publications that did not fail; failed ones stay as history.
DROP INDEX "Publication_confirmationId_key";
DROP INDEX "Publication_confirmationId_passportId_key";
DROP INDEX "Publication_payloadHash_key";

CREATE INDEX "Publication_confirmationId_passportId_idx" ON "Publication"("confirmationId", "passportId");
CREATE INDEX "Publication_payloadHash_idx" ON "Publication"("payloadHash");

-- A failed publication that is later quarantined moves to CHAIN_FAILED_SUSPENDED, so
-- both failed states are outside the rule; the service refuses a new publication while
-- an earlier one for the same confirmation is suspended.
CREATE UNIQUE INDEX "Publication_one_open_per_confirmation" ON "Publication"("confirmationId")
  WHERE "status" NOT IN ('CHAIN_FAILED', 'CHAIN_FAILED_SUSPENDED');
CREATE UNIQUE INDEX "Publication_one_open_per_payload" ON "Publication"("payloadHash")
  WHERE "status" NOT IN ('CHAIN_FAILED', 'CHAIN_FAILED_SUSPENDED');
