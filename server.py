import http.server
import socketserver
import webbrowser
import os

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True


with ThreadedTCPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler) as httpd:
    print(f"QUANTIS ejecutándose en http://127.0.0.1:{PORT}")
    webbrowser.open(f"http://127.0.0.1:{PORT}/Quantis.html")
    httpd.serve_forever()
