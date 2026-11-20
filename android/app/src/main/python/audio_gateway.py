"""Loopback-only adapter from Android MediaPlayer Range reads to the selected proxy."""

import re
import secrets
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests


class _Track:
    def __init__(self, resolve, session):
        self.resolve = resolve
        self.session = session
        self.lock = threading.Lock()
        self.stream = None
        self.error = None
        self.expiry = 0

    def source(self):
        with self.lock:
            if self.error and time.monotonic() < self.expiry:
                raise RuntimeError(self.error)
            if not self.stream or time.monotonic() >= self.expiry:
                try:
                    self.stream = self.resolve()
                except RuntimeError as error:
                    self.error = str(error)
                    self.expiry = time.monotonic() + 60
                    raise
                self.error = None
                self.expiry = time.monotonic() + 600
            return self.stream


class _Server(ThreadingHTTPServer):
    # Mobile decoders may overlap an old HTTP read with the next one while seeking.
    def __init__(self):
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(("127.0.0.1", 0), _Handler)

    def process_request(self, request, address):
        if self.slots.acquire(blocking=False):
            try:
                super().process_request(request, address)
            except Exception:
                self.slots.release()
                raise
        else:
            self.shutdown_request(request)

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


class _Handler(BaseHTTPRequestHandler):
    timeout = 15

    def log_message(self, fmt, *args):
        pass  # Request paths contain per-playback tokens.

    def do_GET(self):
        self.forward(True)

    def do_HEAD(self):
        self.forward(False)

    def forward(self, send_body):
        with _lock:
            track = _tracks.get(self.path)
        if track is None:
            self.send_error(404)
            return
        byte_range = self.headers.get("Range")
        if byte_range and not re.fullmatch(r"bytes=(?:\d+-\d*|-\d+)", byte_range):
            self.send_error(416)
            return
        started = False
        try:
            stream = track.source()
            headers = dict(stream["headers"], **{"Accept-Encoding": "identity"})
            if byte_range:
                headers["Range"] = byte_range
            with track.session() as session, session.get(stream["url"], headers=headers, stream=True,
                                                         timeout=(7, 15)) as response:
                self.send_response(response.status_code)
                for name in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
                    if name in response.headers:
                        self.send_header(name, response.headers[name])
                self.send_header("Connection", "close")
                self.end_headers()
                started = True
                if send_body:
                    for chunk in response.iter_content(32768):
                        self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # Seek, pause and track changes close active reads.
        except (requests.RequestException, RuntimeError, OSError):
            if not started:
                self.send_error(502)


_lock = threading.Lock()
_tracks = OrderedDict()
_server = None


def register(resolve, session):
    global _server
    path = "/track/" + secrets.token_urlsafe(24)
    with _lock:
        if _server is None:
            _server = _Server()
            threading.Thread(target=_server.serve_forever, name="audio-range", daemon=True).start()
        _tracks[path] = _Track(resolve, session)
        if len(_tracks) > 8:
            _tracks.popitem(last=False)
        return f"http://127.0.0.1:{_server.server_port}{path}"
