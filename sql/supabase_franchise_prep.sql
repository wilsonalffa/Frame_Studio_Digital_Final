-- Frame Studio Digital: preparacao segura para franquias (Supabase)
--
-- Objetivo:
-- - Preparar o modelo para uso futuro com Supabase Auth + RLS multiunidade.
-- - Nao abrir acesso direto do frontend ao banco neste momento.
-- - Manter o modo mais seguro: backend-only.
--
-- O que este script faz:
-- - Adiciona users.auth_user_id.
-- - Cria indice unico parcial para vinculo com auth.users.
-- - Cria funcoes auxiliares usadas pelo modelo multiunidade.
-- - Mantem anon/authenticated sem acesso liberado as tabelas.

BEGIN;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS auth_user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id
ON public.users(auth_user_id)
WHERE auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.is_active = TRUE
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_store_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.store_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.is_active = TRUE
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(u.role, 'user')
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.is_active = TRUE
    LIMIT 1;
$$;

ALTER TABLE IF EXISTS public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.store_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.frames_cache ENABLE ROW LEVEL SECURITY;

REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

COMMIT;

-- Quando decidir abrir o modo franquia:
-- 1) Crie os usuarios em Authentication > Users.
-- 2) Preencha public.users.auth_user_id.
-- 3) Execute sql/supabase_rls_multitenant.sql.