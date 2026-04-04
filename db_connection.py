"""
Abstração de conexão de banco: suporta SQLite (local) e Postgres (Supabase)
Use DEBUG_DB_TYPE para forçar um tipo durante testes; caso contrário, prioriza DIRECT_URL
"""
import os
import sqlite3
import psycopg

DEBUG_DB_TYPE = os.environ.get('DEBUG_DB_TYPE', '').strip().lower()  # 'sqlite' ou 'postgres'
DIRECT_URL = os.environ.get('DIRECT_URL', '').strip()
DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'fastframe.db')

def get_db_type():
    """Retorna 'sqlite' ou 'postgres' baseado em variáveis de ambiente"""
    if DEBUG_DB_TYPE in ('sqlite', 'postgres'):
        return DEBUG_DB_TYPE
    return 'postgres' if DIRECT_URL else 'sqlite'

def get_db():
    """
    Abre uma conexão ao banco (SQLite ou Postgres).
    - SQLite: retorna sqlite3.Connection com row_factory
    - Postgres: retorna psycopg2 ConnectionString (pode chamar cursor())
    """
    db_type = get_db_type()
    
    if db_type == 'postgres':
        if not DIRECT_URL:
            raise RuntimeError('DIRECT_URL não configurada para Postgres')
        # psycopg v3 retorna conexão com interface SQL semelhante
        return psycopg.connect(DIRECT_URL)
    else:
        # SQLite como fallback
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn
