-- Frame Studio Digital: RLS multiunidade para franquia (Supabase)
--
-- Objetivo:
-- - Permitir acesso via role authenticated com isolamento por store_id.
-- - Bloquear anon.
-- - Preparar mapeamento entre auth.users (Supabase Auth) e public.users.
--
-- Requisitos:
-- - Cada usuario autenticado precisa ter auth_user_id preenchido em public.users.
-- - A coluna users.store_id deve estar correta para o tenant da franquia.

BEGIN;

-- =========================================================
-- 0) PREPARO DE MODELO DE USUARIO (mapeamento com Auth)
-- =========================================================

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS auth_user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id
ON public.users(auth_user_id)
WHERE auth_user_id IS NOT NULL;

-- =========================================================
-- 1) PERMISSOES DE ROLES SUPABASE
-- =========================================================

-- Fechado para publico anonimo
REVOKE USAGE ON SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Liberar apenas authenticated (acesso final segue RLS)
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT ON public.stores TO authenticated;
GRANT SELECT, UPDATE ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.frames_cache TO authenticated;

-- =========================================================
-- 2) FUNCOES AUXILIARES (contexto do usuario autenticado)
-- =========================================================

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

GRANT EXECUTE ON FUNCTION public.current_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_store_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- =========================================================
-- 3) ATIVAR RLS
-- =========================================================

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frames_cache ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 4) LIMPAR POLITICAS ANTIGAS COMUNS
-- =========================================================

DROP POLICY IF EXISTS stores_public_read ON public.stores;
DROP POLICY IF EXISTS users_public_read ON public.users;
DROP POLICY IF EXISTS clientes_public_read ON public.clientes;
DROP POLICY IF EXISTS consultas_public_read ON public.consultas;
DROP POLICY IF EXISTS store_state_public_read ON public.store_state;
DROP POLICY IF EXISTS frames_cache_public_read ON public.frames_cache;

DROP POLICY IF EXISTS stores_select_own_store ON public.stores;
DROP POLICY IF EXISTS stores_update_admin_own_store ON public.stores;
DROP POLICY IF EXISTS users_select_same_store ON public.users;
DROP POLICY IF EXISTS users_update_self_safe ON public.users;
DROP POLICY IF EXISTS clientes_select_same_store ON public.clientes;
DROP POLICY IF EXISTS clientes_insert_same_store ON public.clientes;
DROP POLICY IF EXISTS clientes_update_same_store ON public.clientes;
DROP POLICY IF EXISTS clientes_delete_same_store ON public.clientes;
DROP POLICY IF EXISTS consultas_select_same_store ON public.consultas;
DROP POLICY IF EXISTS consultas_insert_same_store ON public.consultas;
DROP POLICY IF EXISTS consultas_update_same_store ON public.consultas;
DROP POLICY IF EXISTS consultas_delete_same_store ON public.consultas;
DROP POLICY IF EXISTS store_state_select_same_store ON public.store_state;
DROP POLICY IF EXISTS store_state_insert_same_store ON public.store_state;
DROP POLICY IF EXISTS store_state_update_same_store ON public.store_state;
DROP POLICY IF EXISTS store_state_delete_same_store ON public.store_state;
DROP POLICY IF EXISTS frames_cache_select_same_store ON public.frames_cache;
DROP POLICY IF EXISTS frames_cache_insert_same_store ON public.frames_cache;
DROP POLICY IF EXISTS frames_cache_update_same_store ON public.frames_cache;
DROP POLICY IF EXISTS frames_cache_delete_same_store ON public.frames_cache;

-- =========================================================
-- 5) POLITICAS RLS MULTIUNIDADE
-- =========================================================

-- stores: cada usuario ve apenas sua loja
CREATE POLICY stores_select_own_store
ON public.stores
FOR SELECT
TO authenticated
USING (id = public.current_store_id());

-- stores: somente admin da propria loja pode atualizar dados da loja
CREATE POLICY stores_update_admin_own_store
ON public.stores
FOR UPDATE
TO authenticated
USING (
    id = public.current_store_id()
    AND public.current_user_role() = 'admin'
)
WITH CHECK (
    id = public.current_store_id()
    AND public.current_user_role() = 'admin'
);

-- users: visibilidade interna da propria loja
CREATE POLICY users_select_same_store
ON public.users
FOR SELECT
TO authenticated
USING (store_id = public.current_store_id());

-- users: update seguro do proprio registro (sem troca de loja/role)
CREATE POLICY users_update_self_safe
ON public.users
FOR UPDATE
TO authenticated
USING (id = public.current_user_id())
WITH CHECK (
    id = public.current_user_id()
    AND store_id = public.current_store_id()
    AND role = public.current_user_role()
);

-- clientes
CREATE POLICY clientes_select_same_store
ON public.clientes
FOR SELECT
TO authenticated
USING (store_id = public.current_store_id());

CREATE POLICY clientes_insert_same_store
ON public.clientes
FOR INSERT
TO authenticated
WITH CHECK (
    store_id = public.current_store_id()
    AND (
        owner_user_id IS NULL
        OR owner_user_id = public.current_user_id()
        OR public.current_user_role() = 'admin'
    )
);

CREATE POLICY clientes_update_same_store
ON public.clientes
FOR UPDATE
TO authenticated
USING (store_id = public.current_store_id())
WITH CHECK (store_id = public.current_store_id());

CREATE POLICY clientes_delete_same_store
ON public.clientes
FOR DELETE
TO authenticated
USING (store_id = public.current_store_id());

-- consultas
CREATE POLICY consultas_select_same_store
ON public.consultas
FOR SELECT
TO authenticated
USING (store_id = public.current_store_id());

CREATE POLICY consultas_insert_same_store
ON public.consultas
FOR INSERT
TO authenticated
WITH CHECK (
    store_id = public.current_store_id()
    AND (
        owner_user_id IS NULL
        OR owner_user_id = public.current_user_id()
        OR public.current_user_role() = 'admin'
    )
);

CREATE POLICY consultas_update_same_store
ON public.consultas
FOR UPDATE
TO authenticated
USING (store_id = public.current_store_id())
WITH CHECK (store_id = public.current_store_id());

CREATE POLICY consultas_delete_same_store
ON public.consultas
FOR DELETE
TO authenticated
USING (store_id = public.current_store_id());

-- store_state
CREATE POLICY store_state_select_same_store
ON public.store_state
FOR SELECT
TO authenticated
USING (store_id = public.current_store_id());

CREATE POLICY store_state_insert_same_store
ON public.store_state
FOR INSERT
TO authenticated
WITH CHECK (store_id = public.current_store_id());

CREATE POLICY store_state_update_same_store
ON public.store_state
FOR UPDATE
TO authenticated
USING (store_id = public.current_store_id())
WITH CHECK (store_id = public.current_store_id());

CREATE POLICY store_state_delete_same_store
ON public.store_state
FOR DELETE
TO authenticated
USING (store_id = public.current_store_id());

-- frames_cache
CREATE POLICY frames_cache_select_same_store
ON public.frames_cache
FOR SELECT
TO authenticated
USING (store_id = public.current_store_id());

CREATE POLICY frames_cache_insert_same_store
ON public.frames_cache
FOR INSERT
TO authenticated
WITH CHECK (
    store_id = public.current_store_id()
    AND (
        user_id = public.current_user_id()
        OR public.current_user_role() = 'admin'
    )
);

CREATE POLICY frames_cache_update_same_store
ON public.frames_cache
FOR UPDATE
TO authenticated
USING (store_id = public.current_store_id())
WITH CHECK (store_id = public.current_store_id());

CREATE POLICY frames_cache_delete_same_store
ON public.frames_cache
FOR DELETE
TO authenticated
USING (store_id = public.current_store_id());

COMMIT;

-- =========================================================
-- 6) POS-DEPLOY (execute uma unica vez quando houver usuarios auth)
-- =========================================================
-- Exemplo para vincular seu usuario atual do Supabase Auth ao cadastro interno:
-- UPDATE public.users
-- SET auth_user_id = '<uuid-do-auth-users>'
-- WHERE username = '<seu-usuario>';
