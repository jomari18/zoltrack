-- Run once in Supabase SQL Editor before deploying the frontend check.
-- Only returns availability; does not expose profile rows or bypass signup uniqueness.
BEGIN;
CREATE OR REPLACE FUNCTION public.is_registration_username_available(candidate_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN candidate_username IS NULL OR length(btrim(candidate_username)) < 3 THEN false
        ELSE NOT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE username = btrim(candidate_username)
        )
    END;
$$;
REVOKE ALL ON FUNCTION public.is_registration_username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_registration_username_available(text) TO anon, authenticated;
COMMIT;
