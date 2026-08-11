FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

ARG AVATARFORCING_SOURCE_REVISION=63b73e6c0f7bb42180ca6d7e1bf11c1de1a80b39

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --filter=blob:none https://github.com/KlingAIResearch/AvatarForcing.git /opt/avatarforcing \
    && git -C /opt/avatarforcing checkout --detach "$AVATARFORCING_SOURCE_REVISION" \
    && test "$(git -C /opt/avatarforcing rev-parse HEAD)" = "$AVATARFORCING_SOURCE_REVISION" \
    && rm -rf /opt/avatarforcing/.git

COPY requirements.runtime.txt /opt/videoforge/requirements.runtime.txt
RUN pip install --no-cache-dir -r /opt/videoforge/requirements.runtime.txt
ARG FLASH_ATTN_WHEEL_URL=https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.1.post4/flash_attn-2.7.1.post4%2Bcu12torch2.5cxx11abiFALSE-cp311-cp311-linux_x86_64.whl
ARG FLASH_ATTN_WHEEL_SHA256=3352a46b50566fd7908a9467b80c3516808687eb5a783e189ebf1aa79feb17fd
RUN curl --fail --location --retry 3 --output /tmp/flash_attn.whl "$FLASH_ATTN_WHEEL_URL" \
    && echo "$FLASH_ATTN_WHEEL_SHA256  /tmp/flash_attn.whl" | sha256sum --check --strict \
    && pip install --no-cache-dir /tmp/flash_attn.whl \
    && rm /tmp/flash_attn.whl
COPY src /opt/videoforge/src
COPY handler.py bootstrap_models.py entrypoint.sh /opt/videoforge/
RUN chmod 0555 /opt/videoforge/entrypoint.sh

ENV AVATARFORCING_ROOT=/opt/avatarforcing \
    AVATARFORCING_MODEL_ROOT=/models \
    HF_HOME=/models/.cache \
    PYTHONPATH=/opt/videoforge/src:/opt/avatarforcing \
    PYTHONUNBUFFERED=1
WORKDIR /opt/avatarforcing
ENTRYPOINT ["/opt/videoforge/entrypoint.sh"]
