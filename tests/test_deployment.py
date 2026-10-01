"""Deployment startup must never advertise unverified model weights."""
import hashlib
import io

from pilates import deployment


def test_render_download_is_verified_and_cached(tmp_path, monkeypatch):
    data = b"test model"
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    monkeypatch.delenv("PILATES_3D_MODEL", raising=False)
    monkeypatch.setattr(deployment, "MODEL_SHA256", hashlib.sha256(data).hexdigest())
    calls = []
    def download(url, timeout):
        calls.append(url)
        return io.BytesIO(data)
    monkeypatch.setattr(deployment.urllib.request, "urlopen", download)
    deployment.prepare_render()
    monkeypatch.delenv("PILATES_3D_MODEL")
    deployment.prepare_render()
    assert len(calls) == 1
    assert (tmp_path / "pose_landmarker_full.task").read_bytes() == data


def test_corrupt_download_leaves_3d_unavailable(tmp_path, monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    monkeypatch.delenv("PILATES_3D_MODEL", raising=False)
    monkeypatch.setattr(deployment.urllib.request, "urlopen", lambda *a, **k: io.BytesIO(b"bad"))
    deployment.prepare_render()
    assert "PILATES_3D_MODEL" not in deployment.os.environ
    assert not (tmp_path / "pose_landmarker_full.task").exists()


def test_interrupted_download_leaves_2d_available(tmp_path, monkeypatch):
    import http.client

    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    monkeypatch.delenv("PILATES_3D_MODEL", raising=False)

    class Interrupted:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, limit):
            raise http.client.IncompleteRead(b"partial")

    monkeypatch.setattr(deployment.urllib.request, "urlopen", lambda *a, **k: Interrupted())
    deployment.prepare_render()
    assert "PILATES_3D_MODEL" not in deployment.os.environ
    assert not (tmp_path / "pose_landmarker_full.task").exists()


def test_local_start_never_downloads(monkeypatch):
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setattr(deployment.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(AssertionError("unexpected download")))
    deployment.prepare_render()


def test_render_start_prepares_3d_before_first_capability_response(tmp_path, monkeypatch):
    """A cold service should advertise verified weights before accepting jobs."""
    import json
    import threading
    import urllib.request

    from pilates.serve import WEB, serve

    data = b"test model"
    original_open = urllib.request.urlopen
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("PILATES_REQUIRE_AUTH", "0")
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))
    monkeypatch.delenv("PILATES_3D_MODEL", raising=False)
    monkeypatch.setattr(deployment, "MODEL_SHA256", hashlib.sha256(data).hexdigest())
    calls = []

    def download(url, timeout):
        calls.append((url, timeout))
        return io.BytesIO(data)

    monkeypatch.setattr(deployment.urllib.request, "urlopen", download)
    server, url = serve(None, root=WEB, port=0, analyse=True)
    # Restore the standard HTTP client for the local read-only capability check.
    monkeypatch.setattr(deployment.urllib.request, "urlopen", original_open)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        endpoint = url.split("/index.html")[0] + "/evidence/capabilities"
        with original_open(endpoint, timeout=10) as response:
            capability = json.load(response)
        assert capability["three_d"] is True
        assert capability["photo"] is True
        assert len(calls) == 1
        assert calls[0] == (deployment.MODEL_URL, 30)
        assert (tmp_path / "cache" / "pose_landmarker_full.task").read_bytes() == data
    finally:
        server.shutdown()
        server.server_close()


def test_render_start_keeps_2d_when_3d_checksum_fails(tmp_path, monkeypatch):
    """An upstream error must not prevent the service or claim 3D is ready."""
    import json
    import threading
    import urllib.request

    from pilates.serve import WEB, serve

    original_open = urllib.request.urlopen
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("PILATES_REQUIRE_AUTH", "0")
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))
    monkeypatch.delenv("PILATES_3D_MODEL", raising=False)
    monkeypatch.setattr(deployment, "MODEL_SHA256", hashlib.sha256(b"expected").hexdigest())
    monkeypatch.setattr(deployment.urllib.request, "urlopen", lambda *a, **k: io.BytesIO(b"bad"))
    server, url = serve(None, root=WEB, port=0, analyse=True)
    monkeypatch.setattr(deployment.urllib.request, "urlopen", original_open)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        endpoint = url.split("/index.html")[0] + "/evidence/capabilities"
        with original_open(endpoint, timeout=10) as response:
            capability = json.load(response)
        assert capability["three_d"] is False
        assert capability["photo"] is True
        assert capability["video"] is True
        assert not (tmp_path / "cache" / "pose_landmarker_full.task").exists()
    finally:
        server.shutdown()
        server.server_close()
