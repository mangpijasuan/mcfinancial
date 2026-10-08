-- Preserve legacy agreements; prevent further term changes after a signature.
CREATE FUNCTION agreement_freeze_signed_terms() RETURNS trigger AS $$
BEGIN
  IF (OLD."borrowerSignature" IS NOT NULL OR OLD."cosignerSignature" IS NOT NULL OR OLD."lenderSignature" IS NOT NULL)
     AND (to_jsonb(NEW) - ARRAY['status','borrowerSignature','borrowerSignedAt','borrowerSignedHash','cosignerSignature','cosignerSignedAt','cosignerSignedHash','lenderSignature','lenderSignedAt','lenderSignedHash','updatedAt'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','borrowerSignature','borrowerSignedAt','borrowerSignedHash','cosignerSignature','cosignerSignedAt','cosignerSignedHash','lenderSignature','lenderSignedAt','lenderSignedHash','updatedAt']) THEN
    RAISE EXCEPTION 'Signed agreement terms are frozen; issue a new agreement' USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD."borrowerSignature" IS NOT NULL AND (NEW."borrowerSignature", NEW."borrowerSignedAt", NEW."borrowerSignedHash") IS DISTINCT FROM (OLD."borrowerSignature", OLD."borrowerSignedAt", OLD."borrowerSignedHash"))
    OR (OLD."cosignerSignature" IS NOT NULL AND (NEW."cosignerSignature", NEW."cosignerSignedAt", NEW."cosignerSignedHash") IS DISTINCT FROM (OLD."cosignerSignature", OLD."cosignerSignedAt", OLD."cosignerSignedHash"))
    OR (OLD."lenderSignature" IS NOT NULL AND (NEW."lenderSignature", NEW."lenderSignedAt", NEW."lenderSignedHash") IS DISTINCT FROM (OLD."lenderSignature", OLD."lenderSignedAt", OLD."lenderSignedHash")) THEN
    RAISE EXCEPTION 'Recorded signatures cannot be replaced' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agreement_signed_terms BEFORE UPDATE ON "LoanAgreement"
  FOR EACH ROW EXECUTE FUNCTION agreement_freeze_signed_terms();
