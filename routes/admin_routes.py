from flask import Blueprint, jsonify, request, session
from werkzeug.security import generate_password_hash
from core.auth import login_required, admin_required
from core.db import get_db, inserted_id, count_active_admins, get_user_row_by_username, save_store_state, get_user_by_id
from core.utils import row_to_store, normalize_store_name, normalize_username, parse_bool, normalize_role, now_iso, decode_json_field, default_store_state

admin_bp = Blueprint('admin', __name__)


@admin_bp.route('/api/stores', methods=['GET'])
@login_required
@admin_required
def listar_lojas():
    limite = min(max(request.args.get('limit', default=100, type=int), 1), 500)
    offset = max(request.args.get('offset', default=0, type=int), 0)
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
            LIMIT ? OFFSET ?
            ''',
            (limite, offset)
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
    return jsonify({'stores': lojas, 'limit': limite, 'offset': offset})


@admin_bp.route('/api/stores', methods=['POST'])
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

        save_store_state(conn, store_id, 'catalog', default_store_state('catalog'))
        save_store_state(conn, store_id, 'rooms', default_store_state('rooms'))

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


@admin_bp.route('/api/stores/<int:store_id>', methods=['PUT'])
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
            from core.auth import set_session_user
            set_session_user(current_row)

    out = row_to_store(updated)
    out['access_user_id'] = updated['access_user_id']
    out['access_username'] = updated['access_username'] or ''
    out['access_display_name'] = updated['access_display_name'] or updated['access_username'] or ''
    out['access_role'] = normalize_role(updated['access_role'])
    out['access_is_active'] = bool(updated['access_is_active'])
    return jsonify({'store': out})


@admin_bp.route('/api/stores/<int:store_id>', methods=['DELETE'])
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


@admin_bp.route('/api/stores/<int:store_id>/purge', methods=['DELETE'])
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
            conn.execute('DELETE FROM support_messages WHERE store_id = ?', (store_id,))
            conn.execute('DELETE FROM support_tickets WHERE store_id = ?', (store_id,))
        except Exception:
            pass
        try:
            conn.execute('DELETE FROM frames_cache WHERE store_id = ?', (store_id,))
        except Exception:
            pass
        conn.execute('DELETE FROM users WHERE store_id = ?', (store_id,))
        conn.execute('DELETE FROM stores WHERE id = ?', (store_id,))

    from core.memory_stores import active_sessions, camera_heartbeats, camera_latest_frames
    try:
        active_sessions.pop(int(store_id), None)
        camera_heartbeats.pop(int(store_id), None)
        camera_latest_frames.pop(int(store_id), None)
    except Exception:
        pass

    return jsonify({'ok': True, 'store_id': store_id})


@admin_bp.route('/api/admin/dashboard', methods=['GET'])
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
