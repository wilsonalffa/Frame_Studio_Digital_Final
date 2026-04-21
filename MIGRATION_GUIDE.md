# Migração SQLite → Supabase Postgres

## Passos rápidos

### 0.0. Opcional: preparar franquias sem abrir acesso agora
- No Supabase SQL Editor, execute o arquivo abaixo se quiser deixar a base pronta
	para Auth + multiunidade no futuro, mantendo o modo backend-only hoje:
```sql
-- arquivo: sql/supabase_franchise_prep.sql
```
- Esse modo adiciona `auth_user_id`, cria as funcoes auxiliares e mantem o banco
	fechado para `anon` e `authenticated`.

### 0. Aplicar hardening de seguranca (obrigatorio)
- No Supabase SQL Editor, execute o arquivo abaixo:
```sql
-- arquivo: sql/supabase_rls_lockdown.sql
```
- Isso corrige alertas como `rls_disabled_in_public` e bloqueia acesso publico indevido.

### 0.1. Opcional para franquia: RLS multiunidade por loja
- Se futuramente o frontend usar Supabase Auth + acesso direto ao banco, execute:
```sql
-- arquivo: sql/supabase_rls_multitenant.sql
```
- Esse modo permite role `authenticated` com isolamento por `store_id`.
- Nao execute junto com o modo de bloqueio total sem revisar impacto de acesso.
- Se quiser apenas preparar a estrutura e deixar o acesso fechado por enquanto,
  prefira `sql/supabase_franchise_prep.sql`.

### 1. Pegar credentials do Supabase
- Entre em https://supabase.com, abra seu projeto
- Settings → Database → Connection String
- Copie o formato "Direct Connection" (porta 5432)
- Salve em `.env`:
```
DIRECT_URL=postgresql://postgres.SEU_PROJETO:SENHA@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
DATABASE_URL=postgresql://postgres.SEU_PROJETO:SENHA@aws-1-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true
```

### 2. Rodar script de conexão (teste)
```bash
python scripts/check_supabase_connection.py
```
Saída esperada: `✓ Conectado ao Supabase com sucesso.`

### 3. Rodar migração de dados
```bash
python scripts/migrate_sqlite_to_supabase.py
```
Saída esperada: Schema criado + dados migrados.

### 4. Testar app localmente com Supabase
```bash
# Force Postgres em vez de SQLite (para homolog)
export DEBUG_DB_TYPE=postgres

# Inicie app normalmente
python app.py
```
Tudo deve funcionar igual como antes, mas agora em Postgres.

### 5. Voltar para SQLite (se precisar)
```bash
export DEBUG_DB_TYPE=sqlite
python app.py
```

## Fallback automático
- Se `DIRECT_URL` não estiver em `.env` → usa SQLite
- Se `DIRECT_URL` estiver → prioriza Postgres
- `DEBUG_DB_TYPE=sqlite` força SQLite mesmo com credenciais

## Próximos passos (após validar)
1. Remover `DEBUG_DB_TYPE` e deixar app decidir por `DIRECT_URL`
2. Usar `DATABASE_URL` com pooler no seu servidor Rails/Gunicorn
3. Deixar `DIRECT_URL` apenas para migrations offline

---
**Ficheiros criados:**
- `sql/supabase_schema.sql` — Schema Postgres puro
- `scripts/check_supabase_connection.py` — Teste de conexão
- `scripts/migrate_sqlite_to_supabase.py` — Migração de dados
- `db_connection.py` — Wrapper de conexão (SQLite ↔ Postgres)
- `.env.example` — Modelo de vars de ambiente
