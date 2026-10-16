"""Serve a Flutter Web build with the same route fallback as Hosting."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from provenance import validate_build


class FlutterHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        requested = Path(self.translate_path(self.path))
        if not requested.exists() and not requested.suffix:
            self.path = "/index.html"
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["live", "sample"], required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    directory = Path(__file__).resolve().parents[1] / "build" / f"web-e2e-{args.mode}"
    if not (directory / "index.html").is_file():
        parser.error(f"Build the {args.mode} Web application first.")
    try:
        validate_build(directory, args.mode)
    except ValueError as error:
        parser.error(str(error))
    handler = partial(FlutterHandler, directory=str(directory))
    ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()
