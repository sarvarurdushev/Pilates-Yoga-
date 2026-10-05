#!/usr/bin/env python3
"""Verify a specific deployment and linked workflows in one disposable demo org.

Public checks run by default. --exercise-demo explicitly creates/changes demo
records. Real captures are optional --photo/--video paths; neither inference nor
synthetic seed data is silently substituted for a requested capture. Cookies and
the demo access key are never written to the result file.
"""

import argparse
from datetime import datetime, timezone
import hashlib
from http.cookiejar import CookieJar
import json
import mimetypes
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import build_opener, HTTPCookieProcessor, Request
import uuid


class API:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))

    def request(self, path, *, body=None, content_type=None, expected=200, raw=False):
        headers = {}
        if urlparse(self.base).scheme == "http" and urlparse(self.base).hostname in ("localhost", "127.0.0.1"):
            # urllib does not implement browsers' trusted-localhost exception
            # for Secure cookies. Plain local validation uses explicit HTTP;
            # hosted HTTPS keeps the normal Secure cookie and CookieJar rules.
            headers["X-Forwarded-Proto"] = "http"
        data = None
        if body is not None:
            headers["X-Platform-Request"] = "1"
            headers["Origin"] = self.base
            headers["Content-Type"] = content_type or "application/json"
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
        request = Request(self.base + path, data=data, headers=headers)
        try:
            response = self.opener.open(request, timeout=180)
        except HTTPError as error:
            response = error
        with response:
            status = response.status
            payload = response.read()
        if status != expected:
            # Unexpected successful profiles may embed the demo access key in
            # their organization/user IDs. Keep only an explicit API error.
            try:
                reason = json.loads(payload).get("error", "Response body omitted")
            except (ValueError, AttributeError):
                reason = "Non-JSON response body omitted"
            raise AssertionError(f"{path.split('?')[0]} returned {status}, expected {expected}: {reason}")
        return payload if raw else json.loads(payload)

    def get(self, action, **query):
        return self.request("/platform/" + action + ("?" + urlencode(query) if query else ""))

    def post(self, action, body):
        return self.request("/platform/" + action, body=body)

    def upload(self, path, student_id, kind="capture"):
        path = Path(path)
        content = path.read_bytes()
        mime = "application/dicom" if path.suffix.lower() == ".dcm" else mimetypes.guess_type(path)[0]
        medium = self.request("/platform/upload?" + urlencode({
            "filename": path.name, "student_id": student_id, "kind": kind,
        }), body=content, content_type=mime)
        original = self.request("/platform/media?" + urlencode({"id": medium["id"]}), raw=True)
        assert hashlib.sha256(original).digest() == hashlib.sha256(content).digest(), "Original upload changed on reload"
        return medium


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def deployment(api, expected):
    capabilities = api.request("/evidence/capabilities")
    commit = capabilities.get("deployment", {}).get("commit")
    if expected:
        check(commit == expected, f"Live commit {commit!r} does not match expected {expected!r}")
    return capabilities


def analyse(api, args, student_id, path, kind, result):
    medium = api.upload(path, student_id)
    body = {"student_id": student_id, "kind": kind, "include_3d": True,
            "captures": [{"media_id": medium["id"], "view": "front"}]}
    body.update({"mode": "standing", "protocol": "Standing posture"} if kind == "posture" else {"protocol": "Standing balance"})
    started = time.monotonic()
    job = api.post("analyse", body)
    evidence = {"kind": kind, "fixture": Path(path).name, "job_id": job["id"],
                "fixture_sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                "input_provenance": args.photo_source if kind == "posture" else "movement_video_fixture",
                "media_id": medium["id"], "health": [], "original_bytes_verified": True}
    result["jobs"].append(evidence)
    while job["state"] in ("queued", "running"):
        check(time.monotonic() - started < args.job_timeout, "Analysis exceeded the verification deadline")
        time.sleep(3)
        before = time.monotonic()
        api.request("/capabilities")
        evidence["health"].append(round(time.monotonic() - before, 3))
        job = api.get("record", collection="jobs", id=job["id"])
        print(f"{kind}: {job['state']} · {job.get('progress', '')}", flush=True)
    evidence.update(state=job["state"], seconds=round(time.monotonic() - started, 2), error=job.get("error"))
    check(job["state"] == "done", f"Actual {kind} inference failed: {job.get('error')}")
    analysis = api.get("record", collection="analyses", id=job["analysis_id"])
    check(analysis["student_id"] == student_id and not analysis["demo"], "Capture output is not a real analysis for the selected client")
    check(analysis["detail"].get("source") == "Computed from uploaded media", "Analysis source is not the uploaded capture")
    view = analysis["result"]["views"][0]
    check(view["media_id"] == medium["id"], "Report does not link the original upload")
    people = view["report"].get("people", [])
    person = next((p for p in people if p.get("suitable")), None)
    check(person is not None, "No suitable person in the actual capture; inference completion alone is not acceptance")
    selection = {view["view"]: str(person["person_id"])}
    api.post("review", {"analysis_id": analysis["id"], "selection": selection})
    reopened = api.get("record", collection="analyses", id=analysis["id"])
    check(reopened["detail"].get("selected_people") == selection, "Reviewed selection did not persist")
    coordinates = api.get("coordinates", analysis_id=analysis["id"], person_id=str(person["person_id"]))
    check(coordinates and all(str(row["person_id"]) == str(person["person_id"]) for row in coordinates), "Coordinate selection is disconnected")
    client = api.get("client", id=student_id)
    visit = next((s for s in client["sessions"] if analysis["id"] in s.get("analysis_ids", [])), None)
    progress = [p for p in client["progress"] if p["analysis_id"] == analysis["id"]]
    check(visit is not None, "Saved analysis has no exact client visit")
    check(progress and all(not p["demo"] for p in progress), "Reviewed actual capture did not publish measured progress")
    check(all(p["evidence"].get("supported") is True for p in progress), "Published progress does not match supported archived evidence")
    check(all(str(p["evidence"].get("person_id")) == str(person["person_id"]) for p in progress), "Progress includes another detected person's measurements")
    frames = person.get("frames", [])
    evidence.update(analysis_id=analysis["id"], session_id=visit["id"], selection=selection,
                    coordinate_rows=len(coordinates), measured_progress_rows=len(progress),
                    frames=len(frames), accepted_frames=sum(f.get("suitable") is True for f in frames),
                    available_signals=sum(s.get("status") in ("available", "measured", "estimated") for s in person.get("signals", {}).values()),
                    detected_cycles=sum(len(s.get("cycles", [])) for s in person.get("signals", {}).values()),
                    people=[{"person_id": str(p["person_id"]), "suitable": bool(p.get("suitable"))} for p in people],
                    depth_status=(person.get("pose3d") or {}).get("status"),
                    estimated_depth_frames=sum((f.get("pose3d") or {}).get("status") == "estimated" for f in frames))
    return analysis, visit


def linked_records(api, args, student_id, analysis, visit, result):
    scan_path = args.scan
    # A real image is valid as an explicitly labelled calibration attachment if
    # no DICOM fixture is supplied. It is never labelled a patient radiograph.
    check(scan_path is not None, "--exercise-demo requires --scan with an explicit calibration/test fixture")
    medium = api.upload(scan_path, student_id, "scan")
    scan = api.post("save", {"collection": "scans", "item": {
        "student_id": student_id, "analysis_id": analysis["id"], "session_id": visit["id"],
        "region_id": "right_shoulder", "media_id": medium["id"],
        "name": "Deployment verification calibration attachment (not a patient scan)",
        "scan_type": "Calibration/test fixture", "captured_at": datetime.now(timezone.utc).date().isoformat(), "detail": {"calibration": True},
    }})
    frame = min(1, medium.get("detail", {}).get("frames", 1) - 1)
    if medium["mime"] == "application/dicom":
        rendered = api.request("/platform/dicom?" + urlencode({"id": medium["id"], "frame": frame, "center": 2048, "width": 1024}), raw=True)
        check(rendered.startswith(b"\x89PNG"), "DICOM window/frame request did not render PNG")
    annotation = api.post("annotate", {"scan_id": scan["id"], "region_id": "right_shoulder",
        "x": 0.4, "y": 0.5, "frame_index": frame,
        "text": "Calibration marker verifies persistence and visit/region links; no clinical interpretation."})
    saved_scan = api.get("record", collection="scans", id=scan["id"])
    finding = next((row for row in saved_scan.get("findings", []) if row["id"] == annotation["id"]), None)
    check(finding and finding["frame_index"] == frame and finding["session_id"] == visit["id"], "Scan marker lost its frame or exact visit")
    note = api.post("save", {"collection": "notes", "item": {
        "student_id": student_id, "analysis_id": analysis["id"], "session_id": visit["id"],
        "scan_id": scan["id"], "region_id": "right_shoulder", "visibility": "student",
        "text": "Deployment verification feedback linked to this exact visit and calibration attachment.",
    }})
    check(api.get("record", collection="notes", id=note["id"])["session_id"] == visit["id"], "Feedback exact visit did not persist")
    exercise = api.post("save", {"collection": "exercises", "item": {
        "name": "Deployment verification comfortable movement", "category": "Mobility",
        "region_id": "right_shoulder", "visibility": "private",
        "detail": {"program_only": True, "target_region_ids": ["right_shoulder"]},
    }})
    steps = [{"exercise_id": exercise["id"], "sets": 1, "reps": 5, "seconds": 30, "rest": 10,
              "phase": "Foundation", "detail": {"section": "MOBILITY", "student_instructions": "Stay within a comfortable range.", "coach_instructions": "PRIVATE_VERIFICATION_CUE"}},
             {"type": "note", "text": "Pause comfortably", "phase": "Foundation", "section": "MOBILITY", "visibility": "student"},
             {"type": "note", "text": "PRIVATE_VERIFICATION_NOTE", "phase": "Foundation", "section": "MOBILITY", "visibility": "coach"}]
    program = api.post("save", {"collection": "programs", "item": {
        "name": "Deployment verification client plan", "goal": "Verify source and save/reload",
        "region_id": "right_shoulder", "detail": {"student_id": student_id,
        "source_analysis_id": analysis["id"], "coach_notes": "PRIVATE_VERIFICATION_PLAN", "status": "Draft"},
        "steps": steps, "change_source": {"kind": "analysis", "id": analysis["id"]},
        "change_visit_id": visit["id"], "change_reason": "Deployment acceptance exercise",
    }})
    reopened = api.get("record", collection="programs", id=program["id"])
    check([s["position"] for s in reopened["steps"]] == [0, 1, 2], "Mixed exercise/note sequence order changed on reload")
    check(reopened["detail"]["source_student_id"] == student_id, "Program source client relation is disconnected")
    versions = api.get("program/versions", id=program["id"])
    check(versions["items"][0]["session_id"] == visit["id"], "Program version lost its exact source visit")
    api.post("assign", {"program_id": program["id"], "student_id": student_id, "analysis_id": analysis["id"], "replace": False})
    result["linked_records"] = {"scan_id": scan["id"], "annotation_id": annotation["id"], "frame": frame,
        "note_id": note["id"], "exercise_id": exercise["id"], "program_id": program["id"], "program_version": program["version"], "session_id": visit["id"]}
    result["linked_records"]["calibration_fixture_sha256"] = hashlib.sha256(Path(scan_path).read_bytes()).hexdigest()
    return program


def run(args, result):
    api = API(args.base)
    result["capabilities"] = deployment(api, args.expected_commit)
    for path in ("/", "/anatomy.html"):
        check(b"<html" in api.request(path, raw=True).lower(), f"{path} did not serve an HTML application")
    if not args.exercise_demo:
        return
    key = os.environ.get("MOTION_DEMO_KEY") or uuid.uuid4().hex
    check(re.fullmatch(r"[a-f0-9]{32}", key), "MOTION_DEMO_KEY must be 32 lowercase hex characters")
    admin = api.post("auth/demo", {"key": key, "role": "admin"})
    check(admin["role"] == "admin", "Admin login selected another role")
    inspection = api.get("inspect")
    coach = api.post("auth/demo", {"key": key, "role": "coach"})
    check(coach["role"] == "coach" and coach["students"], "Coach has no assigned clients")
    check(coach["organization"]["id"] == admin["organization"]["id"], "Role switch created a separate organization")
    student = next((p for p in coach["students"] if p["name"] == "Sarah Kim"), coach["students"][0])
    student_id = student["id"]
    check(set(p["id"] for p in coach["students"]).issubset({p["id"] for p in admin["students"]}), "Coach client scope escaped the organization")
    foreign = next((p for p in admin["students"] if p["id"] not in {p["id"] for p in coach["students"]}), None)
    if foreign:
        api.request("/platform/client?" + urlencode({"id": foreign["id"]}), expected=403)
    api.request("/platform/inspect", expected=403)
    if args.photo or args.video:
        # Inference fixtures belong to a generic validation profile, without
        # assigning their actual measured output to a fictional seed person.
        created = api.post("people/save", {"name": "Hosted workflow validation client",
            "roles": ["student"], "goal": "Disposable deployment verification fixtures"})
        student_id = created["id"]
        result["validation_client_id"] = student_id
    client = api.get("client", id=student_id)
    result["roles"] = {"organization_fingerprint": hashlib.sha256(admin["organization"]["id"].encode()).hexdigest()[:16], "admin_clients": len(admin["students"]),
        "coach_clients": len(coach["students"]), "student_fingerprint": hashlib.sha256(student_id.encode()).hexdigest()[:16], "schema_version": inspection["schema_version"],
        "coach_foreign_client_refused": foreign is not None}
    actual = []
    for path, kind in ((args.photo, "posture"), (args.video, "movement")):
        if path:
            actual.append(analyse(api, args, student_id, path, kind, result))
    if actual:
        source, visit = actual[-1]
    else:
        # Record-link acceptance can run without models locally, but it is
        # explicitly recorded as seeded, never as actual inference success.
        source = api.get("record", collection="analyses", id=client["analyses"][0]["id"])
        visit = next(s for s in client["sessions"] if source["id"] in s.get("analysis_ids", []))
    result["record_source"] = "actual_capture" if actual else "seeded_demo"
    program = linked_records(api, args, student_id, source, visit, result)
    profile = api.post("auth/demo", {"key": key, "role": "student", "user_id": student_id})
    check(profile["role"] == "student" and [s["id"] for s in profile["students"]] == [student_id], "Student profile exposed another client")
    own = api.get("client", id=student_id)
    check(any(p["program_id"] == program["id"] for p in own["programs"]), "Assigned program missing from student practice")
    projected = api.get("record", collection="programs", id=program["id"])
    check("PRIVATE_VERIFICATION" not in json.dumps(projected), "Student program leaked private coach content")
    check(len(projected["steps"]) == 2, "Student sequence did not project visible exercise/note steps")
    other = next(p for p in admin["students"] if p["id"] != student_id)
    api.request("/platform/client?" + urlencode({"id": other["id"]}), expected=403)
    api.request("/platform/inspect", expected=403)
    api.request("/platform/save", body={"collection": "programs", "item": {"id": program["id"], "name": "Refused student edit"}}, expected=403)
    result["roles"]["student_own_program_and_foreign_client_refusal"] = True
    deployment(api, args.expected_commit)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--expected-commit")
    parser.add_argument("--exercise-demo", action="store_true")
    parser.add_argument("--photo", type=Path)
    parser.add_argument("--photo-source", choices=("generated", "photograph", "unspecified"), default="unspecified")
    parser.add_argument("--video", type=Path)
    parser.add_argument("--scan", type=Path)
    parser.add_argument("--job-timeout", type=int, default=600)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if urlparse(args.base).hostname not in ("localhost", "127.0.0.1") and not args.expected_commit:
        parser.error("Hosted acceptance requires --expected-commit")
    if (args.photo or args.video) and not args.exercise_demo:
        parser.error("Real capture uploads require --exercise-demo")
    if args.exercise_demo and not args.scan:
        parser.error("Record-link verification requires an explicit --scan calibration/test fixture")
    result = {"base": args.base, "expected_commit": args.expected_commit, "started_at": time.time(), "jobs": []}
    try:
        run(args, result)
        result["verified"] = True
        print("Deployment and requested workflows verified", flush=True)
    except Exception as error:
        result.update(verified=False, error=str(error))
        print(f"VERIFICATION FAILED: {error}", file=sys.stderr, flush=True)
    finally:
        result["finished_at"] = time.time()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    return 0 if result.get("verified") else 1


if __name__ == "__main__":
    raise SystemExit(main())
