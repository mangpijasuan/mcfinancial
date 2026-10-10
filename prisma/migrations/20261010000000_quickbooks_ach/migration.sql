-- Members pay by ACH through a QuickBooks Online invoice (docs/operations/quickbooks.md).

-- AlterTable
ALTER TABLE "PortalPayment" ADD COLUMN     "qboCheckedAt" TIMESTAMP(3),
ADD COLUMN     "qboInvoiceId" TEXT,
ADD COLUMN     "qboInvoiceLink" TEXT,
ADD COLUMN     "qboPaymentId" TEXT,
ADD COLUMN     "qboReturnFlaggedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QuickBooksConnection" (
    "id" TEXT NOT NULL DEFAULT 'club',
    "realmId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "duesItemId" TEXT,
    "duesItemName" TEXT,
    "loanItemId" TEXT,
    "loanItemName" TEXT,
    "connectedBy" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksCustomer" (
    "memberId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickBooksCustomer_pkey" PRIMARY KEY ("memberId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalPayment_qboInvoiceId_key" ON "PortalPayment"("qboInvoiceId");

-- AddForeignKey
ALTER TABLE "QuickBooksCustomer" ADD CONSTRAINT "QuickBooksCustomer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One connected company for the club.
ALTER TABLE "QuickBooksConnection" ADD CONSTRAINT "QuickBooksConnection_single" CHECK ("id" = 'club');

-- An ACH payment always has its invoice.
ALTER TABLE "PortalPayment" ADD CONSTRAINT "PortalPayment_ach_invoice" CHECK ("method" <> 'ach' OR "status" <> 'completed' OR "qboInvoiceId" IS NOT NULL);
