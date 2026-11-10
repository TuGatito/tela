import http.server, socketserver, time, os
os.chdir(os.path.dirname(os.path.abspath(__file__)) + '/../../examples/abort/build')
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/slow'):
            time.sleep(0.8)
            body = b'slow-body'
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()
    def log_message(self, *a):
        pass
with socketserver.TCPServer(('127.0.0.1', 8784), H) as s:
    s.serve_forever()
