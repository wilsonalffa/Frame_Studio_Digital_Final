from flask import session, g, request, jsonify, redirect, url_for, current_app
from functools import wraps
from itsdangerous import URLSafeSerializer, BadSignature
from core.db import get_db, get_user_row_by_username
from core.utils import row_to_user, normalize_role

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
        return getattr(g, '_auth_user', None)

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
    return redirect(url_for('main.login', next=request.url))

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

SOCKET_AUTH_SALT = 'fastframe-socket-auth-v1'

def build_socket_auth_token(user_id, store_id):
    from itsdangerous import URLSafeSerializer
    from flask import current_app
    serializer = URLSafeSerializer(current_app.secret_key, salt=SOCKET_AUTH_SALT)
    return serializer.dumps({'user_id': int(user_id), 'store_id': int(store_id)})

def parse_socket_auth_token(token):
    if not token:
        return None
    from itsdangerous import URLSafeSerializer, BadSignature
    from flask import current_app
    serializer = URLSafeSerializer(current_app.secret_key, salt=SOCKET_AUTH_SALT)
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
