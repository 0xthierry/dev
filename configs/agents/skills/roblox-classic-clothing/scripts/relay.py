# Localhost-only file relay between this folder and Roblox Studio (HttpService, edit mode).
#   uv run --no-project --with pillow python -I relay.py <dir> [port]
# GET /<path>.rgba serves <dir>/<path>.png as raw RGBA bytes (size in the X-Size header "w,h"), ready for
# EditableImage:WritePixelsBuffer; GET of any other path serves the file as is; POST writes the body to <dir>/<path>.
# Paths stay inside <dir>.
import http.server
import os
import sys

from PIL import Image

ROOT = os.path.realpath(sys.argv[1])
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8767


def resolve(url_path):
    path = os.path.realpath(os.path.join(ROOT, url_path.split("?")[0].lstrip("/")))
    return path if path.startswith(ROOT + os.sep) else None


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        path = resolve(self.path)
        if not path:
            self.send_response(403); self.end_headers(); return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok %d" % len(body))

    def do_GET(self):
        path = resolve(self.path)
        rgba = bool(path) and path.endswith(".rgba")
        if rgba:
            path = path[:-5] + ".png"
        if not path or not os.path.isfile(path):
            self.send_response(404); self.end_headers(); return
        if rgba:
            im = Image.open(path).convert("RGBA")
            body, size = im.tobytes(), "%d,%d" % im.size
        else:
            body, size = open(path, "rb").read(), ""
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("X-Size", size)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


http.server.HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
