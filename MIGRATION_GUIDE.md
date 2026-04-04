# Migração SQLite → Supabase Postgres

## Passos rápidos

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
