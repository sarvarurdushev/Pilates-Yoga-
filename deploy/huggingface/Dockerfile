# A free deployment that can actually measure a clip.
#
# Hugging Face Spaces gives 2 vCPU and 16 GB of RAM on its free CPU tier, with
# no card and no trial clock. That matters here for one reason: analysis costs
# about 25 CPU-seconds per second of video, so two cores turn a twenty-second
# clip into about four minutes. The same clip on the smallest free tier
# elsewhere -- a tenth of a core -- is an hour and a half.
#
# How to use this file:
#
#   1. huggingface.co -> New -> Space
#   2. SDK: Docker, template: Blank. Hardware: CPU basic (free).
#   3. In the Space's Files tab: Add file -> Create a new file, name it
#      `Dockerfile`, paste this whole file in, commit.
#   4. Watch it build. When it says Running, open it and press Record.
#
# Nothing else is copied into the Space -- the build clones this repository, so
# the Space stays two files and there is one copy of the code.
#
# **The Space's disk does not survive a rebuild.** The studio record lives in
# /home/user/data and is lost when the Space restarts or you edit the
# Dockerfile. Persistent storage on Spaces is a paid add-on. Until then treat a
# hosted deployment as somewhere to show the thing, and keep the real record on
# the studio's own machine, where the video never leaves the building either.
FROM python:3.11-slim

# libgomp is what onnxruntime threads on; libglib is what the OpenCV wheel
# links against even in its headless build. git is for the clone below.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Spaces runs the container as uid 1000, and anything owned by root is
# unwritable at runtime -- including the model cache, which is fetched on first
# use rather than baked in.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    XDG_CACHE_HOME=/home/user/.cache
WORKDIR /home/user/app

ARG REPO=https://github.com/sarvarurdushev/Pilates-Yoga-.git
ARG BRANCH=claude/multi-person-pilates-analysis-w28tt0
RUN git clone --depth 1 --branch $BRANCH $REPO .

RUN pip install --no-cache-dir --user -r requirements.txt

# The pose model, fetched at build time rather than during somebody's first
# recording. Ninety megabytes over a slow link is a bad first impression, and
# the layer is cached, so it costs one download per rebuild instead of one per
# restart.
RUN python -c "from pilates.pose import RTMOBackend; RTMOBackend(size='m')"

# Spaces publishes port 7860.
ENV PORT=7860
EXPOSE 7860
RUN mkdir -p /home/user/data
CMD ["python", "-m", "pilates", "web", "--host", "0.0.0.0", \
     "--db", "/home/user/data/studio.db"]
