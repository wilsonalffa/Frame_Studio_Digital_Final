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

            CREATE INDEX IF NOT EXISTS idx_stores_name ON stores(name);
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
            CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome);
            CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone);
            CREATE INDEX IF NOT EXISTS idx_consultas_cliente ON consultas(cliente_id);
            CREATE INDEX IF NOT EXISTS idx_consultas_data ON consultas(created_at);
            CREATE INDEX IF NOT EXISTS idx_store_state_store_scope ON store_state(store_id, scope);

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

            CREATE TABLE IF NOT EXISTS store_state (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                store_id BIGINT NOT NULL REFERENCES stores(id),
                scope TEXT NOT NULL,
                data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(store_id, scope)
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
            CREATE INDEX IF NOT EXISTS idx_store_state_store_scope ON store_state(store_id, scope);
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
