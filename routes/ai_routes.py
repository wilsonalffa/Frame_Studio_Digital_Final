import os
import urllib.request
import urllib.error
import json
from flask import Blueprint, jsonify, request
from core.auth import login_required

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY', '')
GEMINI_MODEL = (os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash') or 'gemini-2.5-flash').replace('models/', '')

ai_bp = Blueprint('ai', __name__)

@ai_bp.route('/api/chat', methods=['POST'])
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

@ai_bp.route('/api/describe-image', methods=['POST'])
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
