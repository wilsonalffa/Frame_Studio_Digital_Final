import os
import sqlite3
import json
from flask import g, has_request_context
from werkzeug.security import generate_password_hash

try:
    import psycopg
    from psycopg.rows import dict_row
except (ModuleNotFoundError, ImportError):
    psycopg = None
    dict_row = None

from core.utils import normalize_store_name, normalize_username, now_iso

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DB_PATH = os.path.join(DATA_DIR, 'fastframe.db')
DATABASE_URL = (os.environ.get('DATABASE_URL') or '').strip()
DIRECT_URL = (os.environ.get('DIRECT_URL') or '').strip()
DB_MODE = (os.environ.get('FF_DB_MODE') or '').strip().lower()

APP_ENV = (os.environ.get('FASTFRAME_ENV') or os.environ.get('FLASK_ENV') or 'development').strip().lower()
IS_PROD = APP_ENV in ('prod', 'production')

APP_USER = os.environ.get('FF_USER', 'fastframe')
APP_PASS = (os.environ.get('FF_PASS') or '').strip()
APP_USER_NAME = (os.environ.get('FF_USER_NAME') or APP_USER).strip() or APP_USER
APP_STORE_NAME = (os.environ.get('FF_STORE_NAME') or APP_USER_NAME).strip() or APP_USER_NAME
AUTO_BOOTSTRAP_USER = str(os.environ.get('FF_AUTO_BOOTSTRAP_USER', '0' if IS_PROD else ('1' if APP_PASS else '0'))).strip().lower() in ('1', 'true', 'yes', 'on')
AUTO_DATA_BACKFILL = str(os.environ.get('FF_AUTO_DATA_BACKFILL', '0')).strip().lower() in ('1', 'true', 'yes', 'on')
SYNC_BOOTSTRAP_USER = str(os.environ.get('FF_SYNC_BOOTSTRAP_USER', '0')).strip().lower() in ('1', 'true', 'yes', 'on')


class CursorCompat:
    def __init__(self, cursor, lastrowid=None):
        self._cursor = cursor
        self.lastrowid = lastrowid

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    def close(self):
        return self._cursor.close()

class ConnectionCompat:
    def __init__(self, conn, backend, close_on_exit=True):
        self._conn = conn
        self.backend = backend
        self._close_on_exit = close_on_exit

    def execute(self, sql, params=()):
        query = sql
        if self.backend == 'postgres':
            query = sql.replace('?', '%s')
        cur = self._conn.cursor()
        cur.execute(query, params)

        lastrowid = None
        if self.backend == 'postgres' and query.lstrip().upper().startswith('INSERT'):
            try:
                cur_id = self._conn.cursor()
                cur_id.execute('SELECT LASTVAL() AS id')
                row = cur_id.fetchone()
                lastrowid = row['id'] if isinstance(row, dict) else row[0]
                cur_id.close()
            except Exception:
                lastrowid = None

        return CursorCompat(cur, lastrowid=lastrowid)

    def executescript(self, script):
        if self.backend == 'sqlite':
            return self._conn.executescript(script)
        cur = self._conn.cursor()
        for stmt in script.split(';'):
            statement = stmt.strip()
            if statement:
                cur.execute(statement)
        cur.close()

    def commit(self):
        self._conn.commit()

    def close(self):
        if self._close_on_exit:
            self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self._conn.commit()
        else:
            try:
                self._conn.rollback()
            except Exception:
                pass
        if self._close_on_exit:
            self._conn.close()


def get_db():
    if has_request_context():
        cached = getattr(g, '_db_conn', None)
        if cached is not None:
            return cached

    prefer_postgres = DB_MODE == 'postgres' or (DB_MODE != 'sqlite' and (DIRECT_URL or DATABASE_URL))

    if prefer_postgres:
        if psycopg is None:
            if DB_MODE == 'postgres':
                raise RuntimeError(
                    'FF_DB_MODE=postgres requer o pacote psycopg.'
                )
            prefer_postgres = False

    if prefer_postgres:
        try:
            dsn = DIRECT_URL or DATABASE_URL
            pg_conn = psycopg.connect(dsn, row_factory=dict_row)
            conn = ConnectionCompat(pg_conn, 'postgres', close_on_exit=not has_request_context())
            if has_request_context():
                g._db_conn = conn
            return conn
        except Exception:
            if DB_MODE == 'postgres':
                raise

    sqlite_conn = sqlite3.connect(DB_PATH)
    sqlite_conn.row_factory = sqlite3.Row
    conn = ConnectionCompat(sqlite_conn, 'sqlite', close_on_exit=not has_request_context())
    if has_request_context():
        g._db_conn = conn
    return conn

def close_request_db(_exc=None):
    conn = getattr(g, '_db_conn', None)
    if conn is None:
        return
    try:
        conn._conn.close()
    except Exception:
        pass
    finally:
        g._db_conn = None

def inserted_id(conn, cursor):
    if cursor and getattr(cursor, 'lastrowid', None):
        return cursor.lastrowid
    if conn.backend == 'postgres':
        row = conn.execute('SELECT LASTVAL() AS id').fetchone()
        return row['id'] if row else None
    row = conn.execute('SELECT last_insert_rowid() AS id').fetchone()
    return row['id'] if row else None

def table_columns(conn, table_name):
    if conn.backend == 'postgres':
        rows = conn.execute(
            '''
            SELECT column_name AS name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ?
            ''',
            (table_name,)
        ).fetchall()
        return {r['name'] for r in rows}
    return {r['name'] for r in conn.execute(f'PRAGMA table_info({table_name})').fetchall()}

def ensure_column(conn, table_name, column_name, definition_sql):
    if conn.backend == 'postgres':
        try:
            conn.execute(f'ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {definition_sql}')
        except Exception:
            try:
                conn._conn.rollback()
            except Exception:
                pass
        return
    if column_name not in table_columns(conn, table_name):
        conn.execute(f'ALTER TABLE {table_name} ADD COLUMN {definition_sql}')

def get_user_row_by_username(conn, username):
    return conn.execute(
        '''
        SELECT u.*, s.name AS store_name, s.is_active AS store_active
        FROM users u
        LEFT JOIN stores s ON s.id = u.store_id
        WHERE lower(u.username) = lower(?)
        LIMIT 1
        ''',
        (normalize_username(username),)
    ).fetchone()

def ensure_bootstrap_user(conn):
    username = normalize_username(APP_USER)
    password = str(APP_PASS or '').strip()
    if not password:
        raise RuntimeError('FF_PASS deve ser definido para criar/sincronizar o usuario bootstrap.')
    display_name = (APP_USER_NAME or username).strip() or username
    store_name = normalize_store_name(APP_STORE_NAME, display_name)
    now = now_iso()

    row = get_user_row_by_username(conn, username)
    password_hash = generate_password_hash(password)

    store_id = None
    if row and row['store_id']:
        store_id = row['store_id']
        conn.execute(
            'UPDATE stores SET name = ?, is_active = ?, updated_at = ? WHERE id = ?',
            (store_name, True, now, store_id)
        )
    else:
        cur_store = conn.execute(
            '''
            INSERT INTO stores (name, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ''',
            (store_name, True, now, now)
        )
        store_id = inserted_id(conn, cur_store)

    if row:
        updates = []
        values = []

        if not row['store_id']:
            updates.append('store_id = ?')
            values.append(store_id)

        if not row['password_hash']:
            updates.append('password_hash = ?')
            values.append(password_hash)
        if not row['display_name']:
            updates.append('display_name = ?')
            values.append(display_name)
        if not row['role']:
            updates.append('role = ?')
            values.append('admin')
        if not row['is_active']:
            updates.append('is_active = ?')
            values.append(True)
        if SYNC_BOOTSTRAP_USER:
            updates.extend(['display_name = ?', 'password_hash = ?', 'role = ?', 'is_active = ?', 'store_id = ?'])
            values.extend([display_name, password_hash, 'admin', True, store_id])

        if updates:
            updates.append('updated_at = ?')
            values.append(now)
            values.append(row['id'])
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", values)
            row = conn.execute('SELECT * FROM users WHERE id = ?', (row['id'],)).fetchone()
        return row['id']

    cur = conn.execute(
        '''
        INSERT INTO users (store_id, username, display_name, password_hash, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (store_id, username, display_name, password_hash, 'admin', True, now, now)
    )
    return inserted_id(conn, cur)

def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    with get_db() as conn:
        if conn.backend == 'sqlite':
            conn.executescript(
            '''
            CREATE TABLE IF NOT EXISTS stores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER,
                username TEXT NOT NULL UNIQUE,
                display_name TEXT,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (store_id) REFERENCES stores(id)
            );

            CREATE TABLE IF NOT EXISTS clientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_user_id INTEGER,
                store_id INTEGER,
                nome TEXT NOT NULL,
                telefone TEXT,
                status TEXT NOT NULL DEFAULT 'novo',
                observacoes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (owner_user_id) REFERENCES users(id),
                FOREIGN KEY (store_id) REFERENCES stores(id)
            );

            CREATE TABLE IF NOT EXISTS consultas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_user_id INTEGER,
                store_id INTEGER,
                cliente_id INTEGER NOT NULL,
                contexto TEXT,
                status TEXT NOT NULL DEFAULT 'em andamento',
                data_orcamento TEXT,
                validade TEXT,
                preco REAL NOT NULL DEFAULT 0,
                desconto REAL NOT NULL DEFAULT 0,
                total REAL NOT NULL DEFAULT 0,
                detalhes TEXT,
                observacoes TEXT,
                pagamentos_json TEXT,
                config_json TEXT,
                imagem_preview TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (cliente_id) REFERENCES clientes(id),
                FOREIGN KEY (owner_user_id) REFERENCES users(id),
                FOREIGN KEY (store_id) REFERENCES stores(id)
            );

            CREATE TABLE IF NOT EXISTS pagamentos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER,
                owner_user_id INTEGER,
                consulta_id INTEGER,
                gateway TEXT NOT NULL DEFAULT 'mercadopago',
                mp_payment_id TEXT,
                mp_preference_id TEXT,
                external_reference TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                amount REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'BRL',
                payment_method TEXT,
                raw_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                approved_at TEXT,
                FOREIGN KEY (store_id) REFERENCES stores(id),
                FOREIGN KEY (owner_user_id) REFERENCES users(id),
                FOREIGN KEY (consulta_id) REFERENCES consultas(id)
            );

            CREATE TABLE IF NOT EXISTS store_state (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER NOT NULL,
                scope TEXT NOT NULL,
                data_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(store_id, scope),
                FOREIGN KEY (store_id) REFERENCES stores(id)
            );

            CREATE TABLE IF NOT EXISTS support_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER NOT NULL,
                user_id INTEGER,
                subject TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'geral',
                severity TEXT NOT NULL DEFAULT 'media',
                status TEXT NOT NULL DEFAULT 'aberto',
                channel TEXT NOT NULL DEFAULT 'painel',
                ai_summary TEXT,
                first_response_at TEXT,
                closed_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (store_id) REFERENCES stores(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS support_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                store_id INTEGER NOT NULL,
                author_user_id INTEGER,
                author_type TEXT NOT NULL DEFAULT 'user',
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (ticket_id) REFERENCES support_tickets(id),
                FOREIGN KEY (store_id) REFERENCES stores(id),
                FOREIGN KEY (author_user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS support_faq (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                tags TEXT,
                category TEXT NOT NULL DEFAULT 'geral',
                priority INTEGER NOT NULL DEFAULT 100,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_stores_name ON stores(name);
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
            CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome);
            CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone);
            CREATE INDEX IF NOT EXISTS idx_consultas_cliente ON consultas(cliente_id);
            CREATE INDEX IF NOT EXISTS idx_consultas_data ON consultas(created_at);
            CREATE INDEX IF NOT EXISTS idx_pagamentos_store ON pagamentos(store_id);
            CREATE INDEX IF NOT EXISTS idx_pagamentos_consulta ON pagamentos(consulta_id);
            CREATE INDEX IF NOT EXISTS idx_pagamentos_mp_payment ON pagamentos(mp_payment_id);
            CREATE INDEX IF NOT EXISTS idx_pagamentos_mp_preference ON pagamentos(mp_preference_id);
            CREATE INDEX IF NOT EXISTS idx_store_state_store_scope ON store_state(store_id, scope);
            CREATE INDEX IF NOT EXISTS idx_support_tickets_store_status ON support_tickets(store_id, status, created_at);
            CREATE INDEX IF NOT EXISTS idx_support_tickets_store_severity ON support_tickets(store_id, severity, created_at);
            CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_time ON support_messages(ticket_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_support_faq_active_priority ON support_faq(is_active, priority, updated_at);

            CREATE TABLE IF NOT EXISTS frames_cache (
                id TEXT PRIMARY KEY,
                store_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                image_b64 TEXT NOT NULL,
                metadata TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (store_id) REFERENCES stores(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_frames_store_time ON frames_cache(store_id, created_at);
            '''
            )

            ensure_column(conn, 'users', 'store_id', 'store_id INTEGER')
            ensure_column(conn, 'users', 'display_name', 'display_name TEXT')
            ensure_column(conn, 'users', 'role', "role TEXT NOT NULL DEFAULT 'user'")
            ensure_column(conn, 'users', 'is_active', 'is_active INTEGER NOT NULL DEFAULT 1')
            ensure_column(conn, 'users', 'last_login_at', 'last_login_at TEXT')
            ensure_column(conn, 'users', 'login_count', 'login_count INTEGER NOT NULL DEFAULT 0')
            ensure_column(conn, 'clientes', 'owner_user_id', 'owner_user_id INTEGER')
            ensure_column(conn, 'clientes', 'store_id', 'store_id INTEGER')
            ensure_column(conn, 'consultas', 'owner_user_id', 'owner_user_id INTEGER')
            ensure_column(conn, 'consultas', 'store_id', 'store_id INTEGER')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_users_store ON users(store_id)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_clientes_owner ON clientes(owner_user_id)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_clientes_store ON clientes(store_id)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_consultas_owner ON consultas(owner_user_id)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_consultas_store ON consultas(store_id)')

            cols = table_columns(conn, 'consultas')
            if 'status' not in cols:
                conn.execute("ALTER TABLE consultas ADD COLUMN status TEXT NOT NULL DEFAULT 'em andamento'")
        else:
            conn.executescript(
            '''
            CREATE TABLE IF NOT EXISTS stores (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                name TEXT NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS users (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                store_id BIGINT REFERENCES stores(id),
                username TEXT NOT NULL UNIQUE,
                display_name TEXT,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                last_login_at TEXT,
                login_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS clientes (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                owner_user_id BIGINT REFERENCES users(id),
                store_id BIGINT REFERENCES stores(id),
                nome TEXT NOT NULL,
                telefone TEXT,
                status TEXT NOT NULL DEFAULT 'novo',
                observacoes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS consultas (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                owner_user_id BIGINT REFERENCES users(id),
                store_id BIGINT REFERENCES stores(id),
                cliente_id BIGINT NOT NULL REFERENCES clientes(id),
                contexto TEXT,
                status TEXT NOT NULL DEFAULT 'em andamento',
                data_orcamento TEXT,
                validade TEXT,
                preco DOUBLE PRECISION NOT NULL DEFAULT 0,
                desconto DOUBLE PRECISION NOT NULL DEFAULT 0,
                total DOUBLE PRECISION NOT NULL DEFAULT 0,
                detalhes TEXT,
                observacoes TEXT,
                pagamentos_json JSONB,
                config_json JSONB,
                imagem_preview TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS pagamentos (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                store_id BIGINT REFERENCES stores(id),
                owner_user_id BIGINT REFERENCES users(id),
                consulta_id BIGINT REFERENCES consultas(id),
                gateway TEXT NOT NULL DEFAULT 'mercadopago',
                mp_payment_id TEXT,
                mp_preference_id TEXT,
                external_reference TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                amount DOUBLE PRECISION NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'BRL',
                payment_method TEXT,
                raw_json JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                approved_at TIMESTAMPTZ
            );

            CREATE TABLE IF NOT EXISTS store_state (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                store_id BIGINT NOT NULL REFERENCES stores(id),
                scope TEXT NOT NULL,
                data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(store_id, scope)
            );

            CREATE TABLE IF NOT EXISTS support_tickets (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                store_id BIGINT NOT NULL REFERENCES stores(id),
                user_id BIGINT REFERENCES users(id),
                subject TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'geral',
                severity TEXT NOT NULL DEFAULT 'media',
                status TEXT NOT NULL DEFAULT 'aberto',
                channel TEXT NOT NULL DEFAULT 'painel',
                ai_summary TEXT,
                first_response_at TEXT,
                closed_at TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS support_messages (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                ticket_id BIGINT NOT NULL REFERENCES support_tickets(id),
                store_id BIGINT NOT NULL REFERENCES stores(id),
                author_user_id BIGINT REFERENCES users(id),
                author_type TEXT NOT NULL DEFAULT 'user',
                message TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS support_faq (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                tags TEXT,
                category TEXT NOT NULL DEFAULT 'geral',
                priority INTEGER NOT NULL DEFAULT 100,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS frames_cache (
                id TEXT PRIMARY KEY,
                store_id BIGINT NOT NULL REFERENCES stores(id),
                user_id BIGINT NOT NULL REFERENCES users(id),
                image_b64 TEXT NOT NULL,
                metadata JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_stores_name ON stores(name);
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
            CREATE INDEX IF NOT EXISTS idx_users_store ON users(store_id);
            CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome);
            CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone);
            CREATE INDEX IF NOT EXISTS idx_clientes_owner ON clientes(owner_user_id);
            CREATE INDEX IF NOT EXISTS idx_clientes_store ON clientes(store_id);
            CREATE INDEX IF NOT EXISTS idx_consultas_cliente ON consultas(cliente_id);
            CREATE INDEX IF NOT EXISTS idx_consultas_data ON consultas(created_at);
            CREATE INDEX IF NOT EXISTS idx_consultas_owner ON consultas(owner_user_id);
            CREATE INDEX IF NOT EXISTS idx_consultas_store ON consultas(store_id);
            CREATE INDEX IF NOT EXISTS idx_pagamentos_store ON pagamentos(store_id);
            CREATE INDEX IF NOT EXISTS idx_pagamentos_consulta ON pagamentos(consulta_id);
            CREATE INDEX IF NOT EXISTS idx_pagamentos_mp_payment ON pagamentos(mp_payment_id);
            CREATE INDEX IF NOT EXISTS idx_pagamentos_mp_preference ON pagamentos(mp_preference_id);
            CREATE INDEX IF NOT EXISTS idx_store_state_store_scope ON store_state(store_id, scope);
            CREATE INDEX IF NOT EXISTS idx_support_tickets_store_status ON support_tickets(store_id, status, created_at);
            CREATE INDEX IF NOT EXISTS idx_support_tickets_store_severity ON support_tickets(store_id, severity, created_at);
            CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_time ON support_messages(ticket_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_support_faq_active_priority ON support_faq(is_active, priority, updated_at);
            CREATE INDEX IF NOT EXISTS idx_frames_store_time ON frames_cache(store_id, created_at);
            '''
            )

            ensure_column(conn, 'users', 'store_id', 'store_id BIGINT')
            ensure_column(conn, 'users', 'display_name', 'display_name TEXT')
            ensure_column(conn, 'users', 'role', "role TEXT NOT NULL DEFAULT 'user'")
            ensure_column(conn, 'users', 'is_active', 'is_active BOOLEAN NOT NULL DEFAULT TRUE')
            ensure_column(conn, 'users', 'last_login_at', 'last_login_at TEXT')
            ensure_column(conn, 'users', 'login_count', 'login_count INTEGER NOT NULL DEFAULT 0')
            ensure_column(conn, 'clientes', 'owner_user_id', 'owner_user_id BIGINT')
            ensure_column(conn, 'clientes', 'store_id', 'store_id BIGINT')
            ensure_column(conn, 'consultas', 'owner_user_id', 'owner_user_id BIGINT')
            ensure_column(conn, 'consultas', 'store_id', 'store_id BIGINT')

        bootstrap_user_id = ensure_bootstrap_user(conn) if AUTO_BOOTSTRAP_USER else None
        if bootstrap_user_id is None:
            bootstrap_row = get_user_row_by_username(conn, APP_USER)
            bootstrap_user_id = bootstrap_row['id'] if bootstrap_row else None

        ensure_support_faq_defaults(conn)

        if not AUTO_DATA_BACKFILL:
            return

        now = now_iso()
        usuarios_sem_loja = conn.execute(
            'SELECT id, username, display_name FROM users WHERE store_id IS NULL ORDER BY id'
        ).fetchall()
        for user in usuarios_sem_loja:
            nome_loja = normalize_store_name(user['display_name'] or user['username'], f'Loja {user["id"]}')
            cur_store = conn.execute(
                'INSERT INTO stores (name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?)',
                (nome_loja, True, now, now)
            )
            conn.execute(
                'UPDATE users SET store_id = ?, updated_at = ? WHERE id = ?',
                (inserted_id(conn, cur_store), now, user['id'])
            )

        if bootstrap_user_id:
            conn.execute('UPDATE clientes SET owner_user_id = ? WHERE owner_user_id IS NULL', (bootstrap_user_id,))
        conn.execute(
            '''
            UPDATE clientes
            SET store_id = (
                SELECT u.store_id
                FROM users u
                WHERE u.id = clientes.owner_user_id
            )
            WHERE store_id IS NULL AND owner_user_id IS NOT NULL
            '''
        )
        conn.execute(
            '''
            UPDATE consultas
            SET owner_user_id = (
                SELECT c.owner_user_id
                FROM clientes c
                WHERE c.id = consultas.cliente_id
            )
            WHERE owner_user_id IS NULL AND cliente_id IS NOT NULL
            '''
        )
        conn.execute(
            '''
            UPDATE consultas
            SET store_id = (
                SELECT c.store_id
                FROM clientes c
                WHERE c.id = consultas.cliente_id
            )
            WHERE store_id IS NULL AND cliente_id IS NOT NULL
            '''
        )
        bootstrap_store_row = conn.execute('SELECT store_id FROM users WHERE id = ?', (bootstrap_user_id,)).fetchone() if bootstrap_user_id else None
        bootstrap_store_id = bootstrap_store_row['store_id'] if bootstrap_store_row else None
        if bootstrap_store_id:
            conn.execute('UPDATE clientes SET store_id = ? WHERE store_id IS NULL', (bootstrap_store_id,))
            conn.execute('UPDATE consultas SET store_id = ? WHERE store_id IS NULL', (bootstrap_store_id,))
        if bootstrap_user_id:
            conn.execute('UPDATE consultas SET owner_user_id = ? WHERE owner_user_id IS NULL', (bootstrap_user_id,))

def get_store_by_id(store_id):
    if not store_id:
        return None
    with get_db() as conn:
        row = conn.execute('SELECT * FROM stores WHERE id = ?', (store_id,)).fetchone()
    from core.utils import row_to_store
    return row_to_store(row)

def get_user_by_id(user_id):
    if not user_id:
        return None
    with get_db() as conn:
        row = conn.execute(
            '''
            SELECT u.*, s.name AS store_name, s.is_active AS store_active
            FROM users u
            LEFT JOIN stores s ON s.id = u.store_id
            WHERE u.id = ?
            ''',
            (user_id,)
        ).fetchone()
    from core.utils import row_to_user
    return row_to_user(row)

def load_store_state(conn, store_id, scope):
    from core.utils import normalize_store_state_scope, decode_json_field
    normalized = normalize_store_state_scope(scope)
    if not normalized or not store_id:
        return None
    row = conn.execute(
        'SELECT * FROM store_state WHERE store_id = ? AND scope = ?',
        (store_id, normalized)
    ).fetchone()
    if not row:
        return None
    return {
        'scope': normalized,
        'data': decode_json_field(row['data_json'], {}),
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
    }

def save_store_state(conn, store_id, scope, data):
    from core.utils import normalize_store_state_scope
    normalized = normalize_store_state_scope(scope)
    if not normalized:
        raise ValueError('Escopo de armazenamento invalido.')
    if not store_id:
        raise ValueError('Loja nao identificada.')
    if not isinstance(data, dict):
        raise ValueError('Os dados enviados devem ser um objeto JSON.')

    now = now_iso()
    payload = json.dumps(data, ensure_ascii=False)
    conn.execute(
        '''
        INSERT INTO store_state (store_id, scope, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(store_id, scope)
        DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
        ''',
        (store_id, normalized, payload, now, now)
    )
    return load_store_state(conn, store_id, normalized)

def count_active_admins(conn):
    row = conn.execute(
        "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = ?",
        (True,)
    ).fetchone()
    return int(row['total'] or 0)


def ensure_support_faq_defaults(conn):
    now = now_iso()

    def _ptbr_text(text):
        value = str(text or '')
        replacements = [
            ('Nao', 'Não'),
            ('nao', 'não'),
            ('Duvida', 'Dúvida'),
            ('duvida', 'dúvida'),
            ('duvidas', 'dúvidas'),
            ('esta', 'está'),
            ('Esta', 'Está'),
            ('ja', 'já'),
            ('Ja', 'Já'),
            ('sera', 'será'),
            ('Sera', 'Será'),
            ('voce', 'você'),
            ('Voce', 'Você'),
            ('voces', 'vocês'),
            ('Vocês', 'Vocês'),
            ('apos', 'após'),
            ('Apos', 'Após'),
            ('espacos', 'espaços'),
            ('simulacao', 'simulação'),
            ('Simulacao', 'Simulação'),
            ('simulacoes', 'simulações'),
            ('simulador', 'simulador'),
            ('dimensoes', 'dimensões'),
            ('dimensao', 'dimensão'),
            ('especifico', 'específico'),
            ('especifica', 'específica'),
            ('especificos', 'específicos'),
            ('especificas', 'específicas'),
            ('Divisao', 'Divisão'),
            ('divisao', 'divisão'),
            ('orientacao', 'orientação'),
            ('Orientacao', 'Orientação'),
            ('paineis', 'painéis'),
            ('Paineis', 'Painéis'),
            ('composicao', 'composição'),
            ('Composicao', 'Composição'),
            ('Catalogo', 'Catálogo'),
            ('catalogo', 'catálogo'),
            ('historico', 'histórico'),
            ('Historico', 'Histórico'),
            ('observacoes', 'observações'),
            ('obrigatorios', 'obrigatórios'),
            ('obrigatorio', 'obrigatório'),
            ('anonima', 'anônima'),
            ('pagina', 'página'),
            ('paginas', 'páginas'),
            ('maquina', 'máquina'),
            ('maquinas', 'máquinas'),
            ('urgencia', 'urgência'),
            ('priorizacao', 'priorização'),
            ('rapido', 'rápido'),
            ('varias', 'várias'),
            ('varios', 'vários'),
            ('necessario', 'necessário'),
            ('necessaria', 'necessária'),
            ('modulo', 'módulo'),
            ('gestao', 'gestão'),
            ('resolucao', 'resolução'),
            ('definicao', 'definição'),
            ('saturacao', 'saturação'),
            ('suavizacao', 'suavização'),
            ('impressao', 'impressão'),
            ('aceitavel', 'aceitável'),
            ('calibracao', 'calibração'),
            ('pe-direito', 'pé-direito'),
            ('aprovacao', 'aprovação'),
            ('metodo', 'método'),
            ('automatico', 'automático'),
            ('periodo', 'período'),
            ('unico', 'único'),
            ('funcionalidades', 'funcionalidades'),
            ('tambem', 'também'),
            ('titulo', 'título'),
            ('edite', 'edite'),
            ('pagine', 'pagine'),
            ('quais', 'quais'),
            ('orcamento', 'orçamento'),
            ('Orcamento', 'Orçamento'),
            ('d agua', "d'água"),
        ]
        for old, new in replacements:
            value = value.replace(old, new)
        return value

    defaults = [
        {
            'question': 'Nao consigo fazer login no sistema',
            'answer': 'Verifique se o login foi digitado sem espacos, use a senha mais recente e confirme se a unidade esta ativa. Se continuar, envie print da tela de erro e horario para o suporte desbloquear rapidamente.',
            'tags': 'login,acesso,senha,entrar',
            'category': 'acesso',
            'priority': 10,
        },
        {
            'question': 'A simulacao esta travando ou muito lenta',
            'answer': 'Atualize a pagina, feche abas pesadas do navegador e tente uma imagem menor que 20MB. Em seguida, abra novamente a aba de simulacao. Se persistir, informe dispositivo, navegador e horario.',
            'tags': 'simulador,lento,travando,desempenho',
            'category': 'simulador',
            'priority': 20,
        },
        {
            'question': 'Nao consigo gerar ou baixar o PDF do orçamento',
            'answer': 'Passo a passo: 1) Clique em Gerar Orcamento. 2) Preencha cliente, itens, valores e observacoes obrigatorias. 3) Confirme se existe valor total maior que zero. 4) Clique em Gerar PDF e aguarde a montagem. 5) Se o download nao iniciar, libere pop-up/download para este site e tente novamente. 6) Se ainda falhar, abra em aba anonima e repita o processo com os mesmos dados.',
            'tags': 'orcamento,pdf,baixar,download',
            'category': 'orcamento',
            'priority': 30,
        },
        {
            'question': 'Checkout ou pagamento nao aparece para o cliente',
            'answer': 'Atualize os pagamentos na aba Admin e gere um novo link de checkout. Confirme se o atendimento possui valor total maior que zero. Se continuar sem link, encaminhe o ID do atendimento ao suporte.',
            'tags': 'pagamento,checkout,mercado pago,link',
            'category': 'financeiro',
            'priority': 40,
        },
        {
            'question': 'Como abrir um chamado de suporte',
            'answer': 'Use o painel de suporte dentro do sistema, descreva o problema com horario e impacto, e acompanhe o protocolo gerado (SUP-xxxxxx). Para urgencia, marque detalhes no texto para priorizacao.',
            'tags': 'suporte,chamado,protocolo,ajuda',
            'category': 'geral',
            'priority': 50,
        },
        {
            'question': 'Passo a passo da aba Imagem e Qualidade',
            'answer': '1) Abra Imagem e Qualidade. 2) Envie uma imagem ou PDF. 3) Confira dimensoes e qualidade geral. 4) Use Verificar tamanho especifico para largura e altura desejadas. 5) Se estiver ok, avance para Divisao ou Simulacao.',
            'tags': 'passo a passo,imagem,qualidade,dpi,fluxo,aba',
            'category': 'geral',
            'priority': 60,
        },
        {
            'question': 'Passo a passo da aba Divisao e Sangria',
            'answer': '1) Abra Divisao e Sangria com a imagem carregada. 2) Escolha modo: horizontal, vertical ou grade. 3) Defina partes e tamanho total em cm. 4) Ajuste tamanhos de cada parte se necessario. 5) Aplique sangria para chassi e exporte.',
            'tags': 'passo a passo,divisao,sangria,painel,canvas,fluxo,aba',
            'category': 'geral',
            'priority': 61,
        },
        {
            'question': 'Passo a passo da aba Simulacao de Quadros',
            'answer': '1) Abra Simulacao de Quadros. 2) Carregue a arte (ou aproveite a ja enviada). 3) Ajuste moldura: espessura e cor. 4) Ative passepartout se quiser e ajuste borda/cor. 5) Baixe JPEG ou salve na biblioteca.',
            'tags': 'passo a passo,simulacao,quadro,moldura,passepartout,fluxo,aba',
            'category': 'simulador',
            'priority': 62,
        },
        {
            'question': 'Passo a passo da aba Simulacao de Ambiente',
            'answer': '1) Escolha um ambiente pronto ou envie foto da parede. 2) Adicione um ou mais quadros. 3) Posicione, redimensione e ajuste composicao. 4) Se precisar, calibre escala real da parede. 5) Exporte JPEG ou salve a simulacao.',
            'tags': 'passo a passo,simulacao,ambiente,parede,escala,fluxo,aba',
            'category': 'simulador',
            'priority': 63,
        },
        {
            'question': 'Passo a passo da aba Catalogo',
            'answer': '1) Entre em Catalogo. 2) Crie pastas para organizar temas. 3) Importe imagens e PDFs. 4) Use busca e filtros para localizar itens. 5) Aplique o item direto nas simulacoes ou salve no historico.',
            'tags': 'passo a passo,catalogo,pastas,importar,organizar,fluxo,aba',
            'category': 'geral',
            'priority': 64,
        },
        {
            'question': 'Passo a passo da aba Clientes',
            'answer': '1) Abra Clientes e selecione ou crie um cliente durante o atendimento. 2) Atualize status e observacoes. 3) Consulte historico por busca, tipo e periodo. 4) Reaproveite atendimentos anteriores para novo orcamento.',
            'tags': 'passo a passo,clientes,historico,status,orcamento,fluxo,aba',
            'category': 'geral',
            'priority': 65,
        },
        {
            'question': 'Passo a passo da aba Admin',
            'answer': '1) Abra Admin para monitoramento geral. 2) Revise dashboard de unidades e resultados. 3) Gerencie pagamentos e checkout quando necessario. 4) Use suporte operacional para acompanhar chamados. 5) Cadastre e ajuste acessos das unidades.',
            'tags': 'passo a passo,admin,dashboard,pagamentos,suporte,usuarios,fluxo,aba',
            'category': 'geral',
            'priority': 66,
        },
        {
            'question': 'Como usar Divisao e Sangria',
            'answer': 'Fluxo rapido: 1) Envie a imagem. 2) Escolha horizontal, vertical ou grade. 3) Defina largura e altura totais em cm e aplique. 4) Ajuste cada parte se preciso. 5) Clique em Aplicar Sangria para gerar bordas espelhadas e depois baixe as partes.',
            'tags': 'divisao,sangria,partes,painel,canvas,chassi,como usar,fluxo',
            'category': 'simulador',
            'priority': 67,
        },
        {
            'question': 'Como usar Simulacao de Quadros',
            'answer': 'Fluxo rapido: 1) Carregue a arte. 2) Ajuste espessura e cor da moldura. 3) Ative passepartout e personalize borda/cor. 4) Revise no canvas em tempo real. 5) Exporte JPEG ou salve na biblioteca para reutilizar.',
            'tags': 'simulacao,quadro,quadros,moldura,passepartout,jpeg,biblioteca,como usar',
            'category': 'simulador',
            'priority': 68,
        },
        {
            'question': 'Como usar Simulacao de Ambiente',
            'answer': 'Fluxo rapido: 1) Escolha ambiente pronto ou suba foto da parede. 2) Adicione um ou mais quadros. 3) Arraste, redimensione e ajuste composicao. 4) Se quiser escala real, calibre os pontos da parede/movel. 5) Exporte JPEG ou salve no catalogo.',
            'tags': 'simulacao,ambiente,ambinte,parede,escala,calibracao,quadros,como usar',
            'category': 'simulador',
            'priority': 69,
        },
        {
            'question': 'Como usar Montagem Multi-fotos',
            'answer': 'Fluxo rapido: 1) Envie varias fotos de uma vez. 2) Ajuste base (largura/altura), passepartout e moldura. 3) Arraste cada foto para posicionar no layout. 4) Selecione a foto para editar tamanho e modo sem corte/preencher. 5) Baixe a imagem final.',
            'tags': 'montagem,multi fotos,layout,arrastar,passepartout,moldura,como usar',
            'category': 'simulador',
            'priority': 70,
        },
        {
            'question': 'Como usar a aba Clientes',
            'answer': 'Fluxo rapido: 1) Selecione um cliente na lista. 2) Atualize nome, telefone, status e observacoes. 3) Abra o Historico para filtrar atendimentos por tipo/status/periodo. 4) Gere novo orcamento com base no historico quando necessario.',
            'tags': 'clientes,cliente,historico,status,filtros,orcamento,crm,como usar',
            'category': 'geral',
            'priority': 71,
        },
        {
            'question': 'Como usar Imagem e Qualidade',
            'answer': 'Fluxo rapido: 1) Carregue imagem ou PDF. 2) Veja qualidade geral e maior tamanho recomendado. 3) Use Verificar tamanho especifico para largura/altura desejadas. 4) Opcional: abra Tamanho Personalizado para recorte e enquadramento. 5) Avance para divisao ou simulacao.',
            'tags': 'imagem,qualidade,dpi,tamanho,verificar,personalizado,recorte,enquadramento,como usar',
            'category': 'geral',
            'priority': 72,
        },
        {
            'question': 'Como usar o Melhorador de Imagem',
            'answer': 'No card Melhorador: 1) Escolha escala 1x, 2x, 3x ou 4x. 2) Ajuste brilho, contraste, saturacao, nitidez e suavizacao. 3) Teste filtros rapidos (Original, P&B, Sepia, Vivido). 4) Compare antes/depois. 5) Baixe em JPEG.',
            'tags': 'melhorador,upscale,resolucao,filtros,brilho,contraste,nitidez,jpeg',
            'category': 'geral',
            'priority': 73,
        },
        {
            'question': 'Como usar o Catalogo de Imagens',
            'answer': '1) Crie pastas para organizar temas. 2) Importe PDFs e imagens. 3) Use busca e filtro por tipo. 4) Abra item para aplicar nas simulacoes. 5) Use exportar/importar banco para backup e migracao local.',
            'tags': 'catalogo,pastas,importar,pdf,imagens,busca,filtro,backup,migracao',
            'category': 'geral',
            'priority': 74,
        },
        {
            'question': 'Como calibrar escala na Simulacao de Ambiente',
            'answer': 'Para escala real: 1) Informe largura da parede e pe-direito. 2) Se houver movel, informe altura e marque topo/base. 3) Marque bordas esquerda/direita e teto/piso no canvas. 4) Clique em Aplicar. 5) Ajuste os quadros em cm com a escala ativa.',
            'tags': 'calibrar,escala,parede,pe direito,movel,marcacao,simulacao ambiente',
            'category': 'simulador',
            'priority': 75,
        },
        {
            'question': 'Como aplicar composicao uniforme no ambiente',
            'answer': 'Selecione um quadro com o estilo desejado e clique em Aplicar estilo a todos os quadros. O sistema replica tamanho, moldura, passepartout e sombra para manter padrao visual da composicao.',
            'tags': 'composicao uniforme,aplicar estilo,todos os quadros,moldura,passepartout,sombra',
            'category': 'simulador',
            'priority': 76,
        },
        {
            'question': 'Como funciona o fluxo completo entre as abas',
            'answer': 'Fluxo recomendado: 1) Imagem e Qualidade para validar tamanho e definicao. 2) Divisao e Sangria para montar paineis. 3) Simulacao de Quadros para estilo final. 4) Simulacao de Ambiente para aprovacao visual. 5) Orcamento/Clientes para fechamento.',
            'tags': 'fluxo completo,abas,passo a passo,processo,atendimento',
            'category': 'geral',
            'priority': 77,
        },
        {
            'question': 'Quais funcionalidades existem na aba Admin',
            'answer': 'Na aba Admin voce encontra: dashboard de monitoramento por unidade, gestao de pagamentos Mercado Pago, suporte operacional com chamados e gestao de unidades/acessos com perfis e status.',
            'tags': 'admin,monitoramento,pagamentos,mercado pago,suporte,usuarios,unidades',
            'category': 'geral',
            'priority': 78,
        },
        {
            'question': 'Nao encontro resposta para minha aba',
            'answer': 'Tente perguntar citando a aba pelo nome, por exemplo: "como usar divisao e sangria" ou "passo a passo simulacao de ambiente". Se ainda nao resolver, clique em Ainda preciso de ajuda para abrir chamado automatico ao suporte.',
            'tags': 'aba,resposta,ajuda,autoatendimento,chamado',
            'category': 'geral',
            'priority': 79,
        },
        {
            'question': 'Como verificar um tamanho especifico na aba Imagem e Qualidade',
            'answer': 'Use o bloco Verificar um Tamanho Especifico: informe largura e altura em cm e clique em Verificar. O sistema calcula o DPI para esse tamanho e mostra se a qualidade fica excelente, aceitavel ou baixa para impressao.',
            'tags': 'imagem,qualidade,verificar,dpi,largura,altura,tamanho especifico',
            'category': 'geral',
            'priority': 80,
        },
        {
            'question': 'Como usar o Tamanho Personalizado da Imagem',
            'answer': 'No card Tamanho Personalizado, ajuste largura e altura, escolha Preencher ou Encaixar, use zoom e arraste para enquadrar. Depois clique em Salvar imagem ou Aplicar no Verificador para validar a qualidade no tamanho final.',
            'tags': 'tamanho personalizado,recorte,enquadramento,preencher,encaixar,zoom,verificador',
            'category': 'geral',
            'priority': 81,
        },
        {
            'question': 'Como funciona o modo Grade na Divisao e Sangria',
            'answer': 'Selecione o modo Grade e defina Colunas e Linhas (ex.: 2x2). O total de partes e calculado automaticamente. Depois aplique o tamanho total em cm e ajuste cada painel no bloco Tamanho de Cada Parte, se necessario.',
            'tags': 'divisao,grade,colunas,linhas,painel,partes,2x2',
            'category': 'simulador',
            'priority': 82,
        },
        {
            'question': 'Como ajustar cada painel individualmente na Divisao',
            'answer': 'Apos definir a composicao, use a tabela Tamanho de Cada Parte (cm) para editar largura e altura de cada painel. Em seguida clique em Aplicar Composicao para atualizar o preview e os downloads.',
            'tags': 'divisao,painel,parte individual,tamanho de cada parte,aplicar composicao',
            'category': 'simulador',
            'priority': 83,
        },
        {
            'question': 'Quando usar Aplicar Sangria e Remover Sangria',
            'answer': 'Use Aplicar Sangria quando a arte sera montada em chassi, pois adiciona bordas espelhadas para dobra. Use Remover Sangria quando quiser voltar ao corte limpo sem bordas extras para outros tipos de impressao.',
            'tags': 'sangria,aplicar sangria,remover sangria,chassi,borda espelhada',
            'category': 'simulador',
            'priority': 84,
        },
        {
            'question': 'Como enviar a divisao para Simulacao de Quadros',
            'answer': 'Na aba Divisao e Sangria, depois da composicao pronta, clique em Ir para simulacao. O sistema reaproveita a imagem/composicao atual para voce continuar o fluxo visual na aba Simulacao de Quadros.',
            'tags': 'divisao,ir para simulacao,simulacao de quadros,fluxo entre abas',
            'category': 'simulador',
            'priority': 85,
        },
        {
            'question': 'Como trocar cor e espessura da moldura na Simulacao de Quadros',
            'answer': 'Use o slider Espessura para ajustar a largura da moldura em cm e clique nas amostras de cor (ou seletor de cor) para personalizar. O preview no canvas atualiza em tempo real.',
            'tags': 'simulacao de quadros,moldura,espessura,cor,preview',
            'category': 'simulador',
            'priority': 86,
        },
        {
            'question': 'Como ativar e configurar passepartout na Simulacao de Quadros',
            'answer': 'Marque Ativar Passepartout, ajuste a borda em cm no slider e escolha a cor nas amostras ou no seletor. O passepartout e aplicado dentro da moldura para destacar a arte.',
            'tags': 'simulacao de quadros,passepartout,borda,cor,ativar',
            'category': 'simulador',
            'priority': 87,
        },
        {
            'question': 'Como salvar a simulacao de quadro na biblioteca',
            'answer': 'Na aba Simulacao de Quadros, finalize o visual e clique em Salvar na Biblioteca. Isso grava a simulacao para reutilizar no Catalogo e no historico da unidade.',
            'tags': 'simulacao de quadros,salvar na biblioteca,catalogo,historico',
            'category': 'simulador',
            'priority': 88,
        },
        {
            'question': 'Como adicionar e organizar varios quadros na Simulacao de Ambiente',
            'answer': 'Clique em + Adicionar Quadro para inserir imagens, arraste no canvas para posicionar e use os pontos de redimensionamento. Selecione um quadro para ajustar tamanho e estilo no painel lateral.',
            'tags': 'simulacao de ambiente,adicionar quadro,arrastar,redimensionar,varios quadros',
            'category': 'simulador',
            'priority': 89,
        },
        {
            'question': 'Como travar composicao e usar guias no ambiente',
            'answer': 'Use o botao Composicao para travar/destravar movimento conjunto e o botao Guias ON para mostrar referencias visuais. Isso facilita alinhamento e espacamento entre quadros.',
            'tags': 'simulacao de ambiente,travar composicao,guias,alinhamento,espacamento',
            'category': 'simulador',
            'priority': 90,
        },
        {
            'question': 'Como usar marca d agua na Simulacao de Ambiente',
            'answer': 'Ative marca d\'agua, escolha modo Texto ou Logo, ajuste tamanho, posicao, rotacao e transparencia. Voce tambem pode travar o arraste da marca e centralizar com um clique.',
            'tags': 'marca d agua,logo,texto,transparencia,rotacao,simulacao de ambiente',
            'category': 'simulador',
            'priority': 91,
        },
        {
            'question': 'Como importar PDF e imagens no Catalogo',
            'answer': 'No Catalogo, use Importar PDF para paginas de catalogo e Importar Imagens para arquivos avulsos. Depois organize em pastas, use busca/filtro e aplique os itens nas simulacoes.',
            'tags': 'catalogo,importar pdf,importar imagens,pastas,busca,filtro',
            'category': 'geral',
            'priority': 92,
        },
        {
            'question': 'Como exportar e importar o banco do Catalogo',
            'answer': 'Use Exportar Banco para gerar backup dos dados locais do catalogo e Importar Banco para restaurar em outro navegador/equipamento. Faca isso antes de formatacao ou troca de maquina.',
            'tags': 'catalogo,exportar banco,importar banco,backup,restaurar',
            'category': 'geral',
            'priority': 93,
        },
        {
            'question': 'Como usar o Historico de Simulacoes no Catalogo',
            'answer': 'Abra o bloco Historico de Simulacoes para recuperar trabalhos anteriores e restaurar rapidamente quadro ou ambiente. Isso acelera revisoes e reaproveitamento em novos atendimentos.',
            'tags': 'catalogo,historico de simulacoes,restaurar,reaproveitar',
            'category': 'geral',
            'priority': 94,
        },
        {
            'question': 'Como ajustar foto selecionada na Montagem Multi-fotos',
            'answer': 'Selecione uma foto no layout para habilitar os campos de Largura, Altura e Modo (Sem corte/Preencher). Ajuste esses controles para equilibrar a composicao sem perder o enquadramento desejado.',
            'tags': 'montagem,foto selecionada,largura,altura,sem corte,preencher',
            'category': 'simulador',
            'priority': 95,
        },
        {
            'question': 'Como limpar e baixar na Montagem Multi-fotos',
            'answer': 'Use Limpar Tudo para reiniciar a composicao do zero. Quando finalizar, clique em Baixar Imagem para exportar o resultado. Se quiser reutilizar depois, use Salvar na Biblioteca.',
            'tags': 'montagem,limpar tudo,baixar imagem,salvar na biblioteca',
            'category': 'simulador',
            'priority': 96,
        },
        {
            'question': 'Como atualizar status e observacoes de clientes',
            'answer': 'Na aba Clientes, selecione um cliente na lista, edite status e observacoes no formulario e clique em Atualizar Cliente. Isso organiza o funil entre em andamento, aguardando e finalizado.',
            'tags': 'clientes,status,observacoes,atualizar cliente,funil',
            'category': 'geral',
            'priority': 97,
        },
        {
            'question': 'Como filtrar historico de clientes por periodo e status',
            'answer': 'No Historico do Cliente, use os filtros de busca, tipo, status e periodo (7, 30, 90 dias). Combine os filtros para achar atendimentos especificos e acelerar acompanhamento comercial.',
            'tags': 'clientes,historico,filtros,periodo,status,busca',
            'category': 'geral',
            'priority': 98,
        },
        {
            'question': 'Como usar suporte operacional da unidade',
            'answer': 'Preencha assunto, categoria, canal e descricao, depois clique em Abrir Chamado. Acompanhe pelo protocolo, responda no detalhe do chamado e use Atualizar para ver novas mensagens e status.',
            'tags': 'suporte operacional,chamado,protocolo,responder,status,unidade',
            'category': 'geral',
            'priority': 99,
        },
        {
            'question': 'Como usar pagamentos Mercado Pago na aba Admin',
            'answer': 'Na aba Admin, informe o ID do atendimento, gere checkout e compartilhe o link com o cliente. Depois use Atualizar para acompanhar status do pagamento, metodo, valor e data de aprovacao.',
            'tags': 'admin,mercado pago,checkout,pagamentos,id atendimento,status',
            'category': 'financeiro',
            'priority': 100,
        },
        {
            'question': 'Como criar e gerenciar acessos de unidades na aba Admin',
            'answer': 'Em Unidades e Acessos, preencha nome da unidade, login, senha, perfil e status. Salve para criar. Para editar, selecione a unidade existente e atualize os campos conforme necessidade.',
            'tags': 'admin,unidades,acessos,usuarios,login,senha,perfil,status',
            'category': 'geral',
            'priority': 101,
        },
        {
            'question': 'Quais abas existem no sistema e para que serve cada uma',
            'answer': 'Abas principais: 1) Imagem e Qualidade: valida resolucao, tamanho e DPI. 2) Divisao e Sangria: divide em paineis e aplica borda para chassi. 3) Simulacao de Quadros: personaliza moldura e passepartout. 4) Simulacao de Ambiente: posiciona quadros na parede e calibra escala real. 5) Montagem: compoe varias fotos em um unico layout. 6) Catalogo: organiza imagens/PDFs e historico. 7) Clientes: CRM, status e historico de atendimentos. 8) Admin: monitoramento, pagamentos, suporte operacional e acessos.',
            'tags': 'quais abas existem,todas as abas,menu,funcionalidades do sistema,resumo geral',
            'category': 'geral',
            'priority': 102,
        },
        {
            'question': 'Me mostra todos os fluxos do sistema passo a passo',
            'answer': 'Fluxo completo recomendado: 1) Imagem e Qualidade: carregar arquivo, validar qualidade e tamanho alvo. 2) Divisao e Sangria: escolher orientacao/grade, ajustar medidas e aplicar sangria. 3) Simulacao de Quadros: definir moldura e passepartout. 4) Simulacao de Ambiente: inserir quadros na parede, ajustar escala e composicao. 5) Montagem (quando necessario): montar composicao multi-fotos. 6) Catalogo: salvar e organizar assets/simulacoes. 7) Orcamento e Clientes: gerar proposta, salvar atendimento e acompanhar historico. 8) Admin (gestao): monitorar unidades, pagamentos, chamados e usuarios.',
            'tags': 'todos os fluxos,passo a passo completo,jornada completa,processo do sistema,do inicio ao fim',
            'category': 'geral',
            'priority': 103,
        },
    ]

    for item in defaults:
        question = _ptbr_text(item['question'])
        answer = _ptbr_text(item['answer'])
        priority = int(item['priority'])

        existing = conn.execute(
            'SELECT id FROM support_faq WHERE priority = ? LIMIT 1',
            (priority,)
        ).fetchone()

        if existing:
            conn.execute(
                '''
                UPDATE support_faq
                SET question = ?, answer = ?, tags = ?, category = ?, is_active = ?, updated_at = ?
                WHERE id = ?
                ''',
                (
                    question,
                    answer,
                    item['tags'],
                    item['category'],
                    True,
                    now,
                    existing['id'],
                )
            )
            continue

        conn.execute(
            '''
            INSERT INTO support_faq (question, answer, tags, category, priority, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                question,
                answer,
                item['tags'],
                item['category'],
                priority,
                True,
                now,
                now,
            )
        )
