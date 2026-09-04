# The Neuro Wellness application, vendored

This directory is a copy of [Neuro Wellness](https://github.com/sarvarurdushev/Neuro_Wellness)
at commit `93a6647`, brought in whole so that one repository holds both halves:
the measurement that watches a class, and the body that shows what it found.

## What is upstream and what is ours

Everything here except `src/session/` is upstream, copied verbatim. Our
integration is **additive**: the session layer imports the application's own
exported API (`selectStructure`, `renderStructureInto`, `flyTo`, `palette`,
`registry`) and writes into the DOM the application has already rendered. It
does not fork any upstream file.

The one exception is a single `<script type="module">` line at the end of
`index.html`, which loads the session layer. That is the whole patch. Anything
else that looks like an upstream change is a bug.

Keeping it that way is the point: a fork of eighteen thousand lines that has to
be hand-merged every time the anatomy side fixes something is a fork that stops
being merged after about two months, and then the two halves quietly diverge.

## Running it

    python -m pilates web --bundle anna_s1.json

Serves this directory with a session attached. With no bundle it is exactly the
application upstream ships: the body, the exercise library, the evidence, the
lab. With one, every one of those gains what this person actually did.
