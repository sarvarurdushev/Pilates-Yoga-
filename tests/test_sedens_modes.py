"""SEDENS deployment modes: explicit, conservative about storage, no paid services."""

import pytest

from pilates.sedens import modes
from sedens_support import Client, running_server


def test_default_is_local_room_off_render():
    mode = modes.resolve({}, db_path="/home/studio/sedens.db")
    assert mode.name == "local_room"
    assert mode.describe()["storage"]["persistent"] is True


def test_render_defaults_to_demo_free():
    mode = modes.resolve({"RENDER": "true"}, db_path="/tmp/studio.db")
    assert mode.name == "demo_free"


def test_a_free_hugging_face_space_is_a_hosted_demonstration():
    """The repository's Space Dockerfile sets neither RENDER nor SEDENS_MODE."""
    for env in ({"SPACE_ID": "someone/sedens"}, {"SYSTEM": "spaces"}):
        mode = modes.resolve(env, db_path="/home/user/data/studio.db")
        assert mode.name == "demo_free" and mode.hosted and mode.host == "huggingface"
        assert mode.describe()["storage"]["persistent"] is False
        assert mode.describe()["features"]["local_camera"] is False
    # A Space with paid persistent storage mounted at /data, run as a room deliberately.
    paid = modes.resolve({"SPACE_ID": "x/y", "SEDENS_MODE": "local_room"}, db_path="/data/studio.db")
    assert paid.describe()["storage"]["persistent"] is True
    assert not modes.resolve({}, db_path="/srv/a.db").hosted


def test_explicit_mode_wins_over_render():
    assert modes.resolve({"RENDER": "true", "SEDENS_MODE": "local_room"}).name == "local_room"


@pytest.mark.parametrize("path", ["/var/data/studio.db", "/home/x/studio.db", ""])
def test_demo_free_never_claims_persistent_storage(path):
    mode = modes.resolve({"SEDENS_MODE": "demo_free"}, db_path=path)
    storage = mode.describe()["storage"]
    assert storage["persistent"] is False
    assert "erased" in storage["reason"]


def test_demo_free_uses_no_paid_services_and_allows_precomputed_demo_analysis():
    features = modes.resolve({"SEDENS_MODE": "demo_free"}, db_path="/tmp/x.db", analysis_enabled=True).describe()["features"]
    assert features["paid_services"] is False
    assert features["precomputed_demo_analysis"] is True
    assert features["real_analysis"] == "limited"


def test_local_room_uses_the_real_pipeline_and_local_camera_when_enabled():
    features = modes.resolve({"SEDENS_MODE": "local_room"}, db_path="/srv/a.db", analysis_enabled=True).describe()["features"]
    assert features["real_analysis"] == "available"
    assert features["local_camera"] is True
    assert features["paid_services"] is False


def test_local_room_on_render_without_disk_is_not_persistent():
    mode = modes.resolve({"SEDENS_MODE": "local_room", "RENDER": "true"}, db_path="/tmp/studio.db")
    assert mode.describe()["storage"]["persistent"] is False


def test_local_room_temporary_directory_is_not_persistent():
    assert modes.resolve({}, db_path="/tmp/studio.db").describe()["storage"]["persistent"] is False


def test_cloud_production_refuses_to_start():
    with pytest.raises(modes.ModeError, match="not implemented"):
        modes.resolve({"SEDENS_MODE": "cloud_production"})


def test_unknown_mode_refuses_to_start():
    with pytest.raises(modes.ModeError, match="not a known mode"):
        modes.resolve({"SEDENS_MODE": "production"})


def test_local_room_can_switch_demonstrations_off():
    assert modes.resolve({"SEDENS_DEMO": "0"}).demo_enabled is False
    assert modes.resolve({"SEDENS_MODE": "demo_free", "SEDENS_DEMO": "0"}).demo_enabled is True


def test_server_refuses_cloud_production(monkeypatch, tmp_path):
    from pilates.serve import serve

    monkeypatch.setenv("SEDENS_MODE", "cloud_production")
    with pytest.raises(modes.ModeError):
        serve(None, port=0, db=str(tmp_path / "a.db"))


def test_server_reports_its_mode(monkeypatch, tmp_path):
    monkeypatch.setenv("SEDENS_MODE", "demo_free")
    server, base = running_server(tmp_path / "a.db")
    try:
        status, config = Client(base).call("GET", "/sedens/config")
        assert status == 200
        assert config["mode"]["name"] == "demo_free"
        assert config["mode"]["storage"]["persistent"] is False
        assert config["mode"]["features"]["paid_services"] is False
        assert "does not diagnose" in config["general_fitness_notice"]
    finally:
        server.shutdown()
        server.server_close()


def test_demo_routes_disabled_when_demonstrations_are_off(monkeypatch, tmp_path):
    monkeypatch.setenv("SEDENS_MODE", "local_room")
    monkeypatch.setenv("SEDENS_DEMO", "0")
    server, base = running_server(tmp_path / "a.db")
    try:
        status, body = Client(base).call("POST", "/sedens/demo/room-device", {"key": "a" * 32})
        assert status == 404 and body["code"] == "demo_disabled"
    finally:
        server.shutdown()
        server.server_close()
