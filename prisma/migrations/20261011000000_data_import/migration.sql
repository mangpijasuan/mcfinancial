-- Spreadsheet imports (docs/operations/data-import.md): one row per imported file.

-- CreateTable
CREATE TABLE "DataImport" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileName" TEXT,
    "rows" INTEGER NOT NULL,
    "added" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "importedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataImport_publicId_key" ON "DataImport"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "DataImport_kind_fileHash_key" ON "DataImport"("kind", "fileHash");

