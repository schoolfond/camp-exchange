import socks
import socket
import requests

# НАСТРОЙТЕ ПАРАМЕТРЫ
PROXY_HOST = "127.0.0.1"
PROXY_PORT = 10808  # Замените на ваш порт из Happ

def test_socks5():
    """Проверка SOCKS5 прокси через PySocks"""
    try:
        sock = socks.socksocket()
        sock.set_proxy(socks.SOCKS5, PROXY_HOST, PROXY_PORT)
        sock.settimeout(5)
        sock.connect(("api.telegram.org", 443))
        print(f"✅ SOCKS5 прокси {PROXY_HOST}:{PROXY_PORT} - работает!")
        sock.close()
        return True
    except Exception as e:
        print(f"❌ SOCKS5 прокси не работает: {e}")
        return False

def test_http_proxy():
    """Проверка через HTTP прокси (альтернативный порт)"""
    http_port = 10809  # HTTP порт из Happ
    proxies = {
        'http': f'http://{PROXY_HOST}:{http_port}',
        'https': f'http://{PROXY_HOST}:{http_port}'
    }
    try:
        r = requests.get('https://api.telegram.org', proxies=proxies, timeout=10)
        if r.status_code == 200:
            print(f"✅ HTTP прокси {PROXY_HOST}:{http_port} - работает!")
            return True
    except Exception as e:
        print(f"❌ HTTP прокси не работает: {e}")
    return False

if __name__ == "__main__":
    print("=== Проверка прокси Happ ===\n")
    print(f"Проверяем SOCKS5 порт {PROXY_PORT}...")
    test_socks5()
    print("\nПроверяем HTTP порт 10809...")
    test_http_proxy()