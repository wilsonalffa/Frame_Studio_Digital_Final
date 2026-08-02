import os
from flask import Flask
from core.db import init_db, close_request_db, IS_PROD
from core.socket_ext import socketio
from datetime import timedelta

SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-key-fastframe-2026-fallback')

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.config['IS_PROD'] = IS_PROD
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH', 25 * 1024 * 1024))

app.config.update(
    SESSION_COOKIE_SECURE=IS_PROD,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=timedelta(days=7)
)

socketio.init_app(app)
app.teardown_appcontext(close_request_db)

from routes.main_routes import main_bp
from routes.admin_routes import admin_bp
from routes.crm_routes import crm_bp
from routes.camera_routes import camera_bp
from routes.ai_routes import ai_bp
from routes.support_routes import support_bp

app.register_blueprint(main_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(crm_bp)
app.register_blueprint(camera_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(support_bp)

init_db()

if __name__ == '__main__':
    socketio.run(
        app,
        debug=not IS_PROD,
        host='0.0.0.0',
        port=int(os.environ.get('PORT', '5000')),
    )
