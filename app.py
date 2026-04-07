# ═══════════════════════════════════════════════════════════
#  Frame Studio Digital — app.py
#  Login protegido server-side com Flask session
#  + Proxy para API do Gemini (Google AI Studio - gratuito)
# ═══════════════════════════════════════════════════════════

"""
MAPA FUNCIONAL DO BACKEND (RESUMO PARA IA)

1) Autenticacao e sessao
- Login/logout com Flask session.
- Controle de acesso por perfil usando login_required e admin_required.

2) Camada de banco hibrida (SQLite + Postgres)
- ConnectionCompat uniformiza queries com placeholders entre SQLite (?) e Postgres (%s).
- get_db escolhe backend por variaveis de ambiente e reutiliza conexao no escopo da requisicao.

3) Multiunidade (stores/users)
- Cada unidade possui loja (stores) e usuario de acesso (users).
- Bootstrap cria/atualiza usuario admin principal com base em variaveis FF_*.

4) CRM e orcamentos
- clientes: cadastro, edicao, remocao, historico.
- consultas: dados comerciais (status, total, config, pagamentos e imagem preview).

5) Estado persistente do frontend por loja
- store_state guarda JSON por escopo (catalog, rooms) para catalogo e simulador de ambientes.

6) Inteligencia operacional (admin)
- /api/stores: gestao de unidades e acessos.
- /api/admin/dashboard: metricas consolidadas por unidade e totais globais.
- users.last_login_at/login_count para monitoramento de uso.

7) IA de analise de arte
- Endpoint dedicado usa Gemini via chave GEMINI_API_KEY/GOOGLE_API_KEY.

Observacao
- Este arquivo concentra regras de negocio e migracoes leves de esquema (ensure_column no init_db).
"""

import os
import json
import re
import sqlite3
from datetime import datetime, timedelta
import urllib.request
import urllib.error
import psycopg
from psycopg.rows import dict_row
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, g, has_request_context
from flask_socketio import SocketIO, emit, join_room, leave_room
from functools import wraps
import base64
from PIL import Image
from io import BytesIO
import uuid
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeSerializer, BadSignature

load_dotenv()  # Carrega variaveis do arquivo .env local

# Inicializacao do Flask e SocketIO
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

active_sessions = {}  # {store_id: {'desktop': set(sids), 'mobile': set(sids), 'unknown': set(sids)}}
socket_clients = {}  # {sid: {'store_id': int, 'user_id': int, 'device_type': str}}
camera_heartbeats = {}  # {store_id: datetime}
camera_latest_frames = {}  # {store_id: {'frame_id', 'image_url', 'uploaded_by', 'timestamp', 'width', 'height'}}


def normalize_socket_device(value):
    device = (value or '').strip().lower()
    if device in ('desktop', 'mobile'):
        return device
    return 'unknown'


def build_socket_auth_token(user_id, store_id):
    serializer = URLSafeSerializer(app.secret_key, salt=SOCKET_AUTH_SALT)
    return serializer.dumps({'user_id': int(user_id), 'store_id': int(store_id)})


def parse_socket_auth_token(token):
    if not token:
        return None
    serializer = URLSafeSerializer(app.secret_key, salt=SOCKET_AUTH_SALT)
    try:
        payload = serializer.loads(token)
    except BadSignature:
        return None
    try:
        return {
            'user_id': int(payload.get('user_id')),
            'store_id': int(payload.get('store_id')),
        }
    except Exception:
        return None


def emit_camera_presence(store_id):
    store_sessions = active_sessions.get(store_id) or {}
    desktop_count = len(store_sessions.get('desktop', set()))
    mobile_count = len(store_sessions.get('mobile', set()))
    socketio.emit(
        'camera_presence',
        {
            'store_id': store_id,
            'desktop_count': desktop_count,
            'mobile_count': mobile_count,
            'mobile_connected': mobile_count > 0,
        },
        room=str(store_id),
    )


def touch_camera_heartbeat(store_id):
    if store_id:
        camera_heartbeats[int(store_id)] = datetime.utcnow()


def get_camera_presence_snapshot(store_id):
    if not store_id:
        return {'mobile_count': 0, 'mobile_connected': False}
    last_seen = camera_heartbeats.get(int(store_id))
    active = bool(last_seen and (datetime.utcnow() - last_seen) <= timedelta(seconds=20))
    return {
        'mobile_count': 1 if active else 0,
        'mobile_connected': active,
        'last_seen_at': last_seen.isoformat() if active else None,
    }

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DB_PATH = os.path.join(DATA_DIR, 'fastframe.db')
DATABASE_URL = (os.environ.get('DATABASE_URL') or '').strip()
DIRECT_URL = (os.environ.get('DIRECT_URL') or '').strip()
DB_MODE = (os.environ.get('FF_DB_MODE') or '').strip().lower()

APP_ENV = (os.environ.get('FASTFRAME_ENV') or os.environ.get('FLASK_ENV') or 'development').strip().lower()
IS_PROD = APP_ENV in ('prod', 'production')


def env_guard(name, default=''):
    value = os.environ.get(name)
    if value is not None and str(value).strip() != '':
        return value
    if IS_PROD:
        raise RuntimeError(f'Variavel obrigatoria em producao nao definida: {name}')
    return default


app.secret_key = env_guard('SECRET_KEY', 'fastframe-dev-secret-2026-mude-em-producao')

APP_USER = env_guard('FF_USER', 'fastframe')
APP_PASS = env_guard('FF_PASS', 'sorocaba2026')
APP_USER_NAME = (os.environ.get('FF_USER_NAME') or APP_USER).strip() or APP_USER
APP_STORE_NAME = (os.environ.get('FF_STORE_NAME') or APP_USER_NAME).strip() or APP_USER_NAME
SYNC_BOOTSTRAP_USER = str(os.environ.get('FF_SYNC_BOOTSTRAP_USER', '0')).strip().lower() in ('1', 'true', 'yes', 'on')
STORE_STATE_DEFAULTS = {
    'catalog': {'version': 2, 'folders': [], 'items': [], 'sims': []},
    'rooms': {'overrides': {}, 'customs': []},
}

# Chave gratuita: https://aistudio.google.com
# Aceita os dois nomes por compatibilidade entre ambientes.
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY', '')
# Modelo padrão ativo para novos projetos na API v1beta.
GEMINI_MODEL = (os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash') or 'gemini-2.5-flash').replace('models/', '')
SOCKET_AUTH_SALT = 'fastframe-socket-auth-v1'


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


@app.teardown_appcontext
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


def get_db():
    if has_request_context():
        cached = getattr(g, '_db_conn', None)
        if cached is not None:
            return cached

    prefer_postgres = DB_MODE == 'postgres' or (DB_MODE != 'sqlite' and (DIRECT_URL or DATABASE_URL))

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


def now_iso():
    return datetime.now().isoformat(timespec='seconds')


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
            pass
        return
    if column_name not in table_columns(conn, table_name):
        conn.execute(f'ALTER TABLE {table_name} ADD COLUMN {definition_sql}')


def normalize_role(value):
    return 'admin' if str(value or '').strip().lower() == 'admin' else 'user'


def parse_bool(value, default=True):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in ('1', 'true', 'yes', 'sim', 'on')


def normalize_username(value):
    return re.sub(r'[^a-z0-9._-]+', '', str(value or '').strip().lower())


def normalize_store_name(value, fallback='Loja Principal'):
    name = str(value or '').strip()
    return name or fallback


def normalize_store_state_scope(scope):
    key = str(scope or '').strip().lower()
    return key if key in STORE_STATE_DEFAULTS else None


def default_store_state(scope):
    normalized = normalize_store_state_scope(scope)
    if not normalized:
        return {}
    return json.loads(json.dumps(STORE_STATE_DEFAULTS[normalized], ensure_ascii=False))


def decode_json_field(raw_value, fallback):
    if raw_value is None:
        return fallback
    if isinstance(raw_value, str):
        try:
            parsed = json.loads(raw_value)
        except Exception:
            return fallback
    else:
        parsed = raw_value
    return parsed if isinstance(parsed, type(fallback)) else fallback


def decode_store_state(scope, raw_json):
    fallback = default_store_state(scope)
    return decode_json_field(raw_json, fallback)


def load_store_state(conn, store_id, scope):
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
        'data': decode_store_state(normalized, row['data_json']),
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
    }


def save_store_state(conn, store_id, scope, data):
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


def row_to_store(row):
    if not row:
        return None
    return {
        'id': row['id'],
        'name': row['name'],
        'is_active': bool(row['is_active']),
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
    }


def row_to_user(row):
    if not row:
        return None
    return {
        'id': row['id'],
        'username': row['username'],
        'display_name': row['display_name'] or row['username'],
        'role': normalize_role(row['role']),
        'is_active': bool(row['is_active']),
        'store_id': row['store_id'],
        'store_name': row['store_name'] or '',
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
    }


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
    return row_to_user(row)


def get_store_by_id(store_id):
    if not store_id:
        return None
    with get_db() as conn:
        row = conn.execute('SELECT * FROM stores WHERE id = ?', (store_id,)).fetchone()
    return row_to_store(row)


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


def set_session_user(user):
    session.clear()
    session['logged_in'] = True
    session['user_id'] = user['id']
    session['username'] = user['username']
    session['display_name'] = user['display_name'] or user['username']
    session['role'] = normalize_role(user['role'])
    session['store_id'] = user.get('store_id')
    session['store_name'] = user.get('store_name') or ''


def clear_session_user():
    session.clear()


def get_authenticated_user():
    if hasattr(g, '_auth_user_loaded'):
        return g._auth_user

    g._auth_user_loaded = True

    if not session.get('logged_in'):
        g._auth_user = None
        return None

    row = None
    user_id = session.get('user_id')
    username = session.get('username')

    if user_id:
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
    elif username:
        with get_db() as conn:
            row = get_user_row_by_username(conn, username)

    if not row or not row['is_active'] or not row['store_id']:
        clear_session_user()
        g._auth_user = None
        return None

    if not row.get('store_active'):
        clear_session_user()
        g._auth_user = None
        return None

    user = row_to_user(row)
    user['store_name'] = row['store_name'] or ''

    session['logged_in'] = True
    session['user_id'] = user['id']
    session['username'] = user['username']
    session['display_name'] = user['display_name'] or user['username']
    session['role'] = normalize_role(user['role'])
    session['store_id'] = user['store_id']
    session['store_name'] = user['store_name']
    g._auth_user = user
    return user


def current_user_id():
    user = get_authenticated_user()
    return user['id'] if user else None


def current_store_id():
    user = get_authenticated_user()
    return user['store_id'] if user else None


def current_user_role():
    user = get_authenticated_user()
    return user['role'] if user else ''


def json_or_redirect_unauthorized():
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Sessao expirada. Faca login novamente.'}), 401
    return redirect(url_for('login', next=request.url))


def inserted_id(conn, cursor):
    if cursor and getattr(cursor, 'lastrowid', None):
        return cursor.lastrowid
    row = conn.execute('SELECT LASTVAL() AS id').fetchone()
    return row['id'] if row else None


def count_active_admins(conn):
    row = conn.execute(
        "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = ?",
        (True,)
    ).fetchone()
    return int(row['total'] or 0)


def ensure_bootstrap_user(conn):
    username = normalize_username(APP_USER)
    password = str(APP_PASS or '').strip()
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

        bootstrap_user_id = ensure_bootstrap_user(conn)
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
        bootstrap_store_row = conn.execute('SELECT store_id FROM users WHERE id = ?', (bootstrap_user_id,)).fetchone()
        bootstrap_store_id = bootstrap_store_row['store_id'] if bootstrap_store_row else None
        if bootstrap_store_id:
            conn.execute('UPDATE clientes SET store_id = ? WHERE store_id IS NULL', (bootstrap_store_id,))
            conn.execute('UPDATE consultas SET store_id = ? WHERE store_id IS NULL', (bootstrap_store_id,))
        conn.execute('UPDATE consultas SET owner_user_id = ? WHERE owner_user_id IS NULL', (bootstrap_user_id,))


def row_to_cliente(row):
    return {
        'id': row['id'],
        'store_id': row['store_id'],
        'nome': row['nome'],
        'telefone': row['telefone'] or '',
        'status': row['status'] or 'novo',
        'observacoes': row['observacoes'] or '',
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
    }


def row_to_consulta(row):
    return {
        'id': row['id'],
        'store_id': row['store_id'],
        'cliente_id': row['cliente_id'],
        'contexto': row['contexto'] or '',
        'status': row['status'] or 'em andamento',
        'data_orcamento': row['data_orcamento'] or '',
        'validade': row['validade'] or '',
        'preco': row['preco'] or 0,
        'desconto': row['desconto'] or 0,
        'total': row['total'] or 0,
        'detalhes': row['detalhes'] or '',
        'observacoes': row['observacoes'] or '',
        'pagamentos': decode_json_field(row['pagamentos_json'], []),
        'config': decode_json_field(row['config_json'], {}),
        'imagem_preview': row['imagem_preview'] or '',
        'created_at': row['created_at'],
    }

# ── Decorator de protecao de rota ─────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not get_authenticated_user():
            return json_or_redirect_unauthorized()
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_authenticated_user()
        if not user:
            return json_or_redirect_unauthorized()
        if user['role'] != 'admin':
            return jsonify({'error': 'Acesso restrito ao administrador.'}), 403
        return f(*args, **kwargs)
    return decorated


# ── SocketIO: eventos de conexao por loja ─────────────────

@socketio.on('connect')
def handle_connect():
    user = get_authenticated_user()
    user_id = user['id'] if user else session.get('user_id')
    store_id = user['store_id'] if user else session.get('store_id')
    device_type = normalize_socket_device(request.args.get('device'))

    if not user_id or not store_id:
        socket_auth = parse_socket_auth_token(request.args.get('socket_auth'))
        if socket_auth:
            user_id = socket_auth['user_id']
            store_id = socket_auth['store_id']

    if not user_id or not store_id:
        print(f"⚠️ Socket rejeitado: sessao invalida (sid={request.sid}, device={device_type})")
        return False  # Rejeita conexao se usuario nao autenticado

    store_sessions = active_sessions.setdefault(
        store_id,
        {'desktop': set(), 'mobile': set(), 'unknown': set()},
    )

    store_sessions.setdefault(device_type, set()).add(request.sid)
    socket_clients[request.sid] = {
        'store_id': store_id,
        'user_id': user_id,
        'device_type': device_type,
    }

    join_room(str(store_id))
    emit('connection_response', {
        'status': 'connected',
        'user_id': user_id,
        'store_id': store_id,
        'device_type': device_type,
        'socketioId': request.sid,
    })
    emit_camera_presence(store_id)
    print(f"✅ Usuario {user_id} conectado ({device_type}, store {store_id})")


@socketio.on('disconnect')
def handle_disconnect():
    client = socket_clients.pop(request.sid, None)
    user_id = (client or {}).get('user_id', session.get('user_id'))
    store_id = (client or {}).get('store_id', session.get('store_id'))
    device_type = (client or {}).get('device_type', normalize_socket_device(request.args.get('device')))

    if store_id and store_id in active_sessions:
        store_sessions = active_sessions[store_id]
        if device_type in store_sessions:
            store_sessions[device_type].discard(request.sid)
        if not any(store_sessions.values()):
            active_sessions.pop(store_id, None)
        emit_camera_presence(store_id)
        print(f"❌ Usuario {user_id} desconectado ({device_type}, store {store_id})")


# ── Upload de imagem via mobile (envia para desktop em tempo real) ──
@app.route('/api/upload-image', methods=['POST'])
@login_required
def upload_frame():
    """
    Recebe imagem do mobile, comprime e notifica todos conectados nesta loja via SocketIO.

    Body JSON esperado:
      - image:    string base64 (com ou sem prefixo data URI)
      - mimeType: 'image/jpeg' | 'image/png'  (opcional, default jpeg)
    """
    try:
        store_id = current_store_id()
        user_id = current_user_id()
        data = request.get_json()

        if not data or 'image' not in data:
            return jsonify({'error': 'Imagem nao fornecida.'}), 400

        raw_b64 = data['image']
        mime_type = data.get('mimeType', 'image/jpeg')

        # Decodifica removendo prefixo data URI se presente
        image_bytes = base64.b64decode(raw_b64.split(',')[-1])
        img = Image.open(BytesIO(image_bytes))

        # Redimensiona se necessario (max 2000px em qualquer dimensao)
        if img.width > 2000 or img.height > 2000:
            img.thumbnail((2000, 2000), Image.Resampling.LANCZOS)

        # Comprime para JPEG
        output = BytesIO()
        img.save(output, format='JPEG', quality=85, optimize=True)
        compressed_b64 = base64.b64encode(output.getvalue()).decode('utf-8')

        agora = now_iso()
        frame_id = str(uuid.uuid4())[:12]

        metadata_payload = {
            'original_size': len(image_bytes),
            'compressed_size': len(compressed_b64),
            'width': img.width,
            'height': img.height,
        }

        frame_payload = {
            'frame_id': frame_id,
            'image_url': f"data:{mime_type};base64,{compressed_b64}",
            'uploaded_by': user_id,
            'timestamp': agora,
            'width': img.width,
            'height': img.height,
        }

        persisted = True
        try:
            # Persiste no banco
            with get_db() as conn:
                if conn.backend == 'postgres':
                    conn.execute(
                        '''
                        INSERT INTO frames_cache (id, store_id, user_id, image_b64, metadata, created_at)
                        VALUES (?, ?, ?, ?, ?::jsonb, ?::timestamptz)
                        ''',
                        (
                            frame_id,
                            store_id,
                            user_id,
                            frame_payload['image_url'],
                            json.dumps(metadata_payload),
                            agora,
                        ),
                    )
                else:
                    conn.execute(
                        '''
                        INSERT INTO frames_cache (id, store_id, user_id, image_b64, metadata, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ''',
                        (
                            frame_id,
                            store_id,
                            user_id,
                            frame_payload['image_url'],
                            json.dumps(metadata_payload),
                            agora,
                        ),
                    )
        except Exception as db_exc:
            persisted = False
            print(f"⚠️ Falha ao persistir frame no banco (store={store_id}): {db_exc}")

        # Mantem ultimo frame em memoria para fallback do polling.
        camera_latest_frames[int(store_id)] = frame_payload

        # Notifica clientes em tempo real; protegido para nao quebrar a resposta HTTP
        # caso o worker nao suporte WebSocket (ex: gthread sem eventlet).
        try:
            socketio.emit('new_frame', frame_payload, room=str(store_id))
        except Exception as emit_exc:
            print(f"⚠️ Falha ao emitir socket event (store={store_id}): {emit_exc}")

        response = {
            'ok': True,
            'frame_id': frame_id,
            'width': img.width,
            'height': img.height,
            'message': 'Imagem enviada com sucesso.',
            'persisted': persisted,
        }
        if not persisted:
            response['warning'] = 'Imagem sincronizada em tempo real, mas o historico local falhou no servidor.'
        return jsonify(response)

    except Exception as e:
        return jsonify({'error': 'Falha ao processar a imagem.', 'details': str(e)}), 500


@app.route('/api/cleanup-frames', methods=['POST'])
@admin_required
def cleanup_frames():
    """Remove frames com mais de 7 dias."""
    cutoff = (datetime.now() - timedelta(days=7)).isoformat(timespec='seconds')
    with get_db() as conn:
        if conn.backend == 'postgres':
            cur = conn.execute('DELETE FROM frames_cache WHERE created_at < ?::timestamptz', (cutoff,))
        else:
            cur = conn.execute('DELETE FROM frames_cache WHERE created_at < ?', (cutoff,))
    removed = cur._cursor.rowcount if hasattr(cur, '_cursor') else None
    return jsonify({'ok': True, 'message': 'Limpeza concluida', 'removed': removed})


@app.context_processor
def inject_current_user():
    return {'current_user': get_authenticated_user()}

# ── Mapa de rotas (alto nivel) ────────────────────────────
# /login, /logout, /
# /api/stores*              -> administracao de unidades e logins
# /api/admin/dashboard      -> monitoramento operacional
# /api/clientes*            -> CRM por unidade
# /api/consultas*           -> orcamentos e historico comercial
# /api/store-state/<scope>  -> estado JSON do catalogo/simulador
# /analisar-arte            -> proxy IA Gemini

# ── Autenticacao ──────────────────────────────────────────
@app.route('/login', methods=['GET', 'POST'])
def login():
    if get_authenticated_user():
        return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        username = normalize_username(request.form.get('username', ''))
        password = request.form.get('password', '')
        with get_db() as conn:
            row = get_user_row_by_username(conn, username)
        if row and row['is_active'] and check_password_hash(row['password_hash'], password):
            set_session_user(row_to_user(row))
            try:
                with get_db() as conn:
                    conn.execute(
                        'UPDATE users SET last_login_at = ?, login_count = COALESCE(login_count, 0) + 1 WHERE id = ?',
                        (now_iso(), row['id'])
                    )
            except Exception:
                pass
            next_url = request.args.get('next') or url_for('index')
            return redirect(next_url)
        else:
            error = 'Usuário ou senha incorretos.'
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template('index.html')


@app.route('/api/stores', methods=['GET'])
@login_required
@admin_required
def listar_lojas():
    with get_db() as conn:
        rows = conn.execute(
            '''
            SELECT s.*, 
                   u.id AS access_user_id,
                   u.username AS access_username,
                   u.display_name AS access_display_name,
                   u.role AS access_role,
                   u.is_active AS access_is_active,
                   (SELECT COUNT(*) FROM clientes c WHERE c.store_id = s.id) AS total_clientes,
                   (SELECT COUNT(*) FROM consultas cs WHERE cs.store_id = s.id) AS total_consultas
            FROM stores s
            LEFT JOIN users u ON u.id = (
                SELECT ux.id FROM users ux WHERE ux.store_id = s.id ORDER BY ux.id LIMIT 1
            )
            ORDER BY lower(s.name)
            '''
        ).fetchall()

    lojas = []
    for row in rows:
        item = row_to_store(row)
        item['access_user_id'] = row['access_user_id']
        item['access_username'] = row['access_username'] or ''
        item['access_display_name'] = row['access_display_name'] or row['access_username'] or ''
        item['access_role'] = normalize_role(row['access_role'])
        item['access_is_active'] = bool(row['access_is_active']) if row['access_user_id'] else False
        item['total_clientes'] = int(row['total_clientes'] or 0)
        item['total_consultas'] = int(row['total_consultas'] or 0)
        lojas.append(item)
    return jsonify({'stores': lojas})


@app.route('/api/stores', methods=['POST'])
@login_required
@admin_required
def criar_loja():
    body = request.get_json(silent=True) or {}
    store_name = normalize_store_name(body.get('store_name'), 'Nova Unidade')
    username = normalize_username(body.get('username'))
    display_name = (body.get('display_name') or store_name).strip() or store_name
    password = str(body.get('password') or '')
    role = normalize_role(body.get('role'))
    is_active = parse_bool(body.get('is_active'), True)

    if not store_name:
        return jsonify({'error': 'Informe o nome da unidade.'}), 400
    if len(username) < 3:
        return jsonify({'error': 'O usuario deve ter pelo menos 3 caracteres.'}), 400
    if len(password) < 6:
        return jsonify({'error': 'A senha deve ter pelo menos 6 caracteres.'}), 400

    now = now_iso()
    with get_db() as conn:
        if get_user_row_by_username(conn, username):
            return jsonify({'error': 'Ja existe um usuario com esse login.'}), 409

        cur_store = conn.execute(
            '''
            INSERT INTO stores (name, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ''',
            (store_name, is_active, now, now)
        )
        store_id = inserted_id(conn, cur_store)

        # Garante que toda nova unidade comece com catalogo vazio persistido.
        save_store_state(conn, store_id, 'catalog', default_store_state('catalog'))

        cur = conn.execute(
            '''
            INSERT INTO users (store_id, username, display_name, password_hash, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (store_id, username, display_name, generate_password_hash(password), role, is_active, now, now)
        )
        row = conn.execute(
            '''
            SELECT s.*, u.id AS access_user_id, u.username AS access_username, u.display_name AS access_display_name,
                   u.role AS access_role, u.is_active AS access_is_active
            FROM stores s
            LEFT JOIN users u ON u.id = ?
            WHERE s.id = ?
            ''',
            (inserted_id(conn, cur), store_id)
        ).fetchone()

    out = row_to_store(row)
    out['access_user_id'] = row['access_user_id']
    out['access_username'] = row['access_username'] or ''
    out['access_display_name'] = row['access_display_name'] or row['access_username'] or ''
    out['access_role'] = normalize_role(row['access_role'])
    out['access_is_active'] = bool(row['access_is_active'])
    return jsonify({'store': out}), 201


@app.route('/api/stores/<int:store_id>', methods=['PUT'])
@login_required
@admin_required
def atualizar_loja(store_id):
    body = request.get_json(silent=True) or {}
    store_name = normalize_store_name(body.get('store_name'), 'Unidade')
    display_name = (body.get('display_name') or store_name).strip() or store_name
    role = normalize_role(body.get('role'))
    is_active = parse_bool(body.get('is_active'), True)
    password = str(body.get('password') or '')
    session_user_id = session.get('user_id')

    if not store_name:
        return jsonify({'error': 'Informe o nome da unidade.'}), 400

    with get_db() as conn:
        row = conn.execute(
            '''
            SELECT s.*, u.id AS access_user_id, u.username AS access_username, u.display_name AS access_display_name,
                   u.role AS access_role, u.is_active AS access_is_active
            FROM stores s
            LEFT JOIN users u ON u.id = (
                SELECT ux.id FROM users ux WHERE ux.store_id = s.id ORDER BY ux.id LIMIT 1
            )
            WHERE s.id = ?
            ''',
            (store_id,)
        ).fetchone()
        if not row:
            return jsonify({'error': 'Unidade nao encontrada.'}), 404

        access_user_id = row['access_user_id']
        if not access_user_id:
            return jsonify({'error': 'Unidade sem login vinculado.'}), 400

        admin_count = count_active_admins(conn)
        if access_user_id == session_user_id and not is_active:
            return jsonify({'error': 'Voce nao pode desativar o proprio acesso.'}), 400
        if row['access_role'] == 'admin' and role != 'admin' and bool(row['access_is_active']) and admin_count <= 1:
            return jsonify({'error': 'O sistema precisa manter pelo menos um administrador ativo.'}), 400
        if row['access_role'] == 'admin' and not is_active and bool(row['access_is_active']) and admin_count <= 1:
            return jsonify({'error': 'O sistema precisa manter pelo menos um administrador ativo.'}), 400

        conn.execute(
            'UPDATE stores SET name = ?, is_active = ?, updated_at = ? WHERE id = ?',
            (store_name, is_active, now_iso(), store_id)
        )

        updates = ['display_name = ?', 'role = ?', 'is_active = ?', 'updated_at = ?']
        values = [display_name, role, is_active, now_iso()]
        if password:
            if len(password) < 6:
                return jsonify({'error': 'A senha deve ter pelo menos 6 caracteres.'}), 400
            updates.append('password_hash = ?')
            values.append(generate_password_hash(password))

        values.append(access_user_id)
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", values)
        updated = conn.execute(
            '''
            SELECT s.*, u.id AS access_user_id, u.username AS access_username, u.display_name AS access_display_name,
                   u.role AS access_role, u.is_active AS access_is_active
            FROM stores s
            LEFT JOIN users u ON u.id = (
                SELECT ux.id FROM users ux WHERE ux.store_id = s.id ORDER BY ux.id LIMIT 1
            )
            WHERE s.id = ?
            ''',
            (store_id,)
        ).fetchone()

    if access_user_id == session_user_id:
        current_row = get_user_by_id(access_user_id)
        if current_row:
            set_session_user(current_row)

    out = row_to_store(updated)
    out['access_user_id'] = updated['access_user_id']
    out['access_username'] = updated['access_username'] or ''
    out['access_display_name'] = updated['access_display_name'] or updated['access_username'] or ''
    out['access_role'] = normalize_role(updated['access_role'])
    out['access_is_active'] = bool(updated['access_is_active'])
    return jsonify({'store': out})


@app.route('/api/stores/<int:store_id>', methods=['DELETE'])
@login_required
@admin_required
def desativar_loja(store_id):
    session_user_id = session.get('user_id')
    with get_db() as conn:
        row = conn.execute(
            '''
            SELECT s.*, u.id AS access_user_id, u.role AS access_role, u.is_active AS access_is_active
            FROM stores s
            LEFT JOIN users u ON u.id = (
                SELECT ux.id FROM users ux WHERE ux.store_id = s.id ORDER BY ux.id LIMIT 1
            )
            WHERE s.id = ?
            ''',
            (store_id,)
        ).fetchone()
        if not row:
            return jsonify({'error': 'Unidade nao encontrada.'}), 404
        if row['access_user_id'] == session_user_id:
            return jsonify({'error': 'Voce nao pode desativar o proprio acesso.'}), 400
        if row['access_role'] == 'admin' and bool(row['access_is_active']) and count_active_admins(conn) <= 1:
            return jsonify({'error': 'O sistema precisa manter pelo menos um administrador ativo.'}), 400

        conn.execute(
            'UPDATE stores SET is_active = ?, updated_at = ? WHERE id = ?',
            (False, now_iso(), store_id)
        )
        conn.execute(
            'UPDATE users SET is_active = ?, updated_at = ? WHERE store_id = ?',
            (False, now_iso(), store_id)
        )

    return jsonify({'ok': True, 'store_id': store_id})


@app.route('/api/stores/<int:store_id>/purge', methods=['DELETE'])
@login_required
@admin_required
def excluir_loja_definitivo(store_id):
    session_user_id = session.get('user_id')
    with get_db() as conn:
        row = conn.execute(
            '''
            SELECT s.*, u.id AS access_user_id, u.role AS access_role, u.is_active AS access_is_active
            FROM stores s
            LEFT JOIN users u ON u.id = (
                SELECT ux.id FROM users ux WHERE ux.store_id = s.id ORDER BY ux.id LIMIT 1
            )
            WHERE s.id = ?
            ''',
            (store_id,)
        ).fetchone()
        if not row:
            return jsonify({'error': 'Unidade nao encontrada.'}), 404
        if row['access_user_id'] == session_user_id:
            return jsonify({'error': 'Voce nao pode excluir a propria unidade logada.'}), 400
        if row['access_role'] == 'admin' and bool(row['access_is_active']) and count_active_admins(conn) <= 1:
            return jsonify({'error': 'O sistema precisa manter pelo menos um administrador ativo.'}), 400

        conn.execute('DELETE FROM consultas WHERE store_id = ?', (store_id,))
        conn.execute('DELETE FROM clientes WHERE store_id = ?', (store_id,))
        conn.execute('DELETE FROM store_state WHERE store_id = ?', (store_id,))
        try:
            conn.execute('DELETE FROM frames_cache WHERE store_id = ?', (store_id,))
        except Exception:
            pass
        conn.execute('DELETE FROM users WHERE store_id = ?', (store_id,))
        conn.execute('DELETE FROM stores WHERE id = ?', (store_id,))

    # Limpeza de caches em memoria para a unidade removida.
    try:
        active_sessions.pop(int(store_id), None)
        camera_heartbeats.pop(int(store_id), None)
        camera_latest_frames.pop(int(store_id), None)
    except Exception:
        pass

    return jsonify({'ok': True, 'store_id': store_id})


@app.route('/api/admin/dashboard', methods=['GET'])
@login_required
@admin_required
def admin_dashboard():
    with get_db() as conn:
        totals_row = conn.execute(
            '''
            SELECT
                (SELECT COUNT(*) FROM stores WHERE is_active = ?) AS total_lojas,
                (SELECT COUNT(*) FROM clientes) AS total_clientes,
                (SELECT COUNT(*) FROM consultas) AS total_consultas,
                (SELECT COALESCE(SUM(total), 0) FROM consultas WHERE status = ?) AS total_vendido
            ''',
            (True, 'fechado')
        ).fetchone()

        store_rows = conn.execute(
            '''
            SELECT
                s.id, s.name AS store_name, s.is_active,
                u.display_name, u.username,
                COALESCE(u.last_login_at, '') AS last_login_at,
                COALESCE(u.login_count, 0) AS login_count,
                (SELECT COUNT(*) FROM clientes c WHERE c.store_id = s.id) AS total_clientes,
                (SELECT COUNT(*) FROM consultas cs WHERE cs.store_id = s.id) AS total_consultas,
                (SELECT COALESCE(SUM(cs.total), 0) FROM consultas cs WHERE cs.store_id = s.id AND cs.status = ?) AS total_vendido,
                (SELECT COALESCE(AVG(cs.total), 0) FROM consultas cs WHERE cs.store_id = s.id AND cs.status = ?) AS ticket_medio,
                (SELECT COUNT(*) FROM consultas cs WHERE cs.store_id = s.id AND cs.status = ?) AS em_andamento,
                (SELECT COUNT(*) FROM consultas cs WHERE cs.store_id = s.id AND cs.status = ?) AS fechados
            FROM stores s
            LEFT JOIN users u ON u.id = (
                SELECT ux.id FROM users ux WHERE ux.store_id = s.id ORDER BY ux.id LIMIT 1
            )
            ORDER BY total_vendido DESC
            ''',
            ('fechado', 'fechado', 'em andamento', 'fechado')
        ).fetchall()

        state_rows = conn.execute(
            "SELECT store_id, data_json FROM store_state WHERE scope = 'catalog'"
        ).fetchall()

    catalog_by_store = {}
    for sr in state_rows:
        try:
            data = decode_json_field(sr['data_json'], {})
            catalog_by_store[sr['store_id']] = {
                'items': len(data.get('items') or []),
                'sims': len(data.get('sims') or []),
            }
        except Exception:
            catalog_by_store[sr['store_id']] = {'items': 0, 'sims': 0}

    stores = []
    for row in store_rows:
        cat = catalog_by_store.get(row['id'], {'items': 0, 'sims': 0})
        stores.append({
            'id': row['id'],
            'store_name': row['store_name'],
            'is_active': bool(row['is_active']),
            'display_name': row['display_name'] or row['username'] or '',
            'username': row['username'] or '',
            'last_login_at': row['last_login_at'],
            'login_count': int(row['login_count'] or 0),
            'total_clientes': int(row['total_clientes'] or 0),
            'total_consultas': int(row['total_consultas'] or 0),
            'total_vendido': round(float(row['total_vendido'] or 0), 2),
            'ticket_medio': round(float(row['ticket_medio'] or 0), 2),
            'em_andamento': int(row['em_andamento'] or 0),
            'fechados': int(row['fechados'] or 0),
            'catalog_items': cat['items'],
            'catalog_sims': cat['sims'],
        })

    return jsonify({
        'totals': {
            'lojas': int(totals_row['total_lojas'] or 0),
            'clientes': int(totals_row['total_clientes'] or 0),
            'consultas': int(totals_row['total_consultas'] or 0),
            'vendido': round(float(totals_row['total_vendido'] or 0), 2),
        },
        'stores': stores,
    })


@app.route('/api/clientes', methods=['GET'])
@login_required
def listar_clientes():
    busca = request.args.get('q', '').strip()
    store_id = current_store_id()
    with get_db() as conn:
        if busca:
            like = f'%{busca}%'
            rows = conn.execute(
                '''
                SELECT c.*,
                       (SELECT COUNT(*) FROM consultas cs WHERE cs.cliente_id = c.id) AS total_consultas,
                       (SELECT MAX(cs.created_at) FROM consultas cs WHERE cs.cliente_id = c.id) AS ultima_consulta
                FROM clientes c
                                WHERE c.store_id = ?
                                    AND (c.nome LIKE ? OR COALESCE(c.telefone, '') LIKE ?)
                ORDER BY c.updated_at DESC
                ''',
                                (store_id, like, like)
            ).fetchall()
        else:
            rows = conn.execute(
                '''
                SELECT c.*,
                       (SELECT COUNT(*) FROM consultas cs WHERE cs.cliente_id = c.id) AS total_consultas,
                       (SELECT MAX(cs.created_at) FROM consultas cs WHERE cs.cliente_id = c.id) AS ultima_consulta
                FROM clientes c
                  WHERE c.store_id = ?
                ORDER BY c.updated_at DESC
                '''
                  , (store_id,)
            ).fetchall()

    clientes = []
    for row in rows:
        cli = row_to_cliente(row)
        cli['total_consultas'] = row['total_consultas'] or 0
        cli['ultima_consulta'] = row['ultima_consulta'] or ''
        clientes.append(cli)
    return jsonify({'clientes': clientes})


@app.route('/api/store-state/<scope>', methods=['GET'])
@login_required
def obter_store_state(scope):
    normalized = normalize_store_state_scope(scope)
    if not normalized:
        return jsonify({'error': 'Escopo de armazenamento invalido.'}), 404

    store_id = current_store_id()
    with get_db() as conn:
        state = load_store_state(conn, store_id, normalized)

    if not state:
        return jsonify({
            'scope': normalized,
            'has_data': False,
            'data': default_store_state(normalized),
            'updated_at': '',
        })

    return jsonify({
        'scope': normalized,
        'has_data': True,
        'data': state['data'],
        'updated_at': state['updated_at'],
    })


@app.route('/api/store-state/<scope>', methods=['PUT'])
@login_required
def salvar_store_state(scope):
    normalized = normalize_store_state_scope(scope)
    if not normalized:
        return jsonify({'error': 'Escopo de armazenamento invalido.'}), 404

    body = request.get_json(silent=True) or {}
    if 'data' not in body:
        return jsonify({'error': 'Envie o campo data com o conteudo a salvar.'}), 400

    try:
        with get_db() as conn:
            state = save_store_state(conn, current_store_id(), normalized, body.get('data'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    return jsonify({
        'scope': normalized,
        'data': state['data'],
        'updated_at': state['updated_at'],
    })


@app.route('/api/clientes', methods=['POST'])
@login_required
def criar_cliente():
    body = request.get_json(silent=True) or {}
    store_id = current_store_id()
    nome = (body.get('nome') or '').strip()
    telefone = (body.get('telefone') or '').strip()
    status = (body.get('status') or 'novo').strip() or 'novo'
    observacoes = (body.get('observacoes') or '').strip()

    if not nome:
        return jsonify({'error': 'Nome do cliente e obrigatorio.'}), 400

    agora = now_iso()
    with get_db() as conn:
        cur = conn.execute(
            '''
            INSERT INTO clientes (store_id, nome, telefone, status, observacoes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ''',
            (store_id, nome, telefone, status, observacoes, agora, agora)
        )
        cliente_id = inserted_id(conn, cur)
        row = conn.execute('SELECT * FROM clientes WHERE id = ? AND store_id = ?', (cliente_id, store_id)).fetchone()
    return jsonify({'cliente': row_to_cliente(row)}), 201


@app.route('/api/clientes/<int:cliente_id>', methods=['PUT'])
@login_required
def atualizar_cliente(cliente_id):
    body = request.get_json(silent=True) or {}
    store_id = current_store_id()
    nome = (body.get('nome') or '').strip()
    telefone = (body.get('telefone') or '').strip()
    status = (body.get('status') or 'novo').strip() or 'novo'
    observacoes = (body.get('observacoes') or '').strip()

    if not nome:
        return jsonify({'error': 'Nome do cliente e obrigatorio.'}), 400

    agora = now_iso()
    with get_db() as conn:
        existe = conn.execute('SELECT id FROM clientes WHERE id = ? AND store_id = ?', (cliente_id, store_id)).fetchone()
        if not existe:
            return jsonify({'error': 'Cliente nao encontrado.'}), 404
        conn.execute(
            '''
            UPDATE clientes
            SET nome = ?, telefone = ?, status = ?, observacoes = ?, updated_at = ?
            WHERE id = ? AND store_id = ?
            ''',
            (nome, telefone, status, observacoes, agora, cliente_id, store_id)
        )
        row = conn.execute('SELECT * FROM clientes WHERE id = ? AND store_id = ?', (cliente_id, store_id)).fetchone()
    return jsonify({'cliente': row_to_cliente(row)})


@app.route('/api/clientes/<int:cliente_id>', methods=['DELETE'])
@login_required
def excluir_cliente(cliente_id):
    store_id = current_store_id()
    with get_db() as conn:
        cli = conn.execute('SELECT id FROM clientes WHERE id = ? AND store_id = ?', (cliente_id, store_id)).fetchone()
        if not cli:
            return jsonify({'error': 'Cliente nao encontrado.'}), 404

        total = conn.execute('SELECT COUNT(*) AS total FROM consultas WHERE cliente_id = ? AND store_id = ?', (cliente_id, store_id)).fetchone()
        consultas_removidas = (total['total'] if total else 0)

        conn.execute('DELETE FROM consultas WHERE cliente_id = ? AND store_id = ?', (cliente_id, store_id))
        conn.execute('DELETE FROM clientes WHERE id = ? AND store_id = ?', (cliente_id, store_id))

    return jsonify({
        'ok': True,
        'cliente_id': cliente_id,
        'consultas_removidas': consultas_removidas
    })


@app.route('/api/clientes/<int:cliente_id>/historico', methods=['GET'])
@login_required
def historico_cliente(cliente_id):
    store_id = current_store_id()
    with get_db() as conn:
        cli = conn.execute('SELECT * FROM clientes WHERE id = ? AND store_id = ?', (cliente_id, store_id)).fetchone()
        if not cli:
            return jsonify({'error': 'Cliente nao encontrado.'}), 404
        rows = conn.execute(
            '''
            SELECT * FROM consultas
            WHERE cliente_id = ? AND store_id = ?
            ORDER BY created_at DESC
            LIMIT 100
            ''',
            (cliente_id, store_id)
        ).fetchall()

    return jsonify({
        'cliente': row_to_cliente(cli),
        'historico': [row_to_consulta(r) for r in rows]
    })


@app.route('/api/consultas', methods=['GET'])
@login_required
def listar_consultas():
    cliente_id = request.args.get('cliente_id', type=int)
    limite = request.args.get('limit', default=50, type=int)
    limite = max(1, min(limite, 200))
    store_id = current_store_id()

    with get_db() as conn:
        if cliente_id:
            rows = conn.execute(
                '''
                SELECT cs.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone
                FROM consultas cs
                INNER JOIN clientes c ON c.id = cs.cliente_id
                WHERE cs.cliente_id = ? AND cs.store_id = ?
                ORDER BY cs.created_at DESC
                LIMIT ?
                ''',
                (cliente_id, store_id, limite)
            ).fetchall()
        else:
            rows = conn.execute(
                '''
                SELECT cs.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone
                FROM consultas cs
                INNER JOIN clientes c ON c.id = cs.cliente_id
                WHERE cs.store_id = ?
                ORDER BY cs.created_at DESC
                LIMIT ?
                ''',
                (store_id, limite)
            ).fetchall()

    consultas = []
    for row in rows:
        item = row_to_consulta(row)
        item['cliente_nome'] = row['cliente_nome']
        item['cliente_telefone'] = row['cliente_telefone'] or ''
        consultas.append(item)
    return jsonify({'consultas': consultas})


@app.route('/api/consultas', methods=['POST'])
@login_required
def criar_consulta():
    body = request.get_json(silent=True) or {}
    store_id = current_store_id()
    cliente_body = body.get('cliente') or {}
    consulta = body.get('consulta') or {}

    nome = (cliente_body.get('nome') or '').strip()
    telefone = (cliente_body.get('telefone') or '').strip()
    status = (cliente_body.get('status') or 'em andamento').strip() or 'em andamento'
    observacoes_cliente = (cliente_body.get('observacoes') or '').strip()

    if not nome:
        return jsonify({'error': 'Nome do cliente e obrigatorio para salvar atendimento.'}), 400

    agora = now_iso()
    with get_db() as conn:
        cliente = None
        if telefone:
            cliente = conn.execute(
                'SELECT * FROM clientes WHERE store_id = ? AND telefone = ? ORDER BY id DESC LIMIT 1',
                (store_id, telefone)
            ).fetchone()
        if not cliente:
            cliente = conn.execute(
                'SELECT * FROM clientes WHERE store_id = ? AND lower(nome) = lower(?) ORDER BY id DESC LIMIT 1',
                (store_id, nome)
            ).fetchone()

        if cliente:
            cliente_id = cliente['id']
            conn.execute(
                '''
                UPDATE clientes
                SET nome = ?, telefone = ?, status = ?, observacoes = ?, updated_at = ?
                WHERE id = ? AND store_id = ?
                ''',
                (nome, telefone, status, observacoes_cliente, agora, cliente_id, store_id)
            )
        else:
            cur = conn.execute(
                '''
                INSERT INTO clientes (store_id, nome, telefone, status, observacoes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ''',
                (store_id, nome, telefone, status, observacoes_cliente, agora, agora)
            )
            cliente_id = inserted_id(conn, cur)

        preco = float(consulta.get('preco') or 0)
        desconto = float(consulta.get('desconto') or 0)
        total = float(consulta.get('total') or max(0, preco - desconto))
        consulta_status = (consulta.get('status') or status or 'em andamento').strip() or 'em andamento'
        pagamentos = consulta.get('pagamentos') or []
        config = consulta.get('config') or {}

        cur = conn.execute(
            '''
            INSERT INTO consultas (
                owner_user_id, store_id, cliente_id, contexto, status, data_orcamento, validade, preco, desconto, total,
                detalhes, observacoes, pagamentos_json, config_json, imagem_preview, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                current_user_id(),
                store_id,
                cliente_id,
                (consulta.get('contexto') or '').strip(),
                consulta_status,
                (consulta.get('data_orcamento') or '').strip(),
                (consulta.get('validade') or '').strip(),
                preco,
                desconto,
                total,
                (consulta.get('detalhes') or '').strip(),
                (consulta.get('observacoes') or '').strip(),
                json.dumps(pagamentos, ensure_ascii=False),
                json.dumps(config, ensure_ascii=False),
                (consulta.get('imagem_preview') or '').strip(),
                agora,
            )
        )
        consulta_id = inserted_id(conn, cur)

        row_cliente = conn.execute('SELECT * FROM clientes WHERE id = ? AND store_id = ?', (cliente_id, store_id)).fetchone()
        row_consulta = conn.execute('SELECT * FROM consultas WHERE id = ? AND store_id = ?', (consulta_id, store_id)).fetchone()

    return jsonify({
        'cliente': row_to_cliente(row_cliente),
        'consulta': row_to_consulta(row_consulta)
    }), 201


@app.route('/api/consultas/<int:consulta_id>', methods=['PUT'])
@login_required
def atualizar_consulta(consulta_id):
    body = request.get_json(silent=True) or {}
    store_id = current_store_id()
    consulta = body.get('consulta') or {}
    cliente_body = body.get('cliente') or {}

    agora = now_iso()
    with get_db() as conn:
        row = conn.execute('SELECT * FROM consultas WHERE id = ? AND store_id = ?', (consulta_id, store_id)).fetchone()
        if not row:
            return jsonify({'error': 'Consulta nao encontrada.'}), 404

        preco = float(consulta.get('preco') or 0)
        desconto = float(consulta.get('desconto') or 0)
        total = float(consulta.get('total') or max(0, preco - desconto))
        consulta_status = (consulta.get('status') or cliente_body.get('status') or row['status'] or 'em andamento').strip() or 'em andamento'
        pagamentos = consulta.get('pagamentos') or []
        config = consulta.get('config') or {}

        conn.execute(
            '''
            UPDATE consultas
            SET contexto=?, status=?, data_orcamento=?, validade=?, preco=?, desconto=?, total=?,
                detalhes=?, observacoes=?, pagamentos_json=?, config_json=?, imagem_preview=?
            WHERE id=? AND store_id = ?
            ''',
            (
                (consulta.get('contexto') or row['contexto'] or '').strip(),
                consulta_status,
                (consulta.get('data_orcamento') or row['data_orcamento'] or '').strip(),
                (consulta.get('validade') or row['validade'] or '').strip(),
                preco, desconto, total,
                (consulta.get('detalhes') or '').strip(),
                (consulta.get('observacoes') or '').strip(),
                json.dumps(pagamentos, ensure_ascii=False),
                json.dumps(config, ensure_ascii=False),
                (consulta.get('imagem_preview') or row['imagem_preview'] or '').strip(),
                consulta_id,
                store_id,
            )
        )

        # Atualiza dados do cliente se fornecidos
        cliente_id = row['cliente_id']
        nome = (cliente_body.get('nome') or '').strip()
        telefone = (cliente_body.get('telefone') or '').strip().replace(' ', '')
        status = (cliente_body.get('status') or '').strip()
        if nome or status:
            fields, vals = [], []
            if nome:
                fields.append('nome=?'); vals.append(nome)
            if telefone:
                fields.append('telefone=?'); vals.append(telefone)
            if status:
                fields.append('status=?'); vals.append(status)
            fields.append('updated_at=?'); vals.append(agora)
            vals.extend([cliente_id, store_id])
            conn.execute(f'UPDATE clientes SET {", ".join(fields)} WHERE id=? AND store_id=?', vals)

        row_consulta = conn.execute('SELECT * FROM consultas WHERE id = ? AND store_id = ?', (consulta_id, store_id)).fetchone()
        row_cliente = conn.execute('SELECT * FROM clientes WHERE id = ? AND store_id = ?', (cliente_id, store_id)).fetchone()

    return jsonify({
        'cliente': row_to_cliente(row_cliente),
        'consulta': row_to_consulta(row_consulta)
    })


@app.route('/api/consultas/<int:consulta_id>', methods=['DELETE'])
@login_required
def excluir_consulta(consulta_id):
    store_id = current_store_id()
    agora = now_iso()
    with get_db() as conn:
        row = conn.execute(
            'SELECT id, cliente_id FROM consultas WHERE id = ? AND store_id = ?',
            (consulta_id, store_id)
        ).fetchone()
        if not row:
            return jsonify({'error': 'Consulta nao encontrada.'}), 404

        cliente_id = row['cliente_id']
        conn.execute('DELETE FROM consultas WHERE id = ? AND store_id = ?', (consulta_id, store_id))
        conn.execute('UPDATE clientes SET updated_at = ? WHERE id = ? AND store_id = ?', (agora, cliente_id, store_id))

        restante = conn.execute(
            'SELECT COUNT(*) AS total FROM consultas WHERE cliente_id = ? AND store_id = ?',
            (cliente_id, store_id)
        ).fetchone()

    return jsonify({
        'ok': True,
        'consulta_id': consulta_id,
        'cliente_id': cliente_id,
        'consultas_restantes': (restante['total'] if restante else 0)
    })


# ── Proxy Gemini (chat e consultor IA) ───────────────────
@app.route('/api/chat', methods=['POST'])
@login_required
def chat_proxy():
    if not GEMINI_API_KEY:
        return jsonify({'error': 'Chave da IA nao configurada. Defina GEMINI_API_KEY ou GOOGLE_API_KEY no servidor.'}), 500

    try:
        body = request.get_json()
        if not body:
            return jsonify({'error': 'Corpo invalido.'}), 400

        system_prompt = body.get('system', '')
        messages = body.get('messages', [])

        gemini_contents = []
        for i, msg in enumerate(messages):
            role = 'user' if msg['role'] == 'user' else 'model'
            text = msg['content']
            if i == 0 and role == 'user' and system_prompt:
                text = system_prompt + '\n\n---\n\n' + text
            gemini_contents.append({
                'role': role,
                'parts': [{'text': text}]
            })

        payload = json.dumps({
            'contents': gemini_contents,
            'generationConfig': {
                'maxOutputTokens': 1000,
                'temperature': 0.7
            }
        }).encode('utf-8')

        url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}'

        req = urllib.request.Request(
            url, data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode('utf-8'))

        text_out = result['candidates'][0]['content']['parts'][0]['text']
        return jsonify({'content': [{'type': 'text', 'text': text_out}]})

    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        return jsonify({'error': f'Erro Gemini: {e.code}', 'detail': err_body}), e.code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/camera/heartbeat', methods=['POST'])
@login_required
def camera_heartbeat():
    store_id = current_store_id()
    touch_camera_heartbeat(store_id)
    snapshot = get_camera_presence_snapshot(store_id)
    return jsonify({'ok': True, **snapshot})


@app.route('/api/camera/presence', methods=['GET'])
@login_required
def camera_presence_status():
    store_id = current_store_id()
    snapshot = get_camera_presence_snapshot(store_id)
    return jsonify({'ok': True, **snapshot})


@app.route('/api/camera/latest-frame', methods=['GET'])
@login_required
def latest_camera_frame():
    store_id = current_store_id()
    after_id = str(request.args.get('after_id') or '').strip()
    row = None
    try:
        with get_db() as conn:
            row = conn.execute(
                '''
                SELECT id, image_b64, metadata, created_at
                FROM frames_cache
                WHERE store_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                ''',
                (store_id,)
            ).fetchone()
    except Exception as db_exc:
        print(f"⚠️ Falha ao consultar frames_cache (store={store_id}): {db_exc}")

    if row:
        if after_id and row['id'] == after_id:
            return jsonify({'ok': True, 'frame': None})

        metadata = decode_json_field(row['metadata'], {}) if row['metadata'] is not None else {}
        return jsonify({
            'ok': True,
            'frame': {
                'frame_id': row['id'],
                'image_url': row['image_b64'],
                'timestamp': row['created_at'],
                'width': int(metadata.get('width') or 0),
                'height': int(metadata.get('height') or 0),
            }
        })

    fallback = camera_latest_frames.get(int(store_id)) if store_id is not None else None
    if not fallback or (after_id and fallback.get('frame_id') == after_id):
        return jsonify({'ok': True, 'frame': None})

    return jsonify({'ok': True, 'frame': fallback})

# ── Sugestao de nome pela imagem (Gemini Vision) ─────────
@app.route('/api/describe-image', methods=['POST'])
@login_required
def describe_image():
    if not GEMINI_API_KEY:
        return jsonify({'error': 'Chave da IA nao configurada. Defina GEMINI_API_KEY ou GOOGLE_API_KEY.'}), 500

    try:
        body = request.get_json()
        if not body or 'image' not in body:
            return jsonify({'error': 'Imagem nao enviada.'}), 400

        image_b64 = body['image']
        mime_type = body.get('mimeType', 'image/jpeg')

        payload = json.dumps({
            'contents': [{
                'parts': [
                    {
                        'inline_data': {
                            'mime_type': mime_type,
                            'data': image_b64
                        }
                    },
                    {
                        'text': (
                            'Olhe esta imagem e responda com APENAS UMA PALAVRA em portugues '
                            'que descreva o assunto principal — por exemplo: mar, floresta, familia, casal, cidade, cachorro, crianca, montanha, flor, praia. '
                            'Responda somente a palavra, sem pontuacao, sem explicacao.'
                        )
                    }
                ]
            }],
            'generationConfig': {'maxOutputTokens': 10, 'temperature': 0.2}
        }).encode('utf-8')

        url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}'

        req = urllib.request.Request(
            url, data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read().decode('utf-8'))

        word = result['candidates'][0]['content']['parts'][0]['text']
        word = ''.join(c for c in word.lower() if c.isalpha() or c in 'áéíóúâêîôûãõàèìòùç')
        return jsonify({'suggestion': word.strip()})

    except urllib.error.HTTPError as e:
        return jsonify({'error': f'Erro Gemini: {e.code}'}), e.code
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
@app.route('/camera')
@login_required
def camera_page():
    """Página de câmera mobile"""
    user = get_authenticated_user()
    socket_auth_token = ''
    if user and user.get('id') and user.get('store_id'):
        socket_auth_token = build_socket_auth_token(user['id'], user['store_id'])
    return render_template('camera.html', socket_auth_token=socket_auth_token)


init_db()

# ── Inicializacao ─────────────────────────────────────────
if __name__ == '__main__':
    socketio.run(
        app,
        debug=not IS_PROD,
        host='0.0.0.0',
        port=int(os.environ.get('PORT', '5000')),
    )
