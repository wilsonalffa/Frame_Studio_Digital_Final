from flask import Blueprint, jsonify, request
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from core.auth import login_required, current_store_id, current_user_id
from core.db import get_db, inserted_id, load_store_state, save_store_state
from core.utils import row_to_cliente, row_to_consulta, normalize_store_state_scope, default_store_state, now_iso, decode_json_field

crm_bp = Blueprint('crm', __name__)

MERCADOPAGO_API_BASE = 'https://api.mercadopago.com'
MERCADOPAGO_CURRENCY = (os.environ.get('MP_CURRENCY') or 'BRL').strip().upper() or 'BRL'
MERCADOPAGO_ACCESS_TOKEN = (os.environ.get('MP_ACCESS_TOKEN') or '').strip()
MERCADOPAGO_WEBHOOK_SECRET = (os.environ.get('MP_WEBHOOK_SECRET') or '').strip()
APP_BASE_URL = (os.environ.get('FF_BASE_URL') or '').strip().rstrip('/')
ROOM_BASE_PATHS = {
    'sala1': '/static/assets/img/rooms/sala1.jpg',
    'sala2': '/static/assets/img/rooms/sala2.jpg',
    'sala3': '/static/assets/img/rooms/sala3.jpg',
    'sala4': '/static/assets/img/rooms/sala4.jpg',
    'qcasal': '/static/assets/img/rooms/qcasal.jpg',
    'qhospede': '/static/assets/img/rooms/qhospede.jpg',
    'qcrianca': '/static/assets/img/rooms/qcrianca.jpg',
    'gourmet': '/static/assets/img/rooms/gourmet.jpg',
}


def _room_is_usable_src(src):
    if not isinstance(src, str):
        return False
    value = src.strip()
    if not value:
        return False
    return (
        value.startswith('data:image/')
        or value.startswith('/static/')
        or value.startswith('blob:')
        or value.startswith('http://')
        or value.startswith('https://')
    )


def _room_is_base_path_mismatch(key, src):
    expected = ROOM_BASE_PATHS.get(str(key or '').strip())
    if not expected or not isinstance(src, str):
        return False
    value = src.strip()
    if not value or value == expected:
        return False
    if not value.startswith('/static/assets/img/rooms/'):
        return False
    return value in ROOM_BASE_PATHS.values() and value != expected


def _sanitize_rooms_store_state(data):
    safe = data if isinstance(data, dict) else {}
    raw_overrides = safe.get('overrides') if isinstance(safe.get('overrides'), dict) else {}
    raw_customs = safe.get('customs') if isinstance(safe.get('customs'), list) else []

    overrides = {}
    for key, src in raw_overrides.items():
        key_name = str(key or '').strip()
        if key_name and _room_is_usable_src(src) and not _room_is_base_path_mismatch(key_name, src):
            overrides[key_name] = str(src).strip()

    customs = []
    for item in raw_customs:
        if not isinstance(item, dict):
            continue
        key_name = str(item.get('key') or '').strip()
        src = item.get('src')
        if not key_name or not _room_is_usable_src(src) or _room_is_base_path_mismatch(key_name, src):
            continue
        clean = dict(item)
        clean['key'] = key_name
        clean['src'] = str(src).strip()
        customs.append(clean)

    return {'overrides': overrides, 'customs': customs}


def _parse_int(value):
    try:
        return int(value)
    except Exception:
        return None


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


def _is_license_event_from_metadata(metadata):
    return str((metadata or {}).get('license_type') or '').strip().lower() in ('vitalicia', 'mensal')


def _extract_ids_from_external_reference(external_reference):
    consulta_id = None
    store_id = None
    owner_user_id = None
    is_license = False
    raw = str(external_reference or '').strip()
    if not raw:
        return consulta_id, store_id, owner_user_id, is_license

    parts = [p.strip() for p in raw.split(':') if p.strip()]
    for idx, part in enumerate(parts):
        if part == 'licenca':
            is_license = True
        if part == 'consulta' and idx + 1 < len(parts):
            consulta_id = _parse_int(parts[idx + 1])
        elif part == 'store' and idx + 1 < len(parts):
            store_id = _parse_int(parts[idx + 1])
        elif part == 'user' and idx + 1 < len(parts):
            owner_user_id = _parse_int(parts[idx + 1])
    return consulta_id, store_id, owner_user_id, is_license


def _apply_license_activation(conn, store_id, owner_user_id):
    if not store_id:
        return
    now = now_iso()
    conn.execute('UPDATE stores SET is_active = ?, updated_at = ? WHERE id = ?', (True, now, store_id))
    if owner_user_id:
        conn.execute('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?', (True, now, owner_user_id))
    else:
        conn.execute('UPDATE users SET is_active = ?, updated_at = ? WHERE store_id = ?', (True, now, store_id))


def _apply_license_deactivation(conn, store_id, owner_user_id):
    if not store_id:
        return
    now = now_iso()
    conn.execute('UPDATE stores SET is_active = ?, updated_at = ? WHERE id = ?', (False, now, store_id))
    if owner_user_id:
        conn.execute('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?', (False, now, owner_user_id))
    else:
        conn.execute('UPDATE users SET is_active = ?, updated_at = ? WHERE store_id = ?', (False, now, store_id))


def _validate_mercadopago_signature(data_id):
    if not MERCADOPAGO_WEBHOOK_SECRET:
        return True

    x_signature = (request.headers.get('x-signature') or '').strip()
    x_request_id = (request.headers.get('x-request-id') or '').strip()

    if not x_signature or not x_request_id:
        return False

    signature_data = {}
    for item in x_signature.split(','):
        if '=' not in item:
            continue
        key, val = item.split('=', 1)
        signature_data[key.strip()] = val.strip()

    ts = signature_data.get('ts')
    v1 = signature_data.get('v1')
    if not ts or not v1:
        return False

    manifest = f'id:{data_id};request-id:{x_request_id};ts:{ts};'
    digest = hmac.new(
        MERCADOPAGO_WEBHOOK_SECRET.encode('utf-8'),
        manifest.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(digest, v1)


def _resolve_public_base_url():
    if APP_BASE_URL:
        return APP_BASE_URL
    return request.url_root.rstrip('/')


def _upsert_consulta_pagamento(conn, consulta_id, store_id, payment_snapshot):
    if not consulta_id or not store_id:
        return

    row = conn.execute(
        'SELECT id, status, pagamentos_json FROM consultas WHERE id = ? AND store_id = ?',
        (consulta_id, store_id)
    ).fetchone()
    if not row:
        return

    pagamentos = decode_json_field(row['pagamentos_json'], [])
    if not isinstance(pagamentos, list):
        pagamentos = []

    target_idx = -1
    target_payment_id = str(payment_snapshot.get('mp_payment_id') or '').strip()
    for idx, item in enumerate(pagamentos):
        if not isinstance(item, dict):
            continue
        same_gateway = str(item.get('gateway') or '').strip().lower() == 'mercadopago'
        same_id = str(item.get('mp_payment_id') or '').strip() == target_payment_id
        if same_gateway and same_id:
            target_idx = idx
            break

    if target_idx >= 0:
        pagamentos[target_idx] = payment_snapshot
    else:
        pagamentos.append(payment_snapshot)

    novo_status = row['status'] or 'em andamento'
    if payment_snapshot.get('status') == 'approved':
        novo_status = 'pago'

    conn.execute(
        'UPDATE consultas SET pagamentos_json = ?, status = ? WHERE id = ? AND store_id = ?',
        (json.dumps(pagamentos, ensure_ascii=False), novo_status, consulta_id, store_id)
    )


@crm_bp.route('/api/pagamentos/mercadopago/checkout', methods=['POST'])
@login_required
def criar_checkout_mercadopago():
    body = request.get_json(silent=True) or {}
    consulta_id = _parse_int(body.get('consulta_id'))
    if not consulta_id:
        return jsonify({'error': 'Informe consulta_id para gerar o checkout.'}), 400

    store_id = current_store_id()
    with get_db() as conn:
        row = conn.execute(
            '''
            SELECT cs.*, c.nome AS cliente_nome
            FROM consultas cs
            INNER JOIN clientes c ON c.id = cs.cliente_id
            WHERE cs.id = ? AND cs.store_id = ?
            LIMIT 1
            ''',
            (consulta_id, store_id)
        ).fetchone()

        if not row:
            return jsonify({'error': 'Consulta nao encontrada para sua loja.'}), 404

        amount = float(row['total'] or row['preco'] or 0)
        if amount <= 0:
            return jsonify({'error': 'A consulta precisa ter valor total maior que zero.'}), 400

        descricao = (body.get('descricao') or '').strip() or f'Consulta #{consulta_id} - {row["cliente_nome"]}'
        external_reference = f'consulta:{consulta_id}:store:{store_id}'
        base_url = _resolve_public_base_url()

        payload = {
            'items': [
                {
                    'title': descricao,
                    'quantity': 1,
                    'currency_id': MERCADOPAGO_CURRENCY,
                    'unit_price': round(amount, 2),
                }
            ],
            'external_reference': external_reference,
            'notification_url': f'{base_url}/api/pagamentos/mercadopago/webhook',
            'back_urls': {
                'success': f'{base_url}/?pagamento=sucesso',
                'failure': f'{base_url}/?pagamento=falha',
                'pending': f'{base_url}/?pagamento=pendente',
            },
            'auto_return': 'approved',
            'metadata': {
                'consulta_id': consulta_id,
                'store_id': store_id,
                'owner_user_id': current_user_id(),
            },
        }

        payer_email = (body.get('payer_email') or '').strip()
        if payer_email:
            payload['payer'] = {'email': payer_email}

        try:
            preference = _mercadopago_request('POST', '/checkout/preferences', payload)
        except RuntimeError as exc:
            return jsonify({'error': str(exc)}), 502

        now = now_iso()
        preference_id = str(preference.get('id') or '').strip()
        existing = conn.execute(
            'SELECT id FROM pagamentos WHERE mp_preference_id = ? AND store_id = ? LIMIT 1',
            (preference_id, store_id)
        ).fetchone()

        if existing:
            conn.execute(
                '''
                UPDATE pagamentos
                SET status = ?, amount = ?, currency = ?, external_reference = ?, raw_json = ?, updated_at = ?
                WHERE id = ?
                ''',
                (
                    'checkout_criado',
                    round(amount, 2),
                    MERCADOPAGO_CURRENCY,
                    external_reference,
                    json.dumps(preference, ensure_ascii=False),
                    now,
                    existing['id'],
                )
            )
        else:
            conn.execute(
                '''
                INSERT INTO pagamentos (
                    store_id, owner_user_id, consulta_id, gateway, mp_preference_id, external_reference,
                    status, amount, currency, raw_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    store_id,
                    current_user_id(),
                    consulta_id,
                    'mercadopago',
                    preference_id,
                    external_reference,
                    'checkout_criado',
                    round(amount, 2),
                    MERCADOPAGO_CURRENCY,
                    json.dumps(preference, ensure_ascii=False),
                    now,
                    now,
                )
            )

    return jsonify({
        'consulta_id': consulta_id,
        'preference_id': preference.get('id'),
        'init_point': preference.get('init_point'),
        'sandbox_init_point': preference.get('sandbox_init_point'),
    }), 201


@crm_bp.route('/api/pagamentos/mercadopago/webhook', methods=['POST'])
def webhook_mercadopago():
    body = request.get_json(silent=True) or {}
    data = body.get('data') or {}
    event_type = str(body.get('type') or request.args.get('type') or request.args.get('topic') or '').strip().lower()
    data_id = str(data.get('id') or request.args.get('data.id') or '').strip()

    if not data_id:
        return jsonify({'ok': True, 'ignored': 'missing_data_id'})

    if not _validate_mercadopago_signature(data_id):
        return jsonify({'error': 'Assinatura do webhook invalida.'}), 401

    if event_type in ('preapproval', 'subscription_preapproval', 'subscription_authorized_payment'):
        try:
            mp_subscription = _mercadopago_request('GET', f'/preapproval/{urllib.parse.quote(data_id)}')
        except RuntimeError as exc:
            return jsonify({'error': str(exc)}), 502

        status = str(mp_subscription.get('status') or 'pending').strip().lower()
        external_reference = str(mp_subscription.get('external_reference') or '').strip()
        amount = float(((mp_subscription.get('auto_recurring') or {}).get('transaction_amount')) or 0)
        currency = str(((mp_subscription.get('auto_recurring') or {}).get('currency_id')) or MERCADOPAGO_CURRENCY).strip().upper()
        owner_user_id = _parse_int((mp_subscription.get('metadata') or {}).get('owner_user_id'))
        _consulta_id, store_id, ref_owner_user_id, is_license_payment = _extract_ids_from_external_reference(external_reference)
        owner_user_id = owner_user_id or ref_owner_user_id

        now = now_iso()
        with get_db() as conn:
            existing = conn.execute(
                'SELECT id FROM pagamentos WHERE mp_preference_id = ? LIMIT 1',
                (str(mp_subscription.get('id') or data_id),)
            ).fetchone()

            if existing:
                conn.execute(
                    '''
                    UPDATE pagamentos
                    SET consulta_id = NULL,
                        store_id = COALESCE(?, store_id),
                        owner_user_id = COALESCE(?, owner_user_id),
                        status = ?, amount = ?, currency = ?, payment_method = ?,
                        external_reference = ?, raw_json = ?, updated_at = ?, approved_at = COALESCE(?, approved_at)
                    WHERE id = ?
                    ''',
                    (
                        store_id,
                        owner_user_id,
                        status,
                        round(amount, 2),
                        currency,
                        'assinatura',
                        external_reference,
                        json.dumps(mp_subscription, ensure_ascii=False),
                        now,
                        (str(mp_subscription.get('date_approved') or '').strip() or None),
                        existing['id'],
                    )
                )
            else:
                conn.execute(
                    '''
                    INSERT INTO pagamentos (
                        store_id, owner_user_id, consulta_id, gateway, mp_payment_id, mp_preference_id, external_reference,
                        status, amount, currency, payment_method, raw_json, created_at, updated_at, approved_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''',
                    (
                        store_id,
                        owner_user_id,
                        None,
                        'mercadopago',
                        None,
                        str(mp_subscription.get('id') or data_id),
                        external_reference,
                        status,
                        round(amount, 2),
                        currency,
                        'assinatura',
                        json.dumps(mp_subscription, ensure_ascii=False),
                        now,
                        now,
                        (str(mp_subscription.get('date_approved') or '').strip() or None),
                    )
                )

            if is_license_payment:
                if status in ('authorized', 'active'):
                    _apply_license_activation(conn, store_id, owner_user_id)
                elif status in ('cancelled', 'paused'):
                    _apply_license_deactivation(conn, store_id, owner_user_id)

        return jsonify({'ok': True, 'subscription_id': str(mp_subscription.get('id') or data_id), 'status': status})

    try:
        mp_payment = _mercadopago_request('GET', f'/v1/payments/{urllib.parse.quote(data_id)}')
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 502

    metadata = mp_payment.get('metadata') or {}
    external_reference = str(mp_payment.get('external_reference') or '').strip()
    consulta_id = _parse_int(metadata.get('consulta_id'))
    store_id = _parse_int(metadata.get('store_id'))
    owner_user_id = _parse_int(metadata.get('owner_user_id'))
    is_license_payment = _is_license_event_from_metadata(metadata)

    if not consulta_id or not store_id:
        ref_consulta_id, ref_store_id, ref_owner_user_id, ref_is_license = _extract_ids_from_external_reference(external_reference)
        consulta_id = consulta_id or ref_consulta_id
        store_id = store_id or ref_store_id
        owner_user_id = owner_user_id or ref_owner_user_id
        is_license_payment = is_license_payment or ref_is_license

    status = str(mp_payment.get('status') or 'pending').strip().lower()
    amount = float(mp_payment.get('transaction_amount') or 0)
    currency = str(mp_payment.get('currency_id') or MERCADOPAGO_CURRENCY).strip().upper()
    payment_method = str(mp_payment.get('payment_method_id') or '').strip()
    paid_at = str(mp_payment.get('date_approved') or '').strip()
    now = now_iso()

    payment_snapshot = {
        'gateway': 'mercadopago',
        'mp_payment_id': str(mp_payment.get('id') or data_id),
        'status': status,
        'valor': round(amount, 2),
        'moeda': currency,
        'metodo': payment_method,
        'updated_at': now,
    }

    with get_db() as conn:
        existing = conn.execute(
            'SELECT id FROM pagamentos WHERE mp_payment_id = ? LIMIT 1',
            (payment_snapshot['mp_payment_id'],)
        ).fetchone()

        if existing:
            conn.execute(
                '''
                UPDATE pagamentos
                SET consulta_id = COALESCE(?, consulta_id),
                    store_id = COALESCE(?, store_id),
                    owner_user_id = COALESCE(?, owner_user_id),
                    status = ?, amount = ?, currency = ?, payment_method = ?,
                    external_reference = ?, raw_json = ?, updated_at = ?, approved_at = COALESCE(?, approved_at)
                WHERE id = ?
                ''',
                (
                    consulta_id,
                    store_id,
                    owner_user_id,
                    status,
                    round(amount, 2),
                    currency,
                    payment_method,
                    external_reference,
                    json.dumps(mp_payment, ensure_ascii=False),
                    now,
                    paid_at or None,
                    existing['id'],
                )
            )
        else:
            conn.execute(
                '''
                INSERT INTO pagamentos (
                    store_id, owner_user_id, consulta_id, gateway, mp_payment_id, external_reference,
                    status, amount, currency, payment_method, raw_json, created_at, updated_at, approved_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    store_id,
                    owner_user_id,
                    consulta_id,
                    'mercadopago',
                    payment_snapshot['mp_payment_id'],
                    external_reference,
                    status,
                    round(amount, 2),
                    currency,
                    payment_method,
                    json.dumps(mp_payment, ensure_ascii=False),
                    now,
                    now,
                    paid_at or None,
                )
            )

        _upsert_consulta_pagamento(conn, consulta_id, store_id, payment_snapshot)
        if status == 'approved' and is_license_payment:
            _apply_license_activation(conn, store_id, owner_user_id)

    return jsonify({'ok': True, 'payment_id': payment_snapshot['mp_payment_id'], 'status': status})


@crm_bp.route('/api/pagamentos/mercadopago/consultas/<int:consulta_id>', methods=['GET'])
@login_required
def listar_pagamentos_consulta(consulta_id):
    store_id = current_store_id()
    with get_db() as conn:
        rows = conn.execute(
            '''
            SELECT * FROM pagamentos
            WHERE consulta_id = ? AND store_id = ? AND gateway = 'mercadopago'
            ORDER BY id DESC
            ''',
            (consulta_id, store_id)
        ).fetchall()

    pagamentos = []
    for row in rows:
        pagamentos.append({
            'id': row['id'],
            'consulta_id': row['consulta_id'],
            'mp_payment_id': row['mp_payment_id'] or '',
            'mp_preference_id': row['mp_preference_id'] or '',
            'status': row['status'] or 'pending',
            'amount': row['amount'] or 0,
            'currency': row['currency'] or MERCADOPAGO_CURRENCY,
            'payment_method': row['payment_method'] or '',
            'external_reference': row['external_reference'] or '',
            'approved_at': row['approved_at'] or '',
            'updated_at': row['updated_at'],
            'created_at': row['created_at'],
        })

    return jsonify({'consulta_id': consulta_id, 'pagamentos': pagamentos})

@crm_bp.route('/api/store-state/<scope>', methods=['GET'])
@login_required
def obter_store_state(scope):
    normalized = normalize_store_state_scope(scope)
    if not normalized:
        return jsonify({'error': 'Escopo de armazenamento invalido.'}), 404

    store_id = current_store_id()
    meta_only = request.args.get('meta_only') in ('1', 'true')

    with get_db() as conn:
        if meta_only:
            # Retorna apenas updated_at para validacao de cache no cliente (sem transferir data_json)
            row = conn.execute(
                'SELECT updated_at FROM store_state WHERE store_id = ? AND scope = ?',
                (store_id, normalized)
            ).fetchone()
            if not row:
                return jsonify({'scope': normalized, 'has_data': False, 'updated_at': ''})
            return jsonify({'scope': normalized, 'has_data': True, 'updated_at': row['updated_at']})

        state = load_store_state(conn, store_id, normalized)

    if not state:
        return jsonify({
            'scope': normalized,
            'has_data': False,
            'data': default_store_state(normalized),
            'updated_at': '',
        })

    data = state['data']
    if normalized == 'rooms':
        data = _sanitize_rooms_store_state(data)
        if data != state['data']:
            with get_db() as conn:
                state = save_store_state(conn, store_id, normalized, data)

    return jsonify({
        'scope': normalized,
        'has_data': True,
        'data': data,
        'updated_at': state['updated_at'],
    })

@crm_bp.route('/api/store-state/<scope>', methods=['PUT'])
@login_required
def salvar_store_state_route(scope):
    normalized = normalize_store_state_scope(scope)
    if not normalized:
        return jsonify({'error': 'Escopo de armazenamento invalido.'}), 404

    body = request.get_json(silent=True) or {}
    if 'data' not in body:
        return jsonify({'error': 'Envie o campo data com o conteudo a salvar.'}), 400

    payload_data = body.get('data')
    if normalized == 'rooms':
        payload_data = _sanitize_rooms_store_state(payload_data)

    try:
        with get_db() as conn:
            state = save_store_state(conn, current_store_id(), normalized, payload_data)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    data = state['data']
    if normalized == 'rooms':
        data = _sanitize_rooms_store_state(data)

    return jsonify({
        'scope': normalized,
        'data': data,
        'updated_at': state['updated_at'],
    })

@crm_bp.route('/api/clientes', methods=['GET'])
@login_required
def listar_clientes():
    busca = request.args.get('q', '').strip()
    limite = min(max(request.args.get('limit', default=100, type=int), 1), 500)
    offset = max(request.args.get('offset', default=0, type=int), 0)
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
                LIMIT ? OFFSET ?
                ''',
                (store_id, like, like, limite, offset)
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
                LIMIT ? OFFSET ?
                ''',
                (store_id, limite, offset)
            ).fetchall()

    clientes = []
    for row in rows:
        cli = row_to_cliente(row)
        cli['total_consultas'] = row['total_consultas'] or 0
        cli['ultima_consulta'] = row['ultima_consulta'] or ''
        clientes.append(cli)
    return jsonify({'clientes': clientes, 'limit': limite, 'offset': offset})

@crm_bp.route('/api/clientes', methods=['POST'])
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

@crm_bp.route('/api/clientes/<int:cliente_id>', methods=['PUT'])
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

@crm_bp.route('/api/clientes/<int:cliente_id>', methods=['DELETE'])
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

@crm_bp.route('/api/clientes/<int:cliente_id>/historico', methods=['GET'])
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

@crm_bp.route('/api/consultas', methods=['GET'])
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

@crm_bp.route('/api/consultas', methods=['POST'])
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
                current_user_id(), store_id, cliente_id, (consulta.get('contexto') or '').strip(),
                consulta_status, (consulta.get('data_orcamento') or '').strip(),
                (consulta.get('validade') or '').strip(), preco, desconto, total,
                (consulta.get('detalhes') or '').strip(), (consulta.get('observacoes') or '').strip(),
                json.dumps(pagamentos, ensure_ascii=False), json.dumps(config, ensure_ascii=False),
                (consulta.get('imagem_preview') or '').strip(), agora,
            )
        )
        consulta_id = inserted_id(conn, cur)

        row_cliente = conn.execute('SELECT * FROM clientes WHERE id = ? AND store_id = ?', (cliente_id, store_id)).fetchone()
        row_consulta = conn.execute('SELECT * FROM consultas WHERE id = ? AND store_id = ?', (consulta_id, store_id)).fetchone()

    return jsonify({
        'cliente': row_to_cliente(row_cliente),
        'consulta': row_to_consulta(row_consulta)
    }), 201

@crm_bp.route('/api/consultas/<int:consulta_id>', methods=['PUT'])
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
                (consulta.get('contexto') or row['contexto'] or '').strip(), consulta_status,
                (consulta.get('data_orcamento') or row['data_orcamento'] or '').strip(),
                (consulta.get('validade') or row['validade'] or '').strip(), preco, desconto, total,
                (consulta.get('detalhes') or '').strip(), (consulta.get('observacoes') or '').strip(),
                json.dumps(pagamentos, ensure_ascii=False), json.dumps(config, ensure_ascii=False),
                (consulta.get('imagem_preview') or row['imagem_preview'] or '').strip(), consulta_id, store_id,
            )
        )

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

@crm_bp.route('/api/consultas/<int:consulta_id>', methods=['DELETE'])
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
