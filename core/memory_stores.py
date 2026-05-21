from datetime import datetime, timedelta

FRAME_TTL = timedelta(hours=2)
SOCKET_TTL = timedelta(hours=2)

active_sessions = {}  
socket_clients = {}  
camera_heartbeats = {}  
camera_latest_frames = {}  

def normalize_socket_device(value):
    device = (value or '').strip().lower()
    if device in ('desktop', 'mobile'):
        return device
    return 'unknown'

def touch_camera_heartbeat(store_id):
    if store_id:
        camera_heartbeats[int(store_id)] = datetime.utcnow()

def get_camera_presence_snapshot(store_id):
    if not store_id:
        return {'mobile_count': 0, 'mobile_connected': False}
    last_seen = camera_heartbeats.get(int(store_id))
    active = bool(last_seen and (datetime.utcnow() - last_seen) <= timedelta(seconds=20))
    return {
        'mobile_count': 1 if active else 0,
        'mobile_connected': active,
        'last_seen_at': last_seen.isoformat() if active else None,
    }


def prune_memory_stores(now=None):
    now = now or datetime.utcnow()

    expired_store_ids = []
    for store_id, frame in camera_latest_frames.items():
        cached_at = frame.get('_cached_at') if isinstance(frame, dict) else None
        if not cached_at or (now - cached_at) > FRAME_TTL:
            expired_store_ids.append(store_id)

    for store_id in expired_store_ids:
        camera_latest_frames.pop(store_id, None)

    stale_sids = []
    for sid, info in socket_clients.items():
        connected_at = info.get('connected_at') if isinstance(info, dict) else None
        if not connected_at or (now - connected_at) > SOCKET_TTL:
            stale_sids.append(sid)

    for sid in stale_sids:
        info = socket_clients.pop(sid, None) or {}
        store_id = info.get('store_id')
        device_type = info.get('device_type', 'unknown')
        if store_id in active_sessions:
            store_sessions = active_sessions[store_id]
            if device_type in store_sessions:
                store_sessions[device_type].discard(sid)
            if not any(store_sessions.values()):
                active_sessions.pop(store_id, None)
