"""Saved capture-source labels are grounded in actual analysis links."""

from io import BytesIO

from PIL import Image

from pilates.platform.media import upload
from pilates.platform.repository import Repository


def test_capture_media_list_exposes_unambiguous_saved_view_and_protocol(tmp_path):
    repo = Repository(tmp_path / "studio.db")
    admin = repo.actor(
        repo.create_org("Owner", "capture-label@example.test", "long-password", "Studio")
    )
    client_id = repo.save_person(admin, {"name": "Client", "roles": ["student"]})["id"]
    other_client = repo.save_person(
        admin, {"name": "Other client", "roles": ["student"]}
    )["id"]
    picture = BytesIO()
    Image.new("RGB", (8, 8), "white").save(picture, format="PNG")
    data = picture.getvalue()
    first, reused, legacy = [
        upload(
            repo, admin, BytesIO(data), len(data), "same.png", "image/png",
            "capture", client_id,
        )
        for _ in range(3)
    ]
    video_data = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 32
    video = upload(
        repo, admin, BytesIO(video_data), len(video_data), "movement.mp4",
        "video/mp4", "capture", client_id,
    )
    with repo.db() as db:
        for aid, student, protocol in (
            ("source-first", client_id, "Neutral standing posture"),
            ("source-reused-a", client_id, "Shoulder assessment"),
            ("source-reused-b", client_id, "Squat assessment"),
            ("foreign-source", other_client, "Other client protocol"),
        ):
            db.execute(
                "INSERT INTO p_analyses"
                "(id,org_id,student_id,kind,protocol,created_at,status)"
                " VALUES (?,?,?,?,?,?,?)",
                (aid, admin.org_id, student, "posture", protocol,
                 "2026-09-30T09:30:00Z", "complete"),
            )
        db.execute(
            "INSERT INTO p_analyses"
            "(id,org_id,student_id,kind,protocol,created_at,status)"
            " VALUES (?,?,?,?,?,?,?)",
            ("source-video", admin.org_id, client_id, "movement",
             "Controlled squat", "2026-09-30T09:31:00Z", "complete"),
        )
        db.execute(
            "INSERT INTO p_video_analyses VALUES (?,?,?,?,?,?)",
            ("video-source-link", "source-video", video["id"], "side_left", 1.0, "{}"),
        )
        for image_id, analysis_id, media_id, view in (
            ("image-first", "source-first", first["id"], "front"),
            ("image-reused-a", "source-reused-a", reused["id"], "rear"),
            ("image-reused-b", "source-reused-b", reused["id"], "rear"),
            # The direct SQL fixture simulates a stale/broken link. It must
            # never leak another client's protocol into this client's options.
            ("image-foreign", "foreign-source", legacy["id"], "side_left"),
        ):
            db.execute(
                "INSERT INTO p_image_analyses VALUES (?,?,?,?,?)",
                (image_id, analysis_id, media_id, view, "{}"),
            )

    rows = {
        media["id"]: media
        for media in repo.list(admin, "media", student_id=client_id)["items"]
    }
    assert rows[first["id"]]["capture_view"] == "front"
    assert rows[first["id"]]["capture_protocol"] == "Neutral standing posture"
    assert rows[reused["id"]]["capture_view"] == "rear"
    assert "capture_protocol" not in rows[reused["id"]]
    assert "capture_view" not in rows[legacy["id"]]
    assert "capture_protocol" not in rows[legacy["id"]]
    assert rows[video["id"]]["capture_view"] == "side_left"
    assert rows[video["id"]]["capture_protocol"] == "Controlled squat"
    assert all(rows[identifier]["filename"] == "same.png"
               for identifier in (first["id"], reused["id"], legacy["id"]))
    assert all("path" not in row for row in rows.values())
