-- M9: older loans (2021–2025) linked to members by ID, never by name.
ALTER TABLE "HistoricalLoan"
    ADD COLUMN "borrowerId" TEXT,
    ADD COLUMN "cosignerId" TEXT,
    ADD COLUMN "borrowerLink" TEXT,
    ADD COLUMN "cosignerLink" TEXT,
    ADD COLUMN "confirmedBalanceCents" BIGINT,
    ADD COLUMN "balanceAsOf" DATE,
    ADD COLUMN "balanceConfirmedBy" TEXT,
    ADD COLUMN "balanceConfirmedAt" TIMESTAMP(3),
    ADD COLUMN "importedLoanId" TEXT,
    ADD CONSTRAINT "HistoricalLoan_borrowerLink_check" CHECK ("borrowerLink" IS NULL OR "borrowerLink" IN ('exact', 'reviewed', 'no_member')),
    ADD CONSTRAINT "HistoricalLoan_cosignerLink_check" CHECK ("cosignerLink" IS NULL OR "cosignerLink" IN ('exact', 'reviewed', 'no_member')),
    -- A link names a member, or says there is none.
    ADD CONSTRAINT "HistoricalLoan_borrower_link_check" CHECK (("borrowerId" IS NULL) = ("borrowerLink" IS NULL OR "borrowerLink" = 'no_member')),
    ADD CONSTRAINT "HistoricalLoan_cosigner_link_check" CHECK (("cosignerId" IS NULL) = ("cosignerLink" IS NULL OR "cosignerLink" = 'no_member')),
    ADD CONSTRAINT "HistoricalLoan_confirmed_balance_check" CHECK ("confirmedBalanceCents" IS NULL OR ("confirmedBalanceCents" >= 0 AND "balanceAsOf" IS NOT NULL AND "balanceConfirmedBy" IS NOT NULL));

CREATE UNIQUE INDEX "HistoricalLoan_importedLoanId_key" ON "HistoricalLoan"("importedLoanId");
CREATE INDEX "HistoricalLoan_borrowerId_idx" ON "HistoricalLoan"("borrowerId");
CREATE INDEX "HistoricalLoan_cosignerId_idx" ON "HistoricalLoan"("cosignerId");
ALTER TABLE "HistoricalLoan" ADD CONSTRAINT "HistoricalLoan_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HistoricalLoan" ADD CONSTRAINT "HistoricalLoan_cosignerId_fkey" FOREIGN KEY ("cosignerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Where each live loan came from. Loans copied over by the old
-- sync-active-historical-loans.js script share their historical loan ID;
-- they still need the Treasurer to confirm their balance.
ALTER TABLE "Loan" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'live',
    ADD CONSTRAINT "Loan_origin_check" CHECK ("origin" IN ('live', 'legacy_import'));
UPDATE "Loan" SET "origin" = 'legacy_import' WHERE "loanId" IN (SELECT "loanId" FROM "HistoricalLoan");
