-- Frame Studio Digital: hardening de seguranca (Supabase)
-- Objetivo: remover acesso publico indevido em tabelas do schema public.
--
-- Execute este script no SQL Editor do Supabase para corrigir alertas:
-- - rls_disabled_in_public
--
-- Este modo e adequado para app server-side (Flask), sem acesso direto
-- do frontend ao banco via chaves anon/authenticated.

BEGIN;

-- 1) Fechar permissoes de API publica para roles padrao do Supabase
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 2) Garantir RLS ligado nas tabelas de negocio
ALTER TABLE IF EXISTS public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.store_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.frames_cache ENABLE ROW LEVEL SECURITY;

-- 3) Remover politicas antigas (idempotente) e manter modo fechado
DROP POLICY IF EXISTS stores_public_read ON public.stores;
DROP POLICY IF EXISTS users_public_read ON public.users;
DROP POLICY IF EXISTS clientes_public_read ON public.clientes;
DROP POLICY IF EXISTS consultas_public_read ON public.consultas;
DROP POLICY IF EXISTS store_state_public_read ON public.store_state;
DROP POLICY IF EXISTS frames_cache_public_read ON public.frames_cache;

-- Sem politicas para anon/authenticated => nenhuma linha acessivel via API publica.
-- Para app backend com credencial de banco (servidor), o acesso continua funcional.

COMMIT;
