FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime@sha256:c16f4c749e2d9e96878875cdf6cc45cddda1d1a36fddd371dd6f2360f1b6e2a2

ARG SOULX_SOURCE_REVISION=9bc03de06bb0de82cd6bc477804512ae06144bf2
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && git clone --filter=blob:none https://github.com/Soul-AILab/SoulX-FlashHead.git /opt/soulx-flashhead \
    && git -C /opt/soulx-flashhead checkout --detach "$SOULX_SOURCE_REVISION" \
    && test "$(git -C /opt/soulx-flashhead rev-parse HEAD)" = "$SOULX_SOURCE_REVISION" \
    && printf '%s  %s\n' 093180cc7800bfb13c5d9b02da6499b9971a1420dc3dccaefb59f55920e06414 /opt/soulx-flashhead/flash_head/src/pipeline/flash_head_pipeline.py | sha256sum -c - \
    && printf '%s  %s\n' 1617499fef5bab4520fa8cc9350545b160e61e43cd315067f8fe7f6f31bc8ca4 /opt/soulx-flashhead/flash_head/src/modules/flash_head_model.py | sha256sum -c - \
    && printf '%s  %s\n' 7071d15350f30eed21a363c624e36c646ae8f7ec81303b83575dcf63bfbc49eb /opt/soulx-flashhead/flash_head/wan/modules/vae.py | sha256sum -c -

COPY requirements.runtime.txt /opt/videoforge/requirements.runtime.txt
RUN pip install --no-cache-dir -r /opt/videoforge/requirements.runtime.txt

ARG FLASH_ATTN_WHEEL=flash_attn-2.8.0.post2+cu12torch2.7cxx11abiFALSE-cp311-cp311-linux_x86_64.whl
ARG FLASH_ATTN_SHA256=1452f2b727379ba753ba0d96c617e4cf5c4a1ea1a5147de5e1032ffa3a97a1e3
RUN curl -fL --retry 3 "https://github.com/Dao-AILab/flash-attention/releases/download/v2.8.0.post2/${FLASH_ATTN_WHEEL}" -o "/tmp/${FLASH_ATTN_WHEEL}" \
    && printf '%s  %s\n' "$FLASH_ATTN_SHA256" "/tmp/${FLASH_ATTN_WHEEL}" | sha256sum -c - \
    && pip install --no-cache-dir --no-deps "/tmp/${FLASH_ATTN_WHEEL}" \
    && rm "/tmp/${FLASH_ATTN_WHEEL}"

COPY soulx-single-gpu.patch /tmp/soulx-single-gpu.patch
RUN git -C /opt/soulx-flashhead apply --check /tmp/soulx-single-gpu.patch \
    && git -C /opt/soulx-flashhead apply /tmp/soulx-single-gpu.patch \
    && rm /tmp/soulx-single-gpu.patch \
    && rm -rf /opt/soulx-flashhead/.git

COPY soulx_api.py soulx-entrypoint.py soulx_prepare_service.py soulx_runtime.py soulx_volume.py prepare_soulx_volume.py /opt/videoforge/

ENV SOULX_MODEL_ROOT=/runpod-volume/soulx-flashhead-pro \
    SOULX_SCRATCH_ROOT=/run/videoforge/soulx-scratch \
    HF_HOME=/tmp/hf-cache \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    DIFFUSERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PYTHONPATH=/opt/videoforge:/opt/soulx-flashhead \
    PYTHONUNBUFFERED=1
WORKDIR /opt/soulx-flashhead
ENTRYPOINT ["python", "-u", "/opt/videoforge/soulx-entrypoint.py"]
