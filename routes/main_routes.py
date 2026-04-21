from flask import Blueprint, render_template, request, jsonify, redirect, url_for, current_app
from werkzeug.security import check_password_hash
from core.db import get_db, get_user_row_by_username
from core.auth import set_session_user, clear_session_user, get_authenticated_user, login_required
from core.utils import now_iso, row_to_user

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
@login_required
def index():
    user = get_authenticated_user()
    return render_template('index.html', current_user=user)

@main_bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        if get_authenticated_user():
            return redirect(url_for('main.index'))
        return render_template('login.html', is_prod=current_app.config.get('IS_PROD', False))

    username = request.form.get('username')
    password = request.form.get('password')

    with get_db() as conn:
        row = get_user_row_by_username(conn, username)
        store_active = row['store_active'] if row and 'store_active' in row.keys() else True
        if not row or not row['is_active'] or not store_active:
            return render_template('login.html', error='Credenciais invalidas.', is_prod=current_app.config.get('IS_PROD', False))

        if not check_password_hash(row['password_hash'], password):
            return render_template('login.html', error='Credenciais invalidas.', is_prod=current_app.config.get('IS_PROD', False))

        conn.execute(
            'UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = ? WHERE id = ?',
            (now_iso(), row['id'])
        )

        user = row_to_user(row)
        user['store_name'] = row['store_name'] or ''
        set_session_user(user)

    return redirect(url_for('main.index'))

@main_bp.route('/logout')
def logout():
    clear_session_user()
    return redirect(url_for('main.login'))

@main_bp.route('/api/auth/me', methods=['GET'])
@login_required
def auth_me():
    user = get_authenticated_user()
    return jsonify({
        'user': {
            'id': user['id'],
            'username': user['username'],
            'display_name': user['display_name'],
            'role': user['role'],
            'store_id': user['store_id'],
            'store_name': user['store_name'],
        }
    })
