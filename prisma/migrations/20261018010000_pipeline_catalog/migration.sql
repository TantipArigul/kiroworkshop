-- Pipeline Catalog & Nextflow Executor: pipeline identity, run name and progress on Job, plus
-- the input-file and output-manifest tables of Nextflow runs.
-- Hand-written: SQLite ADD COLUMN with a constant default keeps existing Job rows in place
-- (Prisma would rebuild the table); the resulting schema is identical to `prisma/schema.prisma`.

-- Existing rows are Smart Checkup jobs run by the built-in simulated executor.
ALTER TABLE "Job" ADD COLUMN "pipelineId" TEXT NOT NULL DEFAULT 'smart-checkup';
ALTER TABLE "Job" ADD COLUMN "pipelineRevision" TEXT NOT NULL DEFAULT 'builtin';
ALTER TABLE "Job" ADD COLUMN "runName" TEXT NOT NULL DEFAULT '';
-- { completedSteps, currentStep, startedAt } while a Nextflow run is RUNNING.
ALTER TABLE "Job" ADD COLUMN "progressJson" TEXT;

-- Backfill the run name from the Smart Checkup sample label. json_valid() guards against
-- malformed JSON (json_extract() would abort the migration); updatedAt is left unchanged.
UPDATE "Job"
SET "runName" = COALESCE(
    (
        SELECT CASE
            WHEN json_valid("JobInput"."parametersJson")
                THEN substr(CAST(json_extract("JobInput"."parametersJson", '$.sampleLabel') AS TEXT), 1, 64)
        END
        FROM "JobInput"
        WHERE "JobInput"."jobId" = "Job"."id"
    ),
    ''
);

-- Queue order and queue position per executor.
CREATE INDEX "Job_status_pipelineId_createdAt_idx" ON "Job"("status", "pipelineId", "createdAt");

-- CreateTable
CREATE TABLE "JobInputFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    CONSTRAINT "JobInputFile_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobOutputFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobOutputFile_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "JobInputFile_jobId_idx" ON "JobInputFile"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobInputFile_jobId_relativePath_key" ON "JobInputFile"("jobId", "relativePath");

-- CreateIndex
CREATE INDEX "JobOutputFile_jobId_idx" ON "JobOutputFile"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOutputFile_jobId_relativePath_key" ON "JobOutputFile"("jobId", "relativePath");
