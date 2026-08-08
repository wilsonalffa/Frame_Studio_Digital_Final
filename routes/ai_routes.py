import base64
import os
import time
import urllib.request
import urllib.error
import json
from flask import Blueprint, jsonify, request, Response
from core.auth import login_required

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY', '')
GEMINI_MODEL = (os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash') or 'gemini-2.5-flash').replace('models/', '')
REPLICATE_API_TOKEN = os.environ.get('REPLICATE_API_TOKEN', '')
REPLICATE_UPSCALER_BASIC_MODEL = os.environ.get('REPLICATE_UPSCALER_BASIC_MODEL') or os.environ.get('REPLICATE_UPSCALER_MODEL', 'google/upscaler')
REPLICATE_UPSCALER_PREMIUM_MODEL = os.environ.get('REPLICATE_UPSCALER_PREMIUM_MODEL', '').strip()
REPLICATE_UPSCALER_BASIC_IMAGE_FIELD = os.environ.get('REPLICATE_UPSCALER_BASIC_IMAGE_FIELD', 'image').strip() or 'image'
REPLICATE_UPSCALER_BASIC_SCALE_FIELD = os.environ.get('REPLICATE_UPSCALER_BASIC_SCALE_FIELD', 'scale').strip()
REPLICATE_UPSCALER_PREMIUM_IMAGE_FIELD = os.environ.get('REPLICATE_UPSCALER_PREMIUM_IMAGE_FIELD', 'image').strip() or 'image'
REPLICATE_UPSCALER_PREMIUM_SCALE_FIELD = os.environ.get('REPLICATE_UPSCALER_PREMIUM_SCALE_FIELD', 'scale').strip()
REPLICATE_UPSCALER_PREMIUM_ENHANCE_MODEL = os.environ.get('REPLICATE_UPSCALER_PREMIUM_ENHANCE_MODEL', '').strip()
REPLICATE_UPSCALER_PREMIUM_SUBJECT_DETECTION = os.environ.get('REPLICATE_UPSCALER_PREMIUM_SUBJECT_DETECTION', '').strip()
REPLICATE_UPSCALER_PREMIUM_FACE_ENHANCEMENT = os.environ.get('REPLICATE_UPSCALER_PREMIUM_FACE_ENHANCEMENT', '').strip().lower()
REPLICATE_UPSCALER_PREMIUM_FACE_ENHANCEMENT_CREATIVITY = os.environ.get('REPLICATE_UPSCALER_PREMIUM_FACE_ENHANCEMENT_CREATIVITY', '').strip()
MAX_CHAT_MESSAGES = int(os.environ.get('MAX_CHAT_MESSAGES', 20))
MAX_CHAT_TEXT_CHARS = int(os.environ.get('MAX_CHAT_TEXT_CHARS', 16000))
MAX_CHAT_PAYLOAD_BYTES = int(os.environ.get('MAX_CHAT_PAYLOAD_BYTES', 2 * 1024 * 1024))
MAX_IMAGE_B64_CHARS = int(os.environ.get('MAX_IMAGE_B64_CHARS', 8 * 1024 * 1024))
MAX_REPLICATE_IMAGE_BYTES = int(os.environ.get('MAX_REPLICATE_IMAGE_BYTES', 10 * 1024 * 1024))

ai_bp = Blueprint('ai', __name__)


def _replicate_json_request(url, payload, method='POST', timeout=60):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8') if payload is not None else None,
        headers={
            'Authorization': f'Bearer {REPLICATE_API_TOKEN}',
            'Content-Type': 'application/json',
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def _replicate_wait_for_prediction(prediction, timeout_seconds=30):
    poll_url = prediction.get('urls', {}).get('get')
    if not poll_url:
        return prediction

    deadline = time.time() + timeout_seconds
    current = prediction
    while time.time() < deadline:
        status = current.get('status')
        if status in ('succeeded', 'failed', 'canceled'):
            return current
        try:
            current = _replicate_json_request(poll_url, None, method='GET', timeout=20)
        except Exception:
            break
        time.sleep(2)
    return current


def _extract_prediction_output_url(prediction):
    output = prediction.get('output')
    if isinstance(output, str):
        return output
    if isinstance(output, list) and output:
        first = output[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            return first.get('url') or first.get('file') or first.get('image')
    if isinstance(output, dict):
        return output.get('url') or output.get('file') or output.get('image')
    return None


def _resolve_upscaler_profile(requested_tier):
    tier = (requested_tier or 'basic').strip().lower()
    if tier == 'premium' and REPLICATE_UPSCALER_PREMIUM_MODEL:
        return {
            'tier': 'premium',
            'label': 'Upscaler Premium',
            'model': REPLICATE_UPSCALER_PREMIUM_MODEL,
            'image_field': REPLICATE_UPSCALER_PREMIUM_IMAGE_FIELD,
            'scale_field': REPLICATE_UPSCALER_PREMIUM_SCALE_FIELD,
            'enhance_model': REPLICATE_UPSCALER_PREMIUM_ENHANCE_MODEL,
            'subject_detection': REPLICATE_UPSCALER_PREMIUM_SUBJECT_DETECTION,
            'face_enhancement': REPLICATE_UPSCALER_PREMIUM_FACE_ENHANCEMENT,
            'face_enhancement_creativity': REPLICATE_UPSCALER_PREMIUM_FACE_ENHANCEMENT_CREATIVITY,
        }
    return {
        'tier': 'basic',
        'label': 'Upscaler Basico',
        'model': REPLICATE_UPSCALER_BASIC_MODEL,
        'image_field': REPLICATE_UPSCALER_BASIC_IMAGE_FIELD,
        'scale_field': REPLICATE_UPSCALER_BASIC_SCALE_FIELD,
    }


def _to_optional_bool(value):
    normalized = str(value or '').strip().lower()
    if normalized in ('1', 'true', 'sim', 'yes', 'on'):
        return True
    if normalized in ('0', 'false', 'nao', 'não', 'no', 'off'):
        return False
    return None

@ai_bp.route('/api/chat', methods=['POST'])
@login_required
def chat_proxy():
    if not GEMINI_API_KEY:
        return jsonify({'error': 'Chave da IA nao configurada. Defina GEMINI_API_KEY ou GOOGLE_API_KEY no servidor.'}), 500

    try:
        body = request.get_json(silent=True)
        if not body:
            return jsonify({'error': 'Corpo invalido.'}), 400

        system_prompt = str(body.get('system', ''))[:2000]
        messages = body.get('messages', [])
        if not isinstance(messages, list):
            return jsonify({'error': 'Campo messages invalido.'}), 400

        messages = messages[-MAX_CHAT_MESSAGES:]

        gemini_contents = []
        for i, msg in enumerate(messages):
            role = 'user' if msg.get('role') == 'user' else 'model'
            text = str(msg.get('content', ''))[:MAX_CHAT_TEXT_CHARS]
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

        if len(payload) > MAX_CHAT_PAYLOAD_BYTES:
            return jsonify({'error': 'Payload de chat excede o limite permitido.'}), 413

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
        body = request.get_json(silent=True)
        if not body or 'image' not in body:
            return jsonify({'error': 'Imagem nao enviada.'}), 400

        image_b64 = str(body['image'])
        if len(image_b64) > MAX_IMAGE_B64_CHARS:
            return jsonify({'error': 'Imagem excede o limite permitido.'}), 413
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


@ai_bp.route('/api/enhance-image', methods=['POST'])
@login_required
def enhance_image():
    if not REPLICATE_API_TOKEN:
        return jsonify({'error': 'REPLICATE_API_TOKEN nao configurado no servidor.'}), 500

    try:
        uploaded = request.files.get('file')
        if not uploaded:
            body = request.get_json(silent=True) or {}
            image_b64 = str(body.get('image', '') or '')
            if not image_b64:
                return jsonify({'error': 'Imagem nao enviada.'}), 400
            mime_type = str(body.get('mimeType', 'image/jpeg'))
            if ',' in image_b64 and image_b64.startswith('data:'):
                image_data_url = image_b64
            else:
                image_data_url = f'data:{mime_type};base64,{image_b64}'
            requested_scale = int(body.get('scale', 2) or 2)
            requested_tier = str(body.get('upscalerTier', 'basic') or 'basic')
        else:
            image_bytes = uploaded.read()
            if not image_bytes:
                return jsonify({'error': 'Imagem vazia.'}), 400
            if len(image_bytes) > MAX_REPLICATE_IMAGE_BYTES:
                return jsonify({'error': 'Imagem excede o limite permitido para melhoria externa.'}), 413
            mime_type = uploaded.mimetype or 'image/jpeg'
            image_data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
            requested_scale = int(request.form.get('scale', 2) or 2)
            requested_tier = str(request.form.get('upscalerTier', 'basic') or 'basic')

        scale = 4 if requested_scale >= 3 else 2
        profile = _resolve_upscaler_profile(requested_tier)
        if not profile.get('model'):
            return jsonify({'error': 'Nenhum modelo de upscaler configurado no servidor.'}), 500

        model_input = {
            profile['image_field']: image_data_url,
        }
        if profile.get('scale_field'):
            scale_value = scale
            if profile['tier'] == 'premium' and profile.get('scale_field') == 'upscale_factor':
                scale_value = '4x' if scale >= 4 else '2x'
            model_input[profile['scale_field']] = scale_value

        if profile['tier'] == 'premium':
            if profile.get('enhance_model'):
                model_input['enhance_model'] = profile['enhance_model']
            if profile.get('subject_detection'):
                model_input['subject_detection'] = profile['subject_detection']
            face_enhancement = _to_optional_bool(profile.get('face_enhancement'))
            if face_enhancement is not None:
                model_input['face_enhancement'] = face_enhancement
            creativity_raw = str(profile.get('face_enhancement_creativity') or '').strip()
            if creativity_raw:
                try:
                    model_input['face_enhancement_creativity'] = float(creativity_raw)
                except ValueError:
                    pass

        prediction = _replicate_json_request(
            f"https://api.replicate.com/v1/models/{profile['model']}/predictions",
            {
                'input': model_input
            },
            method='POST',
            timeout=60,
        )

        if prediction.get('status') in ('starting', 'processing'):
            prediction = _replicate_wait_for_prediction(prediction, timeout_seconds=30)

        if prediction.get('status') != 'succeeded':
            return jsonify({
                'error': f"Falha ao melhorar a imagem com {profile['label']}.",
                'detail': prediction.get('error') or prediction.get('status') or 'status desconhecido',
            }), 502

        output_url = _extract_prediction_output_url(prediction)
        if not output_url:
            return jsonify({'error': f"{profile['label']} nao retornou uma imagem de saida."}), 502

        output_req = urllib.request.Request(
            output_url,
            headers={
                'Authorization': f'Bearer {REPLICATE_API_TOKEN}',
                'User-Agent': 'FastFrame/1.0',
            },
            method='GET',
        )
        with urllib.request.urlopen(output_req, timeout=60) as output_resp:
            content_type = output_resp.headers.get_content_type() or 'image/jpeg'
            image_bytes = output_resp.read()

        return Response(image_bytes, content_type=content_type)

    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        return jsonify({'error': f'Erro Upscaler: {e.code}', 'detail': err_body}), e.code
    except Exception as e:
        return jsonify({'error': str(e)}), 500
