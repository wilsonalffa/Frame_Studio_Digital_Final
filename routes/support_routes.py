import json
import os
import re
import unicodedata
import smtplib
from email.message import EmailMessage
import urllib.error
import urllib.request
from flask import Blueprint, jsonify, request, current_app
from core.auth import login_required, get_authenticated_user
from core.db import get_db, inserted_id
from core.socket_ext import socketio
from core.utils import now_iso

support_bp = Blueprint('support', __name__)

GEMINI_API_KEY = (os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY') or '').strip()
GEMINI_MODEL = (os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash') or 'gemini-2.5-flash').replace('models/', '')
SUPPORT_NOTIFY_EMAILS = [
    addr.strip()
    for addr in re.split(r'[;,]+', os.environ.get('SUPPORT_NOTIFY_EMAILS', ''))
    if addr.strip()
]
SUPPORT_MANDATORY_NOTIFY_EMAIL = 'suporte@framestudiodigital.com.br'
if SUPPORT_MANDATORY_NOTIFY_EMAIL.lower() not in {a.lower() for a in SUPPORT_NOTIFY_EMAILS}:
    SUPPORT_NOTIFY_EMAILS.append(SUPPORT_MANDATORY_NOTIFY_EMAIL)
SUPPORT_SMTP_HOST = (os.environ.get('SUPPORT_SMTP_HOST') or '').strip()
SUPPORT_SMTP_PORT = int(os.environ.get('SUPPORT_SMTP_PORT') or '587')
SUPPORT_SMTP_USERNAME = (os.environ.get('SUPPORT_SMTP_USERNAME') or '').strip()
SUPPORT_SMTP_PASSWORD = (os.environ.get('SUPPORT_SMTP_PASSWORD') or '').strip()
SUPPORT_SMTP_FROM = (os.environ.get('SUPPORT_SMTP_FROM') or SUPPORT_SMTP_USERNAME or '').strip()
SUPPORT_SMTP_USE_SSL = str(os.environ.get('SUPPORT_SMTP_USE_SSL') or '').strip().lower() in ('1', 'true', 'yes', 'sim', 'on')
SUPPORT_SMTP_USE_STARTTLS = str(os.environ.get('SUPPORT_SMTP_USE_STARTTLS') or '1').strip().lower() in ('1', 'true', 'yes', 'sim', 'on')

FAQ_STOPWORDS = {
    'como', 'faco', 'fazer', 'usar', 'uso', 'para', 'com', 'sem', 'por', 'favor',
    'quero', 'preciso', 'ajuda', 'duvida', 'duvidas', 'passo', 'passos', 'rapido',
    'fluxo', 'aba', 'abas', 'sistema', 'gerar',
}


def _norm_category(value):
    key = str(value or '').strip().lower()
    allowed = {'geral', 'acesso', 'financeiro', 'orcamento', 'simulador', 'integracao', 'outro'}
    return key if key in allowed else 'geral'


def _norm_severity(value):
    key = str(value or '').strip().lower()
    allowed = {'baixa', 'media', 'alta', 'critica'}
    return key if key in allowed else 'media'


def _norm_status(value):
    key = str(value or '').strip().lower()
    allowed = {'aberto', 'em_andamento', 'resolvido'}
    return key if key in allowed else 'aberto'


def _infer_severity(subject, message, fallback='media'):
    text = f"{subject or ''} {message or ''}".lower()
    crit_tokens = (
        'fora do ar',
        'site caiu',
        'indisponivel',
        'indisponível',
        'nao abre',
        'não abre',
        'erro 500',
        'erro geral',
    )
    high_tokens = (
        'nao consigo login',
        'não consigo login',
        'nao consigo entrar',
        'não consigo entrar',
        'pagamento',
        'checkout',
        'travando',
        'travou',
    )
    med_tokens = (
        'duvida',
        'dúvida',
        'lento',
        'demora',
        'inconsistente',
    )

    if any(t in text for t in crit_tokens):
        return 'critica'
    if any(t in text for t in high_tokens):
        return 'alta'
    if any(t in text for t in med_tokens):
        return 'media'
    return _norm_severity(fallback)


def _infer_category_by_rules(subject, message):
    text = f"{subject or ''} {message or ''}".lower()
    if any(t in text for t in ('login', 'senha', 'acesso', 'entrar')):
        return 'acesso'
    if any(t in text for t in ('pagamento', 'cobranca', 'cobrança', 'financeiro', 'mercado pago', 'checkout')):
        return 'financeiro'
    if any(t in text for t in ('orcamento', 'orçamento', 'desconto', 'valor')):
        return 'orcamento'
    if any(t in text for t in ('simulador', 'simulacao', 'simulação', 'ambiente', 'quadro')):
        return 'simulador'
    if any(t in text for t in ('api', 'integracao', 'integração', 'webhook')):
        return 'integracao'
    return 'geral'


def _build_local_summary(subject, message, severity, category):
    clean_subject = ' '.join(str(subject or '').strip().split())
    clean_message = ' '.join(str(message or '').strip().split())
    clean_message = clean_message[:220] + ('...' if len(clean_message) > 220 else '')
    return f"Triagem local: severidade {severity}, categoria {category}. Assunto: {clean_subject}. Contexto: {clean_message}"


def _parse_triage_response(raw_text):
    if not raw_text:
        return None

    text = str(raw_text).strip()
    try:
        data = json.loads(text)
    except Exception:
        # Tenta extrair JSON mesmo se vier com prefixo/sufixo.
        start = text.find('{')
        end = text.rfind('}')
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(text[start:end + 1])
        except Exception:
            return None

    if not isinstance(data, dict):
        return None

    severity = _norm_severity(data.get('severity'))
    category = _norm_category(data.get('category'))
    summary = str(data.get('summary') or '').strip()
    if not summary:
        return None

    if len(summary) > 400:
        summary = summary[:400].rstrip() + '...'

    return {
        'severity': severity,
        'category': category,
        'summary': summary,
    }


def _ai_triage(subject, message):
    if not GEMINI_API_KEY:
        return None

    prompt = (
        'Voce e um classificador de chamados de suporte de software. '\
        'Classifique o chamado e retorne SOMENTE JSON valido, sem markdown, no formato '\
        '{"severity":"critica|alta|media|baixa","category":"geral|acesso|financeiro|orcamento|simulador|integracao|outro","summary":"texto curto"}. '\
        'Resumo maximo de 240 caracteres em pt-BR, objetivo e sem promessas.\n\n'
        f'Assunto: {subject}\n'
        f'Mensagem: {message}'
    )

    payload = json.dumps({
        'contents': [{
            'role': 'user',
            'parts': [{'text': prompt}],
        }],
        'generationConfig': {
            'maxOutputTokens': 220,
            'temperature': 0.1,
        }
    }).encode('utf-8')

    url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}'
    req = urllib.request.Request(
        url,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        raw_text = result['candidates'][0]['content']['parts'][0]['text']
        return _parse_triage_response(raw_text)
    except (KeyError, IndexError, TypeError, ValueError, urllib.error.HTTPError, urllib.error.URLError):
        return None
    except Exception:
        return None


def _build_local_reply_suggestion(ticket, messages, operator_note=''):
    severity = str(ticket.get('severity') or 'media').lower()
    status = str(ticket.get('status') or 'aberto').lower()
    subject = str(ticket.get('subject') or 'seu chamado').strip()
    requester = ''
    if messages:
        first_user = next((m for m in messages if str(m.get('author_type') or '').lower() == 'user'), None)
        if first_user:
            requester = str(first_user.get('author_name') or '').strip()

    saudacao = f"Olá {requester}," if requester else 'Olá,'

    if status == 'resolvido':
        return (
            f"{saudacao}\n"
            "este chamado já consta como resolvido no sistema. "
            "Se o problema voltou a ocorrer, por favor confirme o horário e o que está acontecendo agora para reabrirmos a análise imediatamente."
        )

    if severity == 'critica':
        base = (
            f"{saudacao}\n"
            f"recebemos seu chamado sobre \"{subject}\" e já tratamos como prioridade crítica. "
            "Nossa equipe está atuando agora para estabilizar o serviço. "
            "Por favor, compartilhe um print/horário exato da última falha para acelerar a correção."
        )
    elif severity == 'alta':
        base = (
            f"{saudacao}\n"
            f"obrigado pelo relato sobre \"{subject}\". "
            "Classificamos como prioridade alta e iniciamos a verificação técnica. "
            "Se possível, confirme usuário afetado e passos para reproduzir."
        )
    else:
        base = (
            f"{saudacao}\n"
            f"obrigado por abrir o chamado sobre \"{subject}\". "
            "Já registramos e vamos seguir com a análise. "
            "Se tiver mais detalhes (print, horário ou mensagem de erro), envie por aqui para agilizar."
        )

    if operator_note:
        note = str(operator_note).strip()
        if note:
            base += f"\n\nObservação interna aplicada: {note}"

    return base


def _ai_suggest_reply(ticket, messages, operator_note=''):
    if not GEMINI_API_KEY:
        return None

    transcript_lines = []
    for m in (messages or [])[-10:]:
        who = 'Suporte' if str(m.get('author_type') or '').lower() == 'support' else 'Usuário'
        msg = str(m.get('message') or '').replace('\n', ' ').strip()
        if msg:
            transcript_lines.append(f"{who}: {msg}")
    transcript = '\n'.join(transcript_lines) or '(sem histórico detalhado)'

    prompt = (
        'Você é um analista de suporte de software em português (pt-BR). '
        'Gere APENAS o texto da resposta para o usuário, sem markdown e sem prefixos técnicos. '
        'A resposta deve ser objetiva, profissional, empática, em no máximo 600 caracteres e nunca prometer prazo exato. '
        'Se faltar contexto, peça os dados mínimos necessários (print, horário, passos).\n\n'
        f"Dados do chamado:\n"
        f"- Assunto: {ticket.get('subject') or ''}\n"
        f"- Categoria: {ticket.get('category') or ''}\n"
        f"- Severidade: {ticket.get('severity') or ''}\n"
        f"- Status: {ticket.get('status') or ''}\n"
        f"- Resumo IA: {ticket.get('ai_summary') or ''}\n"
        f"- Observação do operador: {operator_note or 'nenhuma'}\n\n"
        f"Histórico:\n{transcript}"
    )

    payload = json.dumps({
        'contents': [{
            'role': 'user',
            'parts': [{'text': prompt}],
        }],
        'generationConfig': {
            'maxOutputTokens': 260,
            'temperature': 0.3,
        }
    }).encode('utf-8')

    url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}'
    req = urllib.request.Request(
        url,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=18) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        text = str(result['candidates'][0]['content']['parts'][0]['text']).strip()
        if not text:
            return None
        if len(text) > 700:
            text = text[:700].rstrip() + '...'
        return text
    except (KeyError, IndexError, TypeError, ValueError, urllib.error.HTTPError, urllib.error.URLError):
        return None
    except Exception:
        return None


def _tokenize_text(value):
    normalized = _normalize_text(value)
    words = re.findall(r'[a-z0-9]+', normalized)
    aliases = {
        'ambinte': 'ambiente',
        'simulacao': 'simulador',
        'simulacoes': 'simulador',
        'simulador': 'simulador',
        'quadros': 'quadro',
        'quadro': 'quadro',
        'clientes': 'cliente',
        'cliente': 'cliente',
        'montagens': 'montagem',
        'divisoes': 'divisao',
    }
    tokens = []
    for w in words:
        if len(w) < 3:
            continue
        token = aliases.get(w, w)
        if token in FAQ_STOPWORDS:
            continue
        tokens.append(token)
    return tokens


def _normalize_text(value):
    raw = str(value or '').strip().lower()
    if not raw:
        return ''
    # Remove acentos para melhorar o match entre variacoes de escrita.
    nfkd = unicodedata.normalize('NFKD', raw)
    return ''.join(ch for ch in nfkd if not unicodedata.combining(ch))


def _faq_score(question_tokens, question_text, faq_text):
    faq_norm = _normalize_text(faq_text)
    faq_tokens = set(_tokenize_text(faq_norm))
    if not faq_tokens:
        return 0.0

    q_tokens = [t for t in (question_tokens or []) if t]
    if not q_tokens:
        return 0.0

    overlap = sum(1 for t in q_tokens if t in faq_tokens)
    unique_q = set(q_tokens)
    coverage = overlap / max(1, len(unique_q))
    score = float(overlap) + (coverage * 1.6)

    q_norm = _normalize_text(question_text)
    if q_norm and q_norm in faq_norm:
        score += 3.0

    if unique_q.issubset(faq_tokens):
        score += 1.8

    # Boost para consultas compostas por nomes de abas, ex: "divisao sangria".
    if len(q_tokens) >= 2:
        q_bigrams = {' '.join(q_tokens[i:i + 2]) for i in range(len(q_tokens) - 1)}
        if any(bg in faq_norm for bg in q_bigrams):
            score += 1.2

    return score


def _search_faq_candidates(conn, question, limit=5):
    rows = conn.execute(
        '''
        SELECT id, question, answer, tags, category, priority, updated_at
        FROM support_faq
        WHERE is_active = ?
        ORDER BY priority ASC, updated_at DESC
        ''',
        (True,)
    ).fetchall()

    q_tokens = _tokenize_text(question)
    scored = []
    for r in rows:
        score = _faq_score(
            q_tokens,
            question,
            f"{r['question']} {r['tags'] or ''} {r['answer']}"
        )
        if score <= 0:
            continue
        scored.append({
            'id': r['id'],
            'question': r['question'],
            'answer': r['answer'],
            'tags': r['tags'] or '',
            'category': r['category'] or 'geral',
            'score': score,
        })

    scored.sort(key=lambda item: (-item['score'], item['id']))
    return scored[:max(1, int(limit or 5))]


def _load_faq_index(conn, limit=120):
    rows = conn.execute(
        '''
        SELECT question, tags, category, priority
        FROM support_faq
        WHERE is_active = ?
        ORDER BY priority ASC, updated_at DESC
        LIMIT ?
        ''',
        (True, max(20, int(limit or 120)))
    ).fetchall()

    out = []
    for r in rows:
        out.append({
            'question': r['question'] or '',
            'tags': r['tags'] or '',
            'category': r['category'] or 'geral',
            'priority': int(r['priority'] or 999),
        })
    return out


def _parse_self_service_ai(raw_text):
    if not raw_text:
        return None

    text = str(raw_text).strip()
    try:
        data = json.loads(text)
    except Exception:
        start = text.find('{')
        end = text.rfind('}')
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(text[start:end + 1])
        except Exception:
            return None

    if not isinstance(data, dict):
        return None

    answer = str(data.get('answer') or '').strip()
    if not answer:
        return None
    if len(answer) > 900:
        answer = answer[:900].rstrip() + '...'

    try:
        confidence = float(data.get('confidence', 0.45))
    except Exception:
        confidence = 0.45
    confidence = max(0.0, min(1.0, confidence))

    needs_handoff = bool(data.get('needs_handoff'))
    category = _norm_category(data.get('category'))
    suggested_subject = str(data.get('suggested_subject') or '').strip()
    if len(suggested_subject) > 120:
        suggested_subject = suggested_subject[:120].rstrip()

    return {
        'answer': answer,
        'confidence': confidence,
        'needs_handoff': needs_handoff,
        'category': category,
        'suggested_subject': suggested_subject,
    }


def _ai_self_service_answer(question, faq_candidates, faq_index=None):
    if not GEMINI_API_KEY:
        return None

    faq_context = []
    for idx, item in enumerate((faq_candidates or [])[:5], start=1):
        faq_context.append(
            f"FAQ {idx}: pergunta={item.get('question')}; resposta={item.get('answer')}; categoria={item.get('category')}"
        )
    faq_text = '\n'.join(faq_context) if faq_context else '(sem FAQ relevante encontrada)'

    catalog_lines = []
    for item in (faq_index or [])[:120]:
        q = str(item.get('question') or '').strip()
        if not q:
            continue
        cat = str(item.get('category') or 'geral').strip()
        tags = str(item.get('tags') or '').strip()
        catalog_lines.append(f"- [{cat}] {q} | tags: {tags}")
    faq_catalog = '\n'.join(catalog_lines) if catalog_lines else '(catalogo indisponivel)'

    prompt = (
        'Voce e o especialista oficial do Frame Studio, respondendo em tom consultivo e prescritivo, como quem opera o sistema no dia a dia. '\
        'Responda em pt-BR e retorne SOMENTE JSON valido no formato '\
        '{"answer":"...","confidence":0.0,"needs_handoff":false,"category":"geral|acesso|financeiro|orcamento|simulador|integracao|outro","suggested_subject":"..."}. '\
        'A resposta deve ser objetiva, pratica e sem inventar dados. '\
        'Sempre que for orientacao de uso, entregue um passo a passo claro com acoes concretas (3 a 7 passos). '\
        'Se a pergunta pedir visao geral, descreva modulos principais e depois um fluxo recomendado de inicio ao fim. '\
        'Nao cite funcionalidades que nao estejam na base enviada. '\
        'Se a confianca for baixa ou o caso parecer incidente serio, marque needs_handoff=true.\n\n'
        f"Pergunta do usuario: {question}\n\n"
        f"FAQ mais proximas:\n{faq_text}\n\n"
        f"Catalogo de funcionalidades mapeadas:\n{faq_catalog}"
    )

    payload = json.dumps({
        'contents': [{
            'role': 'user',
            'parts': [{'text': prompt}],
        }],
        'generationConfig': {
            'maxOutputTokens': 520,
            'temperature': 0.25,
        }
    }).encode('utf-8')

    url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}'
    req = urllib.request.Request(
        url,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=18) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        raw_text = result['candidates'][0]['content']['parts'][0]['text']
        return _parse_self_service_ai(raw_text)
    except (KeyError, IndexError, TypeError, ValueError, urllib.error.HTTPError, urllib.error.URLError):
        return None
    except Exception:
        return None


def _row_to_ticket(row):
    return {
        'id': row['id'],
        'store_id': row['store_id'],
        'store_name': row['store_name'] if 'store_name' in row.keys() else '',
        'user_id': row['user_id'],
        'subject': row['subject'] or '',
        'category': row['category'] or 'geral',
        'severity': row['severity'] or 'media',
        'status': row['status'] or 'aberto',
        'channel': row['channel'] or 'painel',
        'ai_summary': row['ai_summary'] or '',
        'first_response_at': row['first_response_at'] or '',
        'closed_at': row['closed_at'] or '',
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
        'created_by': row['created_by'] if 'created_by' in row.keys() else '',
        'created_by_username': row['created_by_username'] if 'created_by_username' in row.keys() else '',
    }


def _row_to_message(row):
    return {
        'id': row['id'],
        'ticket_id': row['ticket_id'],
        'store_id': row['store_id'],
        'author_user_id': row['author_user_id'],
        'author_type': row['author_type'] or 'user',
        'message': row['message'] or '',
        'created_at': row['created_at'],
        'author_name': row['author_name'] if 'author_name' in row.keys() else '',
    }


def _notify_support_ticket_created(ticket, user, message_text):
    if not SUPPORT_NOTIFY_EMAILS or not SUPPORT_SMTP_HOST:
        current_app.logger.info('Notificacao de suporte nao enviada: SMTP ou destinatarios nao configurados.')
        return False

    subject = f"[Suporte] { _support_protocol(ticket['id']) } - {ticket.get('subject') or 'Novo chamado'}"
    body_lines = [
        'Novo chamado foi aberto no Frame Studio Digital.',
        '',
        f"Protocolo: {_support_protocol(ticket['id'])}",
        f"Unidade: {user.get('store_name') or user.get('store_id') or '-'}",
        f"Usuario: {user.get('display_name') or user.get('username') or '-'}",
        f"Categoria: {ticket.get('category') or 'geral'}",
        f"Severidade: {ticket.get('severity') or 'media'}",
        f"Status: {ticket.get('status') or 'aberto'}",
        f"Assunto: {ticket.get('subject') or '-'}",
        '',
        'Mensagem:',
        message_text or '-',
        '',
        f"Resumo IA: {ticket.get('ai_summary') or '-'}",
    ]

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = SUPPORT_SMTP_FROM or SUPPORT_SMTP_USERNAME or 'noreply@localhost'
    msg['To'] = ', '.join(SUPPORT_NOTIFY_EMAILS)
    msg.set_content('\n'.join(body_lines))

    try:
        if SUPPORT_SMTP_USE_SSL:
          server = smtplib.SMTP_SSL(SUPPORT_SMTP_HOST, SUPPORT_SMTP_PORT, timeout=20)
        else:
          server = smtplib.SMTP(SUPPORT_SMTP_HOST, SUPPORT_SMTP_PORT, timeout=20)
        with server as smtp:
            if SUPPORT_SMTP_USE_STARTTLS and not SUPPORT_SMTP_USE_SSL:
                smtp.starttls()
            if SUPPORT_SMTP_USERNAME:
                smtp.login(SUPPORT_SMTP_USERNAME, SUPPORT_SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except Exception as exc:
        current_app.logger.warning('Falha ao enviar e-mail de suporte: %s', exc)
        return False


def _emit_support_ticket_created(ticket, user):
    try:
        payload = {
            'id': ticket.get('id'),
            'protocol': _support_protocol(ticket.get('id')),
            'store_id': ticket.get('store_id') or user.get('store_id'),
            'store_name': ticket.get('store_name') or user.get('store_name') or '',
            'subject': ticket.get('subject') or '',
            'category': ticket.get('category') or 'geral',
            'severity': ticket.get('severity') or 'media',
            'status': ticket.get('status') or 'aberto',
            'created_by': ticket.get('created_by') or user.get('display_name') or user.get('username') or '',
            'created_by_username': ticket.get('created_by_username') or user.get('username') or '',
            'created_at': ticket.get('created_at') or now_iso(),
        }

        # Notifica usuarios da propria unidade.
        socketio.emit('support_ticket_created', payload, room=str(payload['store_id']))
        # Notifica painel administrativo global.
        socketio.emit('support_ticket_created', payload, room='admins')
    except Exception as exc:
        current_app.logger.warning('Falha ao emitir notificacao em tempo real de suporte: %s', exc)


def _is_admin_user(user):
    return str((user or {}).get('role') or '').strip().lower() == 'admin'


def _support_protocol(ticket_id):
    return f'SUP-{int(ticket_id or 0):06d}'


@support_bp.route('/api/support/tickets', methods=['GET'])
@login_required
def support_listar_chamados():
    user = get_authenticated_user()
    if not user or not user.get('store_id'):
        return jsonify({'error': 'Sessao invalida para suporte.'}), 401

    is_admin = _is_admin_user(user)

    status = _norm_status(request.args.get('status')) if request.args.get('status') else ''
    severity = _norm_severity(request.args.get('severity')) if request.args.get('severity') else ''
    limit = min(max(request.args.get('limit', default=50, type=int), 1), 200)

    sql = '''
        SELECT t.*, u.display_name AS created_by, u.username AS created_by_username, s.name AS store_name
        FROM support_tickets t
        LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN stores s ON s.id = t.store_id
        WHERE 1 = 1
    '''
    params = []

    filter_store_id = request.args.get('store_id', type=int)
    if is_admin:
        if filter_store_id:
            sql += ' AND t.store_id = ?'
            params.append(filter_store_id)
    else:
        sql += ' AND t.store_id = ?'
        params.append(user['store_id'])

    if status:
        sql += ' AND t.status = ?'
        params.append(status)
    if severity:
        sql += ' AND t.severity = ?'
        params.append(severity)

    sql += ' ORDER BY t.created_at DESC LIMIT ?'
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()

    tickets = [_row_to_ticket(r) for r in rows]
    return jsonify({'tickets': tickets, 'limit': limit, 'scope': 'all' if is_admin else 'store'})


@support_bp.route('/api/support/tickets', methods=['POST'])
@login_required
def support_criar_chamado():
    user = get_authenticated_user()
    if not user or not user.get('store_id'):
        return jsonify({'error': 'Sessao invalida para suporte.'}), 401

    body = request.get_json(silent=True) or {}
    subject = str(body.get('subject') or '').strip()
    message = str(body.get('message') or '').strip()
    category = _norm_category(body.get('category'))
    channel = str(body.get('channel') or 'painel').strip().lower() or 'painel'

    if len(subject) < 5:
        return jsonify({'error': 'Informe um assunto com pelo menos 5 caracteres.'}), 400
    if len(message) < 10:
        return jsonify({'error': 'Descreva o problema com pelo menos 10 caracteres.'}), 400

    severity_rule = _infer_severity(subject, message, fallback=body.get('severity'))
    category_rule = category if category != 'geral' else _infer_category_by_rules(subject, message)
    summary_rule = _build_local_summary(subject, message, severity_rule, category_rule)

    triage_ai = _ai_triage(subject, message)
    severity = triage_ai['severity'] if triage_ai else severity_rule
    category = triage_ai['category'] if triage_ai else category_rule
    ai_summary = triage_ai['summary'] if triage_ai else summary_rule

    status = 'aberto'
    now = now_iso()

    with get_db() as conn:
        cur = conn.execute(
            '''
            INSERT INTO support_tickets (
                store_id, user_id, subject, category, severity, status, channel,
                ai_summary, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                user['store_id'],
                user['id'],
                subject,
                category,
                severity,
                status,
                channel,
                ai_summary,
                now,
                now,
            )
        )
        ticket_id = inserted_id(conn, cur)

        conn.execute(
            '''
            INSERT INTO support_messages (
                ticket_id, store_id, author_user_id, author_type, message, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ''',
            (ticket_id, user['store_id'], user['id'], 'user', message, now)
        )

        row = conn.execute(
            '''
            SELECT t.*, u.display_name AS created_by, u.username AS created_by_username, s.name AS store_name
            FROM support_tickets t
            LEFT JOIN users u ON u.id = t.user_id
            LEFT JOIN stores s ON s.id = t.store_id
            WHERE t.id = ? AND t.store_id = ?
            ''',
            (ticket_id, user['store_id'])
        ).fetchone()

    ticket = _row_to_ticket(row)
    _notify_support_ticket_created(ticket, user, message)
    _emit_support_ticket_created(ticket, user)
    return jsonify({'ticket': ticket, 'protocol': f'SUP-{ticket_id:06d}'}), 201


@support_bp.route('/api/support/tickets/<int:ticket_id>', methods=['GET'])
@login_required
def support_detalhar_chamado(ticket_id):
    user = get_authenticated_user()
    if not user or not user.get('store_id'):
        return jsonify({'error': 'Sessao invalida para suporte.'}), 401

    is_admin = _is_admin_user(user)

    with get_db() as conn:
        if is_admin:
            row = conn.execute(
                '''
                SELECT t.*, u.display_name AS created_by, u.username AS created_by_username, s.name AS store_name
                FROM support_tickets t
                LEFT JOIN users u ON u.id = t.user_id
                LEFT JOIN stores s ON s.id = t.store_id
                WHERE t.id = ?
                ''',
                (ticket_id,)
            ).fetchone()
        else:
            row = conn.execute(
                '''
                SELECT t.*, u.display_name AS created_by, u.username AS created_by_username, s.name AS store_name
                FROM support_tickets t
                LEFT JOIN users u ON u.id = t.user_id
                LEFT JOIN stores s ON s.id = t.store_id
                WHERE t.id = ? AND t.store_id = ?
                ''',
                (ticket_id, user['store_id'])
            ).fetchone()
        if not row:
            return jsonify({'error': 'Chamado nao encontrado.'}), 404

        msg_rows = conn.execute(
            '''
            SELECT m.*, u.display_name AS author_name
            FROM support_messages m
            LEFT JOIN users u ON u.id = m.author_user_id
            WHERE m.ticket_id = ? AND m.store_id = ?
            ORDER BY m.created_at ASC
            ''',
            (ticket_id, row['store_id'])
        ).fetchall()

    ticket = _row_to_ticket(row)
    messages = [_row_to_message(mr) for mr in msg_rows]
    return jsonify({'ticket': ticket, 'messages': messages, 'protocol': f'SUP-{ticket_id:06d}'})


@support_bp.route('/api/support/tickets/<int:ticket_id>/reply', methods=['POST'])
@login_required
def support_responder_chamado(ticket_id):
    user = get_authenticated_user()
    if not user or not user.get('store_id'):
        return jsonify({'error': 'Sessao invalida para suporte.'}), 401

    body = request.get_json(silent=True) or {}
    message = str(body.get('message') or '').strip()
    if len(message) < 2:
        return jsonify({'error': 'Mensagem muito curta.'}), 400

    author_type = 'support' if str(user.get('role') or '').lower() == 'admin' else 'user'
    now = now_iso()
    is_admin = _is_admin_user(user)

    with get_db() as conn:
        if is_admin:
            ticket = conn.execute(
                'SELECT * FROM support_tickets WHERE id = ?',
                (ticket_id,)
            ).fetchone()
        else:
            ticket = conn.execute(
                'SELECT * FROM support_tickets WHERE id = ? AND store_id = ?',
                (ticket_id, user['store_id'])
            ).fetchone()
        if not ticket:
            return jsonify({'error': 'Chamado nao encontrado.'}), 404

        if str(ticket['status'] or '').lower() == 'resolvido':
            return jsonify({'error': 'Chamado ja foi encerrado.'}), 400

        conn.execute(
            '''
            INSERT INTO support_messages (
                ticket_id, store_id, author_user_id, author_type, message, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ''',
            (ticket_id, ticket['store_id'], user['id'], author_type, message, now)
        )

        updates = ['updated_at = ?']
        values = [now]
        if author_type == 'support' and not ticket['first_response_at']:
            updates.append('first_response_at = ?')
            values.append(now)
        if str(ticket['status'] or '').lower() == 'aberto' and author_type == 'support':
            updates.append('status = ?')
            values.append('em_andamento')

        values.extend([ticket_id, ticket['store_id']])
        conn.execute(
            f"UPDATE support_tickets SET {', '.join(updates)} WHERE id = ? AND store_id = ?",
            tuple(values)
        )

    return jsonify({'ok': True, 'ticket_id': ticket_id})


@support_bp.route('/api/support/tickets/<int:ticket_id>/suggest-reply', methods=['POST'])
@login_required
def support_sugerir_resposta(ticket_id):
    user = get_authenticated_user()
    if not user or not user.get('store_id'):
        return jsonify({'error': 'Sessao invalida para suporte.'}), 401

    body = request.get_json(silent=True) or {}
    operator_note = str(body.get('operator_note') or '').strip()
    if len(operator_note) > 300:
        operator_note = operator_note[:300]

    is_admin = _is_admin_user(user)

    with get_db() as conn:
        if is_admin:
            row = conn.execute(
                '''
                SELECT t.*, u.display_name AS created_by
                FROM support_tickets t
                LEFT JOIN users u ON u.id = t.user_id
                WHERE t.id = ?
                ''',
                (ticket_id,)
            ).fetchone()
        else:
            row = conn.execute(
                '''
                SELECT t.*, u.display_name AS created_by
                FROM support_tickets t
                LEFT JOIN users u ON u.id = t.user_id
                WHERE t.id = ? AND t.store_id = ?
                ''',
                (ticket_id, user['store_id'])
            ).fetchone()
        if not row:
            return jsonify({'error': 'Chamado nao encontrado.'}), 404

        msg_rows = conn.execute(
            '''
            SELECT m.*, u.display_name AS author_name
            FROM support_messages m
            LEFT JOIN users u ON u.id = m.author_user_id
            WHERE m.ticket_id = ? AND m.store_id = ?
            ORDER BY m.created_at ASC
            ''',
            (ticket_id, row['store_id'])
        ).fetchall()

    ticket = _row_to_ticket(row)
    messages = [_row_to_message(mr) for mr in msg_rows]

    ai_text = _ai_suggest_reply(ticket, messages, operator_note=operator_note)
    suggestion = ai_text or _build_local_reply_suggestion(ticket, messages, operator_note=operator_note)

    return jsonify({
        'ticket_id': ticket_id,
        'protocol': f'SUP-{ticket_id:06d}',
        'suggestion': suggestion,
        'source': 'ai' if ai_text else 'fallback',
    })


@support_bp.route('/api/support/tickets/<int:ticket_id>/close', methods=['POST'])
@login_required
def support_encerrar_chamado(ticket_id):
    user = get_authenticated_user()
    if not user or not user.get('store_id'):
        return jsonify({'error': 'Sessao invalida para suporte.'}), 401

    now = now_iso()
    is_admin = _is_admin_user(user)

    with get_db() as conn:
        if is_admin:
            row = conn.execute(
                'SELECT id, store_id FROM support_tickets WHERE id = ?',
                (ticket_id,)
            ).fetchone()
        else:
            row = conn.execute(
                'SELECT id, store_id FROM support_tickets WHERE id = ? AND store_id = ?',
                (ticket_id, user['store_id'])
            ).fetchone()
        if not row:
            return jsonify({'error': 'Chamado nao encontrado.'}), 404

        conn.execute(
            '''
            UPDATE support_tickets
            SET status = ?, closed_at = ?, updated_at = ?
            WHERE id = ? AND store_id = ?
            ''',
            ('resolvido', now, now, ticket_id, row['store_id'])
        )

    return jsonify({'ok': True, 'ticket_id': ticket_id})


@support_bp.route('/api/support/tickets/<int:ticket_id>', methods=['DELETE'])
@login_required
def support_excluir_chamado(ticket_id):
    user = get_authenticated_user()
    if not user or not user.get('store_id'):
        return jsonify({'error': 'Sessao invalida para suporte.'}), 401

    is_admin = str(user.get('role') or '').lower() == 'admin'
    now = now_iso()

    with get_db() as conn:
        if is_admin:
            ticket = conn.execute(
                'SELECT * FROM support_tickets WHERE id = ?',
                (ticket_id,)
            ).fetchone()
        else:
            ticket = conn.execute(
                'SELECT * FROM support_tickets WHERE id = ? AND store_id = ?',
                (ticket_id, user['store_id'])
            ).fetchone()
        if not ticket:
            return jsonify({'error': 'Chamado nao encontrado.'}), 404
        if not is_admin and int(ticket['user_id'] or 0) != int(user['id'] or 0):
            return jsonify({'error': 'Você só pode excluir os seus próprios chamados.'}), 403

        conn.execute('DELETE FROM support_messages WHERE ticket_id = ? AND store_id = ?', (ticket_id, ticket['store_id']))
        conn.execute('DELETE FROM support_tickets WHERE id = ? AND store_id = ?', (ticket_id, ticket['store_id']))

    return jsonify({'ok': True, 'ticket_id': ticket_id, 'deleted_at': now})


@support_bp.route('/api/support/self-service', methods=['POST'])
@login_required
def support_autoatendimento():
    user = get_authenticated_user()
    if not user or not user.get('store_id'):
        return jsonify({'error': 'Sessão inválida para autoatendimento.'}), 401

    body = request.get_json(silent=True) or {}
    question = str(body.get('question') or '').strip()
    auto_create_ticket = bool(body.get('auto_create_ticket'))

    if len(question) < 5:
        return jsonify({'error': 'Descreva sua dúvida com pelo menos 5 caracteres.'}), 400

    now = now_iso()
    with get_db() as conn:
        faq_candidates = _search_faq_candidates(conn, question, limit=5)
        faq_index = _load_faq_index(conn, limit=120)

        best_faq = faq_candidates[0] if faq_candidates else None
        q_len = len(set(_tokenize_text(question)))
        faq_threshold = 1.25 if q_len <= 2 else 2.1

        answer = ''
        confidence = 0.0
        category = 'geral'
        source = 'fallback'
        needs_handoff = False
        suggested_subject = ''

        if best_faq and float(best_faq.get('score') or 0.0) >= faq_threshold:
            answer = best_faq['answer']
            confidence = min(0.96, 0.52 + (float(best_faq['score']) * 0.07))
            category = _norm_category(best_faq.get('category'))
            source = 'faq'
            suggested_subject = best_faq.get('question') or 'Duvida operacional'
            needs_handoff = confidence < 0.62
        else:
            ai_out = _ai_self_service_answer(question, faq_candidates, faq_index)
            if ai_out:
                answer = ai_out['answer']
                confidence = ai_out['confidence']
                category = ai_out['category']
                source = 'ai'
                needs_handoff = bool(ai_out['needs_handoff']) or confidence < 0.55
                suggested_subject = ai_out['suggested_subject'] or 'Duvida operacional'
            else:
                source = 'fallback'
                category = _infer_category_by_rules(question, question)
                confidence = 0.42
                needs_handoff = True
                suggested_subject = 'Dúvida não resolvida no autoatendimento'
                answer = (
                    'Não encontrei uma resposta com confiança para esta dúvida. '
                    'Posso abrir um chamado automaticamente para o suporte continuar o atendimento.'
                )

        ticket_payload = None
        if auto_create_ticket:
            subject = suggested_subject or 'Dúvida no autoatendimento'
            severity = _infer_severity(subject, question, fallback='media')
            handoff_label = 'Escalonado automaticamente via autoatendimento.' if needs_handoff else 'Chamado aberto pelo usuario apos autoatendimento.'
            ai_summary = f"{_build_local_summary(subject, question, severity, category)} {handoff_label}"

            cur = conn.execute(
                '''
                INSERT INTO support_tickets (
                    store_id, user_id, subject, category, severity, status, channel,
                    ai_summary, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    user['store_id'],
                    user['id'],
                    subject,
                    category,
                    severity,
                    'aberto',
                    'autoatendimento',
                    ai_summary,
                    now,
                    now,
                )
            )
            ticket_id = inserted_id(conn, cur)
            conn.execute(
                '''
                INSERT INTO support_messages (
                    ticket_id, store_id, author_user_id, author_type, message, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ''',
                (
                    ticket_id,
                    user['store_id'],
                    user['id'],
                    'user',
                    f'Duvida via autoatendimento: {question}',
                    now,
                )
            )

            ticket_payload = {
                'id': ticket_id,
                'protocol': f'SUP-{ticket_id:06d}',
                'subject': subject,
                'status': 'aberto',
            }
            _notify_support_ticket_created(
                {
                    'id': ticket_id,
                    'store_id': user['store_id'],
                    'store_name': user.get('store_name') or '',
                    'subject': subject,
                    'category': category,
                    'severity': severity,
                    'status': 'aberto',
                    'ai_summary': ai_summary,
                    'created_by': user.get('display_name') or user.get('username') or '',
                    'created_by_username': user.get('username') or '',
                },
                user,
                f'Duvida via autoatendimento: {question}',
            )
            _emit_support_ticket_created(
                {
                    'id': ticket_id,
                    'store_id': user['store_id'],
                    'store_name': user.get('store_name') or '',
                    'subject': subject,
                    'category': category,
                    'severity': severity,
                    'status': 'aberto',
                    'created_by': user.get('display_name') or user.get('username') or '',
                    'created_by_username': user.get('username') or '',
                    'created_at': now,
                },
                user,
            )

    return jsonify({
        'answer': answer,
        'confidence': round(float(confidence), 2),
        'category': category,
        'source': source,
        'needs_handoff': bool(needs_handoff),
        'faq_candidates': [
            {
                'id': item['id'],
                'question': item['question'],
                'category': item['category'],
                'score': item['score'],
            }
            for item in faq_candidates
        ],
        'ticket': ticket_payload,
    })
