-- Supabase exposes public tables to the anon key. Our backend connects directly
-- as the database owner (which bypasses RLS), so we turn RLS on with NO policies:
-- the public REST API can then read/write nothing.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
            WHERE schemaname = 'public' AND tablename NOT LIKE '\_prisma%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
