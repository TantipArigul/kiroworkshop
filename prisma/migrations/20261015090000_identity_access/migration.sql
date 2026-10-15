-- Identity & Access: e-mail login identifier, lockout and forced password change fields.
-- Hand-written so the identifier column is renamed in place instead of dropped and recreated.

-- Rename User.username -> User.email and keep the Prisma unique index name aligned.
DROP INDEX "User_username_key";
ALTER TABLE "User" RENAME COLUMN "username" TO "email";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Forced password change and per-account lockout state.
ALTER TABLE "User" ADD COLUMN "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "failedLoginWindowStartedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "lockedUntil" DATETIME;

-- AuditEvent is append-only. Rows can be deleted only after the 90-day retention period
-- (AUDIT_RETENTION_DAYS); julianday() reads both the adapter ISO-8601 format and
-- CURRENT_TIMESTAMP. An unparseable timestamp is treated as within retention.
CREATE TRIGGER "AuditEvent_prevent_update"
BEFORE UPDATE ON "AuditEvent"
BEGIN
    SELECT RAISE(ABORT, 'AuditEvent is append-only');
END;

CREATE TRIGGER "AuditEvent_prevent_delete_within_retention"
BEFORE DELETE ON "AuditEvent"
WHEN julianday(OLD."occurredAt") IS NULL
    OR julianday(OLD."occurredAt") >= julianday('now', '-90 days')
BEGIN
    SELECT RAISE(ABORT, 'AuditEvent within retention cannot be deleted');
END;
