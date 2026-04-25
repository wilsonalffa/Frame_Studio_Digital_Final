from flask import Blueprint, jsonify, request
import json
from core.auth import login_required, current_store_id, current_user_id
from core.db import get_db, inserted_id, load_store_state, save_store_state
from core.utils import row_to_cliente, row_to_consulta, normalize_store_state_scope, default_store_state, now_iso

crm_bp = Blueprint('crm', __name__)

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

    return jsonify({
        'scope': normalized,
        'has_data': True,
        'data': state['data'],
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
