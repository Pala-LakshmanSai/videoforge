# syntax=docker/dockerfile:1.7
# Runtime base must be an immutable digest that already contains Python 3.12.13,
# whisper.cpp 1.8.4, FFmpeg 8.1.1, and FFprobe 8.1.1. CP-08 owns selecting and
# publishing that qualified base; CP-03 does not download/build tools or model bytes.
ARG MEDIA_RUNTIME_IMAGE
FROM ${MEDIA_RUNTIME_IMAGE}

COPY packages/contracts/python /opt/videoforge/packages/contracts/python
COPY workers/image-media/src /opt/videoforge/workers/image-media/src
COPY workers/media-local/src /opt/videoforge/workers/media-local/src

ENV LANG=C \
    LC_ALL=C \
    PYTHONHASHSEED=0 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/videoforge/packages/contracts/python:/opt/videoforge/workers/image-media/src:/opt/videoforge/workers/media-local/src

WORKDIR /work
USER 65532:65532
ENTRYPOINT ["python", "-m", "videoforge_media_local.cli"]
