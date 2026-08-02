from io import BytesIO
import json
import os
import urllib.error
import urllib.request
from flask import Blueprint, render_template, request, jsonify, redirect, url_for, current_app, send_file
from werkzeug.security import check_password_hash, generate_password_hash
from PIL import Image, UnidentifiedImageError
from core.db import get_db, get_user_row_by_username, inserted_id
from core.auth import set_session_user, clear_session_user, get_authenticated_user, login_required, current_store_id, current_user_id
from core.utils import now_iso, row_to_user

try:
    import rawpy
except Exception:
    rawpy = None

main_bp = Blueprint('main', __name__)

MERCADOPAGO_API_BASE = 'https://api.mercadopago.com'
MERCADOPAGO_CURRENCY = (os.environ.get('MP_CURRENCY') or 'BRL').strip().upper() or 'BRL'
MERCADOPAGO_ACCESS_TOKEN = (os.environ.get('MP_ACCESS_TOKEN') or '').strip()
APP_BASE_URL = (os.environ.get('FF_BASE_URL') or '').strip().rstrip('/')
LICENSE_PRICE = 120.0
LICENSE_FREQUENCY = int(os.environ.get('FF_LICENSE_FREQUENCY') or '1')
LICENSE_FREQUENCY_TYPE = (os.environ.get('FF_LICENSE_FREQUENCY_TYPE') or 'months').strip().lower() or 'months'


def _mercadopago_request(method, path, payload=None):
    if not MERCADOPAGO_ACCESS_TOKEN:
        raise RuntimeError('Defina MP_ACCESS_TOKEN para habilitar pagamentos via Mercado Pago.')

    url = f'{MERCADOPAGO_API_BASE}{path}'
    headers = {
        'Authorization': f'Bearer {MERCADOPAGO_ACCESS_TOKEN}',
        'Content-Type': 'application/json',
    }
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url=url, data=body, headers=headers, method=method.upper())

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode('utf-8')
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = ''
        try:
            payload = exc.read().decode('utf-8')
            parsed = json.loads(payload)
            detail = parsed.get('message') or parsed.get('error') or payload
        except Exception:
            detail = str(exc)
        raise RuntimeError(f'Falha na API do Mercado Pago ({exc.code}): {detail}') from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f'Erro de conexao com Mercado Pago: {exc.reason}') from exc


def _resolve_public_base_url():
    if APP_BASE_URL:
        return APP_BASE_URL
    return request.url_root.rstrip('/')


def _criar_assinatura_licenca(store_id, owner_user_id, payer_email=''):
    base_url = _resolve_public_base_url()
    external_reference = f'licenca:store:{store_id}:user:{owner_user_id}'
    payload = {
        'reason': 'Licenca Frame Studio Digital - Mensal',
        'external_reference': external_reference,
        'back_url': f'{base_url}/?tab=licenca&pagamento=pendente',
        'notification_url': f'{base_url}/api/pagamentos/mercadopago/webhook',
        'auto_recurring': {
            'frequency': LICENSE_FREQUENCY,
            'frequency_type': LICENSE_FREQUENCY_TYPE,
            'transaction_amount': round(LICENSE_PRICE, 2),
            'currency_id': MERCADOPAGO_CURRENCY,
        },
    }
    if payer_email:
        payload['payer_email'] = payer_email

    return _mercadopago_request('POST', '/preapproval', payload), external_reference

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
        return render_template(
            'login.html',
            is_prod=current_app.config.get('IS_PROD', False),
        )

    username = request.form.get('username')
    password = request.form.get('password')

    with get_db() as conn:
        row = get_user_row_by_username(conn, username)
        if not row or not row['is_active']:
            return render_template(
                'login.html',
                error='Credenciais invalidas.',
                is_prod=current_app.config.get('IS_PROD', False),
            )

        if not check_password_hash(row['password_hash'], password):
            return render_template(
                'login.html',
                error='Credenciais invalidas.',
                is_prod=current_app.config.get('IS_PROD', False),
            )

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


def _criar_assinatura_licenca_route():
    body = request.get_json(silent=True) or {}
    username = (body.get('username') or '').strip()
    password = (body.get('password') or '').strip()
    payer_email = (body.get('payer_email') or '').strip()

    if not username or not password:
        return jsonify({'error': 'Informe login e senha para gerar o pagamento da licenca.'}), 400

    with get_db() as conn:
        row = get_user_row_by_username(conn, username)
        if not row or not row.get('password_hash'):
            return jsonify({'error': 'Login ou senha invalidos.'}), 401
        if not check_password_hash(row['password_hash'], password):
            return jsonify({'error': 'Login ou senha invalidos.'}), 401

        store_id = row['store_id']
        owner_user_id = row['id']
        if not store_id:
            return jsonify({'error': 'Unidade sem loja vinculada.'}), 400

        try:
            assinatura, external_reference = _criar_assinatura_licenca(store_id, owner_user_id, payer_email=payer_email)
        except RuntimeError as exc:
            return jsonify({'error': str(exc)}), 502

        now = now_iso()
        cur = conn.execute(
            '''
            INSERT INTO pagamentos (
                store_id, owner_user_id, consulta_id, gateway, mp_preference_id, external_reference,
                status, amount, currency, raw_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                store_id,
                owner_user_id,
                None,
                'mercadopago',
                str(assinatura.get('id') or '').strip(),
                external_reference,
                str(assinatura.get('status') or 'pending').strip().lower(),
                round(LICENSE_PRICE, 2),
                MERCADOPAGO_CURRENCY,
                json.dumps(assinatura, ensure_ascii=False),
                now,
                now,
            )
        )
        pagamento_id = inserted_id(conn, cur)

    return jsonify({
        'ok': True,
        'pagamento_id': pagamento_id,
        'subscription_id': assinatura.get('id'),
        'init_point': assinatura.get('init_point'),
        'sandbox_init_point': assinatura.get('sandbox_init_point'),
        'price': round(LICENSE_PRICE, 2),
        'frequency': LICENSE_FREQUENCY,
        'frequency_type': LICENSE_FREQUENCY_TYPE,
    }), 201


@main_bp.route('/api/licenca/assinatura', methods=['POST'])
def criar_assinatura_licenca():
    return _criar_assinatura_licenca_route()


@main_bp.route('/api/licenca/assinatura/app', methods=['POST'])
@login_required
def criar_assinatura_licenca_interna():
    body = request.get_json(silent=True) or {}
    payer_email = (body.get('payer_email') or '').strip()
    store_id = current_store_id()
    owner_user_id = current_user_id()

    if not store_id or not owner_user_id:
        return jsonify({'error': 'Sessao invalida para criar assinatura.'}), 401

    try:
        assinatura, external_reference = _criar_assinatura_licenca(store_id, owner_user_id, payer_email=payer_email)
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 502

    now = now_iso()
    with get_db() as conn:
        cur = conn.execute(
            '''
            INSERT INTO pagamentos (
                store_id, owner_user_id, consulta_id, gateway, mp_preference_id, external_reference,
                status, amount, currency, raw_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                store_id,
                owner_user_id,
                None,
                'mercadopago',
                str(assinatura.get('id') or '').strip(),
                external_reference,
                str(assinatura.get('status') or 'pending').strip().lower(),
                round(LICENSE_PRICE, 2),
                MERCADOPAGO_CURRENCY,
                json.dumps(assinatura, ensure_ascii=False),
                now,
                now,
            )
        )
        pagamento_id = inserted_id(conn, cur)

    return jsonify({
        'ok': True,
        'pagamento_id': pagamento_id,
        'subscription_id': assinatura.get('id'),
        'init_point': assinatura.get('init_point'),
        'sandbox_init_point': assinatura.get('sandbox_init_point'),
        'price': round(LICENSE_PRICE, 2),
        'frequency': LICENSE_FREQUENCY,
        'frequency_type': LICENSE_FREQUENCY_TYPE,
    }), 201


@main_bp.route('/api/licenca/status', methods=['GET'])
@login_required
def obter_status_licenca():
    store_id = current_store_id()
    with get_db() as conn:
        store = conn.execute('SELECT id, is_active FROM stores WHERE id = ?', (store_id,)).fetchone()
        row = conn.execute(
            '''
            SELECT *
            FROM pagamentos
            WHERE store_id = ?
              AND gateway = 'mercadopago'
              AND external_reference LIKE ?
            ORDER BY id DESC
            LIMIT 1
            ''',
            (store_id, 'licenca:%')
        ).fetchone()

    return jsonify({
        'license': {
            'amount': round(LICENSE_PRICE, 2),
            'frequency': LICENSE_FREQUENCY,
            'frequency_type': LICENSE_FREQUENCY_TYPE,
            'store_active': bool(store['is_active']) if store else False,
            'status': (row['status'] if row else 'sem_assinatura'),
            'subscription_id': (row['mp_preference_id'] if row else ''),
            'updated_at': (row['updated_at'] if row else ''),
            'approved_at': (row['approved_at'] if row else ''),
        }
    })


@main_bp.route('/api/licenca/checkout', methods=['POST'])
def criar_checkout_licenca():
    # Compatibilidade com chamadas antigas; agora o fluxo e mensal/recorrente.
    return _criar_assinatura_licenca_route()

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


@main_bp.route('/api/auth/change-password', methods=['POST'])
@login_required
def auth_change_password():
    user = get_authenticated_user()
    body = request.get_json(silent=True) or {}

    current_password = str(body.get('current_password') or '').strip()
    new_password = str(body.get('new_password') or '').strip()
    confirm_password = str(body.get('confirm_password') or '').strip()

    if not current_password:
        return jsonify({'error': 'Informe a senha atual.'}), 400
    if len(new_password) < 6:
        return jsonify({'error': 'A nova senha deve ter pelo menos 6 caracteres.'}), 400
    if new_password != confirm_password:
        return jsonify({'error': 'A confirmação da nova senha não confere.'}), 400
    if current_password == new_password:
        return jsonify({'error': 'A nova senha deve ser diferente da senha atual.'}), 400

    with get_db() as conn:
        row = conn.execute(
            'SELECT id, password_hash FROM users WHERE id = ? AND is_active = ?',
            (user['id'], True)
        ).fetchone()

        if not row:
            return jsonify({'error': 'Usuário não encontrado ou inativo.'}), 404
        if not check_password_hash(row['password_hash'], current_password):
            return jsonify({'error': 'Senha atual inválida.'}), 401

        conn.execute(
            'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
            (generate_password_hash(new_password), now_iso(), user['id'])
        )

    return jsonify({'ok': True, 'message': 'Senha atualizada com sucesso.'})


@main_bp.route('/api/convert-dng', methods=['POST'])
@login_required
def convert_dng():
    file = request.files.get('file')
    if not file:
        return jsonify({'error': 'Arquivo nao enviado.'}), 400

    filename = (file.filename or '').lower()
    mime_type = (file.mimetype or '').lower()
    is_dng = filename.endswith('.dng') or 'dng' in mime_type
    if not is_dng:
        return jsonify({'error': 'Formato invalido. Envie um arquivo DNG.'}), 400

    payload = file.read()
    if not payload:
        return jsonify({'error': 'Arquivo vazio.'}), 400

    output_format = (request.form.get('output') or 'png').strip().lower()
    if output_format not in {'png', 'jpeg', 'jpg'}:
        output_format = 'png'

    def _send_converted(img_obj):
        rgb = img_obj.convert('RGB')
        out = BytesIO()

        if output_format == 'png':
            # PNG e lossless e evita artefatos de compressao para impressao.
            rgb.save(out, format='PNG', optimize=False, compress_level=1)
            mime = 'image/png'
        else:
            # Fallback JPEG com configuracao de maxima fidelidade possivel.
            rgb.save(out, format='JPEG', quality=100, subsampling=0, optimize=False)
            mime = 'image/jpeg'

        out.seek(0)
        return send_file(out, mimetype=mime)

    # Caminho rapido: alguns DNGs sao lidos diretamente pelo Pillow.
    try:
        with Image.open(BytesIO(payload)) as img:
            return _send_converted(img)
    except (UnidentifiedImageError, OSError):
        pass
    except Exception:
        pass

    if rawpy is None:
        return jsonify({
            'error': 'Nao foi possivel converter o DNG neste servidor.',
            'details': 'Dependencia rawpy ausente para fallback de RAW.'
        }), 500

    try:
        with rawpy.imread(BytesIO(payload)) as raw:
            rgb = raw.postprocess(use_camera_wb=True, no_auto_bright=False, output_bps=8)

        img = Image.fromarray(rgb)
        return _send_converted(img)
    except Exception as exc:
        return jsonify({
            'error': 'Falha ao converter DNG.',
            'details': str(exc)
        }), 500
