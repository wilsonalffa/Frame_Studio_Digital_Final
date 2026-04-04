import json
import os
import sqlite3
from datetime import datetime

from dotenv import load_dotenv
import psycopg


def _to_timestamptz(value):
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return s


def _to_json(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    txt = str(value).strip()
    if not txt:
        return None
    try:
        return json.loads(txt)
    except Exception:
        return None


def read_sqlite_rows(sqlite_path):
    con = sqlite3.connect(sqlite_path)
    con.row_factory = sqlite3.Row
    data = {}
    for table in ("stores", "users", "clientes", "consultas", "store_state"):
        data[table] = [dict(r) for r in con.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()]
    con.close()
    return data


def reset_identity(cur, table):
    cur.execute(
        "SELECT setval(pg_get_serial_sequence(%s, 'id'), COALESCE((SELECT MAX(id) FROM " + table + "), 1), true)",
        (table,),
    )


def migrate(data, pg_dsn):
    conn = psycopg.connect(pg_dsn)
    try:
        cur = conn.cursor()
        cur.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE")

        for table in ("consultas", "clientes", "users", "store_state", "stores"):
            cur.execute(f"DELETE FROM {table}")

        for r in data["stores"]:
            cur.execute(
                """
                INSERT INTO stores (id, name, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    r["id"],
                    r["name"],
                    bool(r.get("is_active", 1)),
                    _to_timestamptz(r.get("created_at")),
                    _to_timestamptz(r.get("updated_at")),
                ),
            )

        for r in data["users"]:
            cur.execute(
                """
                INSERT INTO users (id, store_id, username, display_name, password_hash, role, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    r["id"],
                    r.get("store_id"),
                    r["username"],
                    r.get("display_name"),
                    r["password_hash"],
                    r.get("role") or "user",
                    bool(r.get("is_active", 1)),
                    _to_timestamptz(r.get("created_at")),
                    _to_timestamptz(r.get("updated_at")),
                ),
            )

        for r in data["clientes"]:
            cur.execute(
                """
                INSERT INTO clientes (id, owner_user_id, store_id, nome, telefone, status, observacoes, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    r["id"],
                    r.get("owner_user_id"),
                    r.get("store_id"),
                    r["nome"],
                    r.get("telefone"),
                    r.get("status") or "novo",
                    r.get("observacoes"),
                    _to_timestamptz(r.get("created_at")),
                    _to_timestamptz(r.get("updated_at")),
                ),
            )

        for r in data["consultas"]:
            cur.execute(
                """
                INSERT INTO consultas (
                    id, owner_user_id, store_id, cliente_id, contexto, status, data_orcamento, validade,
                    preco, desconto, total, detalhes, observacoes, pagamentos_json, config_json, imagem_preview, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    r["id"],
                    r.get("owner_user_id"),
                    r.get("store_id"),
                    r["cliente_id"],
                    r.get("contexto"),
                    r.get("status") or "em andamento",
                    r.get("data_orcamento"),
                    r.get("validade"),
                    float(r.get("preco") or 0),
                    float(r.get("desconto") or 0),
                    float(r.get("total") or 0),
                    r.get("detalhes"),
                    r.get("observacoes"),
                    json.dumps(_to_json(r.get("pagamentos_json"))) if _to_json(r.get("pagamentos_json")) is not None else None,
                    json.dumps(_to_json(r.get("config_json"))) if _to_json(r.get("config_json")) is not None else None,
                    r.get("imagem_preview"),
                    _to_timestamptz(r.get("created_at")),
                ),
            )

        for r in data["store_state"]:
            payload = _to_json(r.get("data_json"))
            cur.execute(
                """
                INSERT INTO store_state (id, store_id, scope, data_json, created_at, updated_at)
                VALUES (%s, %s, %s, COALESCE(%s::jsonb, '{}'::jsonb), %s, %s)
                """,
                (
                    r["id"],
                    r["store_id"],
                    r["scope"],
                    json.dumps(payload) if payload is not None else None,
                    _to_timestamptz(r.get("created_at")),
                    _to_timestamptz(r.get("updated_at")),
                ),
            )

        for table in ("stores", "users", "clientes", "consultas", "store_state"):
            reset_identity(cur, table)

        conn.commit()
    finally:
        cur.close()
        conn.close()


def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    load_dotenv(os.path.join(base_dir, ".env"))
    sqlite_path = os.environ.get("SQLITE_PATH", os.path.join(base_dir, "data", "fastframe.db"))
    pg_dsn = os.environ.get("DIRECT_URL") or os.environ.get("DATABASE_URL")

    if not pg_dsn:
        raise RuntimeError("Defina DIRECT_URL (ou DATABASE_URL) para conectar no Supabase Postgres.")
    if not os.path.exists(sqlite_path):
        raise RuntimeError(f"SQLite nao encontrado: {sqlite_path}")

    data = read_sqlite_rows(sqlite_path)
    print("SQLite lido com sucesso:")
    for table in ("stores", "users", "clientes", "consultas", "store_state"):
        print(f"- {table}: {len(data[table])} registro(s)")

    migrate(data, pg_dsn)
    print("Migracao concluida com sucesso.")


if __name__ == "__main__":
    main()
