import socket, paramiko, os

def deploy():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(('192.168.1.229', 0))
    sock.settimeout(20)
    sock.connect(('194.87.92.31', 22))

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('194.87.92.31', username='root', password='MRjE3nZtDl', sock=sock)

    sftp = client.open_sftp()

    files = [
        ('server/app.py', '/var/www/college-schedule/server/app.py'),
        ('server/bot.py', '/var/www/college-schedule/server/bot.py'),
        ('server/db.py',  '/var/www/college-schedule/server/db.py'),
        ('server/grades_1c.py', '/var/www/college-schedule/server/grades_1c.py'),
        ('server/crypto_utils.py', '/var/www/college-schedule/server/crypto_utils.py'),
        ('static/index.html', '/var/www/college-schedule/static/index.html'),
        ('static/style.css',  '/var/www/college-schedule/static/style.css'),
        ('static/app.js',     '/var/www/college-schedule/static/app.js'),
        ('static/sw.js',      '/var/www/college-schedule/static/sw.js'),
        ('static/games/snake.js', '/var/www/college-schedule/static/games/snake.js'),
        ('static/games/tetris.js', '/var/www/college-schedule/static/games/tetris.js'),
        ('static/games/minesweeper.js', '/var/www/college-schedule/static/games/minesweeper.js'),
        ('static/games/2048.js', '/var/www/college-schedule/static/games/2048.js'),
        ('static/games/dino.js', '/var/www/college-schedule/static/games/dino.js'),
        ('static/games/sudoku.js', '/var/www/college-schedule/static/games/sudoku.js'),
        ('static/games/assets/dino/100-offline-sprite.png', '/var/www/college-schedule/static/games/assets/dino/100-offline-sprite.png'),
        ('static/games/assets/dino/200-offline-sprite.png', '/var/www/college-schedule/static/games/assets/dino/200-offline-sprite.png'),
    ]

    client.exec_command('mkdir -p /var/www/college-schedule/static/games/assets/dino')

    for local, remote in files:
        if os.path.exists(local):
            print(f"Uploading {local} ({os.path.getsize(local)} bytes) -> {remote}...", flush=True)
            sftp.put(local, remote)
            print(f"OK: {remote}", flush=True)

    sftp.close()

    print("Restarting services & reloading nginx...", flush=True)
    cmd = 'systemctl restart college-web && systemctl restart college-bot && nginx -s reload && echo "DONE"'
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='ignore')
    err = stderr.read().decode('utf-8', errors='ignore')
    print("OUT:", out)
    if err: print("ERR:", err)

    client.close()
    sock.close()
    print("Deploy completed!")

if __name__ == '__main__':
    deploy()
