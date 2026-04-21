from flask_socketio import SocketIO

socketio = SocketIO(cors_allowed_origins="*", async_mode='threading', manage_session=False)

def emit_camera_presence(store_id):
    from core.memory_stores import active_sessions
    store_sessions = active_sessions.get(store_id) or {}
    desktop_count = len(store_sessions.get('desktop', set()))
    mobile_count = len(store_sessions.get('mobile', set()))
    socketio.emit(
        'camera_presence',
        {
            'store_id': store_id,
            'desktop_count': desktop_count,
            'mobile_count': mobile_count,
            'mobile_connected': mobile_count > 0,
        },
        room=str(store_id),
    )
