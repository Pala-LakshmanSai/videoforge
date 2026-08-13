# syntax=docker/dockerfile:1.7
FROM python@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2 AS whisper-builder

ARG WHISPER_CPP_VERSION=1.8.4
ARG WHISPER_CPP_SOURCE_SHA256=b26f30e52c095ccb75da40b168437736605eb280de57381887bf9e2b65f31e66
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates cmake curl g++ make \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${WHISPER_CPP_VERSION}.tar.gz" \
      --output /tmp/whisper.cpp.tar.gz \
    && echo "${WHISPER_CPP_SOURCE_SHA256}  /tmp/whisper.cpp.tar.gz" | sha256sum --check --strict \
    && mkdir /src \
    && tar --extract --gzip --file /tmp/whisper.cpp.tar.gz --directory /src --strip-components=1 \
    && cmake -S /src -B /src/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DGGML_NATIVE=OFF \
      -DGGML_OPENMP=OFF \
      -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16 \
      -DGGML_AVX2=ON \
      -DGGML_F16C=ON \
      -DGGML_FMA=ON \
      -DWHISPER_BUILD_EXAMPLES=ON \
      -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_BUILD_SERVER=OFF \
    && cmake --build /src/build --config Release --target whisper-cli --parallel 4

FROM mwader/static-ffmpeg@sha256:735f84b905e00d5c618b667f0b053f83b1096f5fc404c607e6134bf2275a0e0a AS ffmpeg-static

FROM python@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2

RUN python -m pip install --no-cache-dir \
      annotated-types==0.8.0 \
      attrs==26.1.0 \
      jsonschema==4.25.1 \
      jsonschema-specifications==2025.9.1 \
      pydantic==2.11.7 \
      pydantic-core==2.33.2 \
      referencing==0.37.0 \
      rpds-py==2026.6.3 \
      typing-extensions==4.16.0 \
      typing-inspection==0.4.2
COPY --from=whisper-builder /src/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=ffmpeg-static /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-static /ffprobe /usr/local/bin/ffprobe
COPY packages/contracts/python /opt/videoforge/packages/contracts/python
COPY workers/image-media/src /opt/videoforge/workers/image-media/src
COPY workers/media-local/src /opt/videoforge/workers/media-local/src

ENV LANG=C \
    LC_ALL=C \
    PYTHONHASHSEED=0 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/videoforge/packages/contracts/python:/opt/videoforge/workers/image-media/src:/opt/videoforge/workers/media-local/src

LABEL org.opencontainers.image.title="VideoForge media-local" \
      org.opencontainers.image.version="cp-03-whisper.cpp-1.8.4-ffmpeg-8.1.1" \
      videoforge.whisper_cpp_source_sha256="b26f30e52c095ccb75da40b168437736605eb280de57381887bf9e2b65f31e66" \
      videoforge.model_in_image="false"

WORKDIR /work
USER 65532:65532
ENTRYPOINT ["python", "-m", "videoforge_media_local.cli"]
