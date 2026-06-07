from io import BytesIO
from flask import Blueprint, render_template, request, jsonify, redirect, url_for, current_app, send_file
from werkzeug.security import check_password_hash
from PIL import Image, UnidentifiedImageError
from core.db import get_db, get_user_row_by_username
from core.auth import set_session_user, clear_session_user, get_authenticated_user, login_required
from core.utils import now_iso, row_to_user

try:
    import rawpy
except Exception:
    rawpy = None

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
