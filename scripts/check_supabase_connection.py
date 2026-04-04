import os

from dotenv import load_dotenv
import psycopg


def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    load_dotenv(os.path.join(base_dir, ".env"))
    dsn = os.environ.get("DIRECT_URL") or os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("Defina DATABASE_URL ou DIRECT_URL no .env")

    try:
        conn = psycopg.connect(dsn)
        cur = conn.cursor()
        cur.execute("select current_database(), current_user, version()")
        db, user, version = cur.fetchone()
        print("✓ Conexao OK")
        print("  database:", db)
        print("  user:", user)
        print("  postgres:", version.split(" ")[1])
        cur.close()
        conn.close()
    except Exception as e:
        print("✗ Erro de conexao:", str(e))
        raise


if __name__ == "__main__":
    main()
