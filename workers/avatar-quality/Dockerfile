FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime

ARG SKYREELS_SOURCE_REVISION=28c771e8456341be6a213e3d1133ed1fd19bf75d

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --filter=blob:none https://github.com/SkyworkAI/SkyReels-V3.git /opt/skyreels-v3 \
    && git -C /opt/skyreels-v3 checkout --detach "$SKYREELS_SOURCE_REVISION" \
    && test "$(git -C /opt/skyreels-v3 rev-parse HEAD)" = "$SKYREELS_SOURCE_REVISION" \
    && rm -rf /opt/skyreels-v3/.git

COPY requirements.runtime.txt /opt/videoforge/requirements.runtime.txt
RUN pip install --no-cache-dir -r /opt/videoforge/requirements.runtime.txt
ARG FLASH_ATTN_WHEEL_URL=https://github.com/Dao-AILab/flash-attention/releases/download/v2.8.3/flash_attn-2.8.3%2Bcu12torch2.8cxx11abiFALSE-cp311-cp311-linux_x86_64.whl
ARG FLASH_ATTN_WHEEL_SHA256=f1a9e6cb4dfbd1647e56235d81fd6b56e6cd01c7ea3249968ca4aa36c389371a
RUN curl --fail --location --retry 3 --output /tmp/flash_attn-2.8.3+cu12torch2.8cxx11abiFALSE-cp311-cp311-linux_x86_64.whl "$FLASH_ATTN_WHEEL_URL" \
    && echo "$FLASH_ATTN_WHEEL_SHA256  /tmp/flash_attn-2.8.3+cu12torch2.8cxx11abiFALSE-cp311-cp311-linux_x86_64.whl" | sha256sum --check --strict \
    && pip install --no-cache-dir /tmp/flash_attn-2.8.3+cu12torch2.8cxx11abiFALSE-cp311-cp311-linux_x86_64.whl \
    && rm /tmp/flash_attn-2.8.3+cu12torch2.8cxx11abiFALSE-cp311-cp311-linux_x86_64.whl
COPY src /opt/videoforge/src
COPY handler.py bootstrap_models.py entrypoint.sh /opt/videoforge/
RUN chmod 0555 /opt/videoforge/entrypoint.sh

ENV SKYREELS_ROOT=/opt/skyreels-v3 \
    SKYREELS_MODEL_ROOT=/models/skyreels-v3-a2v-19b \
    HF_HOME=/models/.cache \
    PYTHONPATH=/opt/videoforge/src:/opt/skyreels-v3 \
    PYTHONUNBUFFERED=1
WORKDIR /opt/skyreels-v3
ENTRYPOINT ["/opt/videoforge/entrypoint.sh"]
