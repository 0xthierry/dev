#!/usr/bin/env python3
"""Real proxy process: cached models survive two offline starts, without real accounts.
Usage: python3 tests/cliproxy-catalog-integration.test.py BINARY UPSTREAM_MODELS_JSON
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

binary = str(Path(sys.argv[1]).resolve())
catalog = json.loads(Path(sys.argv[2]).read_text())
model = dict(catalog["claude"][0])
model["id"] = "claude-catalog-cache-regression-test"
catalog["claude"].append(model)

with tempfile.TemporaryDirectory(prefix="cliproxy-catalog-test-") as directory:
    root = Path(directory)
    auth = root / "auth"
    auth.mkdir(mode=0o700)
    (auth / "claude-test.json").write_text(json.dumps({
        "type": "claude", "access_token": "synthetic-not-a-real-token",
        "refresh_token": "", "email": "catalog-test@example.invalid",
        "expired": "2099-01-01T00:00:00Z",
    }))
    cache = root / "models.json"
    cache.write_text(json.dumps(catalog))
    cache.chmod(0o600)
    original_cache = cache.read_bytes()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    config = root / "config.yaml"
    config.write_text(f'''host: "127.0.0.1"
port: {port}
auth-dir: {json.dumps(str(auth))}
api-keys: ["test-local-key"]
remote-management:
  secret-key: ""
  disable-control-panel: true
plugins:
  enabled: false
commercial-mode: true
''')
    env = os.environ.copy()
    env.update({
        "HOME": str(root), "CLIPROXYAPI_MODEL_CACHE": str(cache),
        "HTTP_PROXY": "http://127.0.0.1:1", "HTTPS_PROXY": "http://127.0.0.1:1",
        "ALL_PROXY": "http://127.0.0.1:1", "NO_PROXY": "127.0.0.1,localhost",
    })
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for start in range(2):
        log_path = root / f"start-{start}.log"
        with log_path.open("w") as log:
            process = subprocess.Popen([binary, "-config", str(config)], env=env,
                                       cwd=root, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 25
                found = False
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise AssertionError(log_path.read_text())
                    try:
                        request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/models",
                            headers={"Authorization": "Bearer test-local-key"})
                        with opener.open(request, timeout=1) as response:
                            ids = {item["id"] for item in json.load(response)["data"]}
                        # Upstream opens its listener before loading auth entries.
                        # The first populated response must include cached models;
                        # do not accept an embedded-only intermediate catalog.
                        if ids:
                            assert model["id"] in ids, "First populated model response omitted disk-cached model: " + log_path.read_text()
                            found = True
                            break
                    except OSError:
                        pass
                    time.sleep(0.1)
                assert found, log_path.read_text()
                assert cache.read_bytes() == original_cache, "Failed refresh changed cached data"
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        print(f"ok: offline process start {start + 1} serves cached-only model via /v1/models")
