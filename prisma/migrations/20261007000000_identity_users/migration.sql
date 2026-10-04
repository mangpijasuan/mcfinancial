-- M8: every sign-in goes through "User". The staff table is renamed in
-- place, so staff ids (named by approvals, audit entries and ledger
-- postings) do not change. Each member's portal login becomes a member
-- User with the same password hash. Officers who are also members keep
-- two logins (D-17).
ALTER TABLE "Admin" RENAME TO "User";
ALTER TABLE "User" RENAME CONSTRAINT "Admin_pkey" TO "User_pkey";
ALTER INDEX "Admin_email_key" RENAME TO "User_email_key";
ALTER TABLE "User" RENAME COLUMN "password" TO "passwordHash";
ALTER TABLE "User" RENAME COLUMN "linkedMemberId" TO "memberId";
DROP INDEX "Admin_linkedMemberId_key";
ALTER TABLE "User"
    ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'staff',
    ADD COLUMN "sessionsValidAfter" TIMESTAMP(3),
    ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "StaffRoleAssignment" RENAME COLUMN "adminId" TO "userId";
ALTER TABLE "StaffRoleAssignment" RENAME CONSTRAINT "StaffRoleAssignment_adminId_fkey" TO "StaffRoleAssignment_userId_fkey";
ALTER INDEX "StaffRoleAssignment_adminId_role_key" RENAME TO "StaffRoleAssignment_userId_role_key";
ALTER TABLE "StaffSession" RENAME COLUMN "adminId" TO "userId";
ALTER TABLE "StaffSession" RENAME CONSTRAINT "StaffSession_adminId_fkey" TO "StaffSession_userId_fkey";
ALTER INDEX "StaffSession_adminId_idx" RENAME TO "StaffSession_userId_idx";
ALTER TABLE "MfaRecoveryCode" RENAME COLUMN "adminId" TO "userId";
ALTER TABLE "MfaRecoveryCode" RENAME CONSTRAINT "MfaRecoveryCode_adminId_fkey" TO "MfaRecoveryCode_userId_fkey";
ALTER INDEX "MfaRecoveryCode_adminId_idx" RENAME TO "MfaRecoveryCode_userId_idx";

-- Member logins: one per member who had a portal password. Access that was
-- switched off stays off (disabledAt), and sessions issued before the old
-- cut-off stay rejected.
INSERT INTO "User" ("id", "kind", "name", "passwordHash", "memberId", "createdAt", "disabledAt", "sessionsValidAfter")
SELECT 'mu_' || replace(gen_random_uuid()::text, '-', ''), 'member', m."legalName", m."portalPassword", m."id", CURRENT_TIMESTAMP,
       CASE WHEN m."portalEnabled" THEN NULL ELSE CURRENT_TIMESTAMP END, m."portalSessionsValidAfter"
FROM "Member" m
WHERE m."portalPassword" IS NOT NULL;

ALTER TABLE "User"
    ADD CONSTRAINT "User_kind_check" CHECK ("kind" IN ('staff', 'member')),
    -- Staff sign in by email; a member login is always a member.
    ADD CONSTRAINT "User_staff_email_check" CHECK ("kind" <> 'staff' OR "email" IS NOT NULL),
    ADD CONSTRAINT "User_member_login_check" CHECK ("kind" <> 'member' OR ("memberId" IS NOT NULL AND "email" IS NULL));
CREATE UNIQUE INDEX "User_kind_memberId_key" ON "User"("kind", "memberId");
ALTER TABLE "User" ADD CONSTRAINT "User_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Member logins never hold staff roles, sessions or recovery codes.
CREATE FUNCTION staff_user_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "kind" FROM "User" WHERE "id" = NEW."userId") <> 'staff' THEN
    RAISE EXCEPTION 'user % is not a staff user', NEW."userId";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_role_staff_only BEFORE INSERT OR UPDATE ON "StaffRoleAssignment" FOR EACH ROW EXECUTE FUNCTION staff_user_only();
CREATE TRIGGER staff_session_staff_only BEFORE INSERT OR UPDATE ON "StaffSession" FOR EACH ROW EXECUTE FUNCTION staff_user_only();
CREATE TRIGGER recovery_code_staff_only BEFORE INSERT OR UPDATE ON "MfaRecoveryCode" FOR EACH ROW EXECUTE FUNCTION staff_user_only();
