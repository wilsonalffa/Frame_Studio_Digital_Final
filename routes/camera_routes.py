import base64
import uuid
import json
from io import BytesIO
from datetime import datetime, timedelta
from PIL import Image
from flask import Blueprint, jsonify, request, render_template, session
from flask_socketio import emit, join_room, leave_room
from core.auth import (
    login_required, admin_required, current_store_id, current_user_id, 
    parse_socket_auth_token, build_socket_auth_token, get_authenticated_user
)
from core.db import get_db, now_iso
from core.socket_ext import socketio, emit_camera_presence
from core.memory_stores import (
    active_sessions, socket_clients, camera_latest_frames, 
    touch_camera_heartbeat, get_camera_presence_snapshot, normalize_socket_device
)

camera_bp = Blueprint('camera', __name__)

@socketio.on('connect')
def handle_connect():
    user = get_authenticated_user()
    user_id = user['id'] if user else session.get('user_id')
    store_id = user['store_id'] if user else session.get('store_id')
    device_type = normalize_socket_device(request.args.get('device'))

    if not user_id or not store_id:
        socket_auth = parse_socket_auth_token(request.args.get('socket_auth'))
        if socket_auth:
            user_id = socket_auth['user_id']
            store_id = socket_auth['store_id']

    if not user_id or not store_id:
        print(f"⚠️ Socket rejeitado: sessao invalida (sid={request.sid}, device={device_type})")
        return False

    store_sessions = active_sessions.setdefault(
        store_id,
        {'desktop': set(), 'mobile': set(), 'unknown': set()},
    )

    store_sessions.setdefault(device_type, set()).add(request.sid)
    socket_clients[request.sid] = {
        'store_id': store_id,
        'user_id': user_id,
        'device_type': device_type,
    }

    join_room(str(store_id))
    emit('connection_response', {
        'status': 'connected',
        'user_id': user_id,
        'store_id': store_id,
        'device_type': device_type,
        'socketioId': request.sid,
    })
    emit_camera_presence(store_id)
    print(f"✅ Usuario {user_id} conectado ({device_type}, store {store_id})")

@socketio.on('disconnect')
def handle_disconnect():
    client = socket_clients.pop(request.sid, None)
    user_id = (client or {}).get('user_id', session.get('user_id'))
    store_id = (client or {}).get('store_id', session.get('store_id'))
    device_type = (client or {}).get('device_type', normalize_socket_device(request.args.get('device')))

    if store_id and store_id in active_sessions:
        store_sessions = active_sessions[store_id]
        if device_type in store_sessions:
            store_sessions[device_type].discard(request.sid)
        if not any(store_sessions.values()):
            active_sessions.pop(store_id, None)
        emit_camera_presence(store_id)
        print(f"❌ Usuario {user_id} desconectado ({device_type}, store {store_id})")


@camera_bp.route('/api/upload-image', methods=['POST'])
@login_required
def upload_frame():
    try:
        store_id = current_store_id()
        user_id = current_user_id()
        data = request.get_json()

        if not data or 'image' not in data:
            return jsonify({'error': 'Imagem nao fornecida.'}), 400

        raw_b64 = data['image']
        mime_type = data.get('mimeType', 'image/jpeg')

        image_bytes = base64.b64decode(raw_b64.split(',')[-1])
        img = Image.open(BytesIO(image_bytes))

        if img.width > 2000 or img.height > 2000:
            img.thumbnail((2000, 2000), Image.Resampling.LANCZOS)

        output = BytesIO()
        img.save(output, format='JPEG', quality=85, optimize=True)
        compressed_b64 = base64.b64encode(output.getvalue()).decode('utf-8')

        agora = now_iso()
        frame_id = str(uuid.uuid4())[:12]

        metadata_payload = {
            'original_size': len(image_bytes),
            'compressed_size': len(compressed_b64),
            'width': img.width,
            'height': img.height,
        }

        frame_payload = {
            'frame_id': frame_id,
            'image_url': f"data:{mime_type};base64,{compressed_b64}",
            'uploaded_by': user_id,
            'timestamp': agora,
            'width': img.width,
            'height': img.height,
        }

        persisted = True
        try:
            with get_db() as conn:
                if conn.backend == 'postgres':
                    conn.execute(
                        '''
                        INSERT INTO frames_cache (id, store_id, user_id, image_b64, metadata, created_at)
                        VALUES (?, ?, ?, ?, ?::jsonb, ?::timestamptz)
                        ''',
                        (
                            frame_id, store_id, user_id, frame_payload['image_url'],
                            json.dumps(metadata_payload), agora,
                        ),
                    )
                else:
                    conn.execute(
                        '''
                        INSERT INTO frames_cache (id, store_id, user_id, image_b64, metadata, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ''',
                        (
                            frame_id, store_id, user_id, frame_payload['image_url'],
                            json.dumps(metadata_payload), agora,
                        ),
                    )
        except Exception as db_exc:
            persisted = False
            print(f"⚠️ Falha ao persistir frame no banco (store={store_id}): {db_exc}")

        camera_latest_frames[int(store_id)] = frame_payload

        try:
            socketio.emit('new_frame', frame_payload, room=str(store_id))
        except Exception as emit_exc:
            print(f"⚠️ Falha ao emitir socket event (store={store_id}): {emit_exc}")

        response = {
            'ok': True,
            'frame_id': frame_id,
            'width': img.width,
            'height': img.height,
            'message': 'Imagem enviada com sucesso.',
            'persisted': persisted,
        }
        if not persisted:
            response['warning'] = 'Imagem sincronizada em tempo real, mas o historico local falhou no servidor.'
        return jsonify(response)

    except Exception as e:
        return jsonify({'error': 'Falha ao processar a imagem.', 'details': str(e)}), 500


@camera_bp.route('/api/cleanup-frames', methods=['POST'])
@admin_required
def cleanup_frames():
    cutoff = (datetime.now() - timedelta(days=7)).isoformat(timespec='seconds')
    with get_db() as conn:
        if conn.backend == 'postgres':
            cur = conn.execute('DELETE FROM frames_cache WHERE created_at < ?::timestamptz', (cutoff,))
        else:
            cur = conn.execute('DELETE FROM frames_cache WHERE created_at < ?', (cutoff,))
    removed = cur._cursor.rowcount if hasattr(cur, '_cursor') else None
    return jsonify({'ok': True, 'message': 'Limpeza concluida', 'removed': removed})

@camera_bp.route('/api/camera/heartbeat', methods=['POST'])
@login_required
def camera_heartbeat():
    store_id = current_store_id()
    touch_camera_heartbeat(store_id)
    snapshot = get_camera_presence_snapshot(store_id)
    return jsonify({'ok': True, **snapshot})

@camera_bp.route('/api/camera/presence', methods=['GET'])
@login_required
def camera_presence_status():
    store_id = current_store_id()
    snapshot = get_camera_presence_snapshot(store_id)
    return jsonify({'ok': True, **snapshot})

@camera_bp.route('/api/camera/latest-frame', methods=['GET'])
@login_required
def latest_camera_frame():
    store_id = current_store_id()
    after_id = str(request.args.get('after_id') or '').strip()
    row = None
    try:
        from core.utils import decode_json_field
        with get_db() as conn:
            row = conn.execute(
                '''
                SELECT id, image_b64, metadata, created_at
                FROM frames_cache
                WHERE store_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                ''',
                (store_id,)
            ).fetchone()
    except Exception as db_exc:
        print(f"⚠️ Falha ao consultar frames_cache (store={store_id}): {db_exc}")

    if row:
        if after_id and row['id'] == after_id:
            return jsonify({'ok': True, 'frame': None})
        from core.utils import decode_json_field
        metadata = decode_json_field(row['metadata'], {}) if row['metadata'] is not None else {}
        return jsonify({
            'ok': True,
            'frame': {
                'frame_id': row['id'],
                'image_url': row['image_b64'],
                'timestamp': row['created_at'],
                'width': int(metadata.get('width') or 0),
                'height': int(metadata.get('height') or 0),
            }
        })

    fallback = camera_latest_frames.get(int(store_id)) if store_id is not None else None
    if not fallback or (after_id and fallback.get('frame_id') == after_id):
        return jsonify({'ok': True, 'frame': None})

    return jsonify({'ok': True, 'frame': fallback})

@camera_bp.route('/camera')
@login_required
def camera_page():
    user = get_authenticated_user()
    socket_auth_token = ''
    if user and user.get('id') and user.get('store_id'):
        socket_auth_token = build_socket_auth_token(user['id'], user['store_id'])
    return render_template('camera.html', socket_auth_token=socket_auth_token)
