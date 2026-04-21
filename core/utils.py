import json
import re
from datetime import datetime

STORE_STATE_DEFAULTS = {
    'catalog': {'version': 2, 'folders': [], 'items': [], 'sims': []},
    'rooms': {'overrides': {}, 'customs': []},
}

def now_iso():
    return datetime.now().isoformat(timespec='seconds')

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

def row_to_cliente(row):
    if not row:
        return None
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
    if not row:
        return None
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
