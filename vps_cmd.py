import os
import socket
import time
import paramiko
from dotenv import load_dotenv

# Загрузка переменных окружения из .env
load_dotenv()


def get_ssh_connection(timeout: int = 15):
    """Создаёт и возвращает авторизованный SSHClient и сокет на основе настроек из .env."""
    host = os.getenv("VPS_HOST", "194.87.92.31")
    user = os.getenv("VPS_USER", "root")
    port = int(os.getenv("VPS_PORT", "22"))
    key_path = os.getenv("VPS_KEY_PATH")
    password = os.getenv("VPS_PASSWORD")
    bind_ip = os.getenv("VPS_BIND_IP")

    sock = None
    if bind_ip:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((bind_ip, 0))
            sock.settimeout(timeout)
            sock.connect((host, port))
        except Exception:
            if sock:
                try:
                    sock.close()
                except Exception:
                    pass
            sock = None

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_kwargs = {
        "hostname": host,
        "port": port,
        "username": user,
        "timeout": timeout,
    }
    if sock:
        connect_kwargs["sock"] = sock

    if key_path:
        expanded_key = os.path.expanduser(key_path)
        if os.path.exists(expanded_key):
            connect_kwargs["key_filename"] = expanded_key
        elif password:
            connect_kwargs["password"] = password
    elif password:
        connect_kwargs["password"] = password

    client.connect(**connect_kwargs)
    return client, sock


def execute(cmd: str, retries: int = 2):
    """Выполняет команду на VPS через SSH и возвращает (stdout, stderr)."""
    for attempt in range(1, retries + 1):
        sock = None
        client = None
        try:
            client, sock = get_ssh_connection(timeout=15)
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode("utf-8", errors="ignore")
            err = stderr.read().decode("utf-8", errors="ignore")
            return out, err
        except Exception as e:
            if attempt == retries:
                raise
            time.sleep(2)
        finally:
            if client:
                try:
                    client.close()
                except Exception:
                    pass
            if sock:
                try:
                    sock.close()
                except Exception:
                    pass


if __name__ == "__main__":
    py_code = """
import sqlite3
conn = sqlite3.connect('/var/www/college-schedule/server/data.db')
cursor = conn.cursor()
cursor.execute('SELECT COUNT(*) FROM users')
print('Users count:', cursor.fetchone()[0])
"""
    out, err = execute(f"/var/www/college-schedule/venv/bin/python -c \"{py_code}\"")
    print("OUTPUT:\n", out)
    if err:
        print("ERR:\n", err)
