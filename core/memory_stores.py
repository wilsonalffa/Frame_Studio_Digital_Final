from datetime import datetime, timedelta

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
