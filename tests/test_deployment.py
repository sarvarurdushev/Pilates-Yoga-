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


def test_local_start_never_downloads(monkeypatch):
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setattr(deployment.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(AssertionError("unexpected download")))
    deployment.prepare_render()
