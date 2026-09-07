"""Every file the browser loads has to parse.

This exists because the same mistake was made three times in a fortnight, and
each time it was found by a person clicking on the page rather than by anything
here.

The mistake: a JavaScript module holds its stylesheet in a template literal --
``const CSS = `...`;`` -- and a comment written inside that literal quotes a CSS
selector in backticks, the way a comment anywhere else in the file would. The
backtick closes the literal. Everything after it is parsed as code, the module
throws on load, and the feature is simply absent from the page with nothing in
the interface to say why.

``node --check`` catches it in a tenth of a second. Nothing else in the suite
does, because none of it loads the browser half at all.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

WEB = Path(__file__).resolve().parent.parent / "web" / "src"
NODE = shutil.which("node")

SOURCES = sorted(p for p in WEB.rglob("*.js") if "node_modules" not in p.parts)


def test_there_are_sources_to_check():
    """A glob that quietly matches nothing is a test that quietly passes."""
    assert len(SOURCES) > 10


@pytest.mark.skipif(NODE is None, reason="node is not installed here")
@pytest.mark.parametrize("source", SOURCES, ids=lambda p: p.name)
def test_it_parses(source: Path):
    done = subprocess.run([NODE, "--check", str(source)],
                          capture_output=True, text=True)
    assert done.returncode == 0, (
        f"{source.relative_to(WEB.parent.parent)} does not parse:\n"
        f"{done.stderr.strip()}")


@pytest.mark.parametrize("source", SOURCES, ids=lambda p: p.name)
def test_no_backticks_inside_a_css_literal(source: Path):
    """The specific shape of the bug, caught even where node is missing.

    Scanned rather than parsed: find ``const CSS = `` and look for a backtick on
    a line that is inside a comment before the literal's own closing backtick.
    Crude, and it only has to recognise one mistake.
    """
    lines = source.read_text(encoding="utf-8").splitlines()
    inside = comment = False
    for number, line in enumerate(lines, 1):
        if not inside:
            if "= `" in line and "CSS" in line:
                inside = True
            continue
        if "*/" in line:
            comment = False
            continue
        if "/*" in line:
            comment = True
        if comment and "`" in line:
            pytest.fail(f"{source.name}:{number} has a backtick in a comment "
                        f"inside the CSS literal, which closes it early:\n"
                        f"  {line.strip()}")
        if not comment and line.rstrip().endswith("`;"):
            inside = False
