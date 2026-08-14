FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime@sha256:c16f4c749e2d9e96878875cdf6cc45cddda1d1a36fddd371dd6f2360f1b6e2a2

ARG ECHOMIMIC_SOURCE_REVISION=7e89489ca51c0d008fc1963ec6c03fc5bd0b9397
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git clone --filter=blob:none https://github.com/antgroup/echomimic_v3.git /opt/echomimic_v3 \
    && git -C /opt/echomimic_v3 checkout --detach "$ECHOMIMIC_SOURCE_REVISION" \
    && test "$(git -C /opt/echomimic_v3 rev-parse HEAD)" = "$ECHOMIMIC_SOURCE_REVISION" \
    && printf '%s  %s\n' 16db024008d85d3421cfe59988ce6d917e8e29d13cc959cc99fd9c82b6ea99ae /opt/echomimic_v3/infer_flash.py | sha256sum -c - \
    && printf '%s  %s\n' 21fe4409b664385a1c1cc5c23d92506ffb05ef3c374a18de9df67b715dca07e9 /opt/echomimic_v3/config/config.yaml | sha256sum -c - \
    && rm -rf /opt/echomimic_v3/.git

COPY requirements.runtime.txt /opt/videoforge/requirements.runtime.txt
RUN pip install --no-cache-dir -r /opt/videoforge/requirements.runtime.txt
COPY src /opt/videoforge/src
COPY echo_api.py echo_backend.py echo_bootstrap.py echo-entrypoint.py echo_job.py echo_prepare_service.py echo_runtime.py echo_volume.py prepare_echo_volume.py prepare_fp8_artifact.py scratch.py span_contract.py /opt/videoforge/

ENV ECHOMIMIC_ROOT=/opt/echomimic_v3 \
    ECHO_MODEL_ROOT=/runpod-volume/echo-flash-turbo-fp8 \
    ECHO_SCRATCH_ROOT=/run/videoforge/echo-scratch \
    HF_HOME=/tmp/hf-cache \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    DIFFUSERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PYTHONPATH=/opt/videoforge:/opt/videoforge/src:/opt/echomimic_v3 \
    PYTHONUNBUFFERED=1
WORKDIR /opt/echomimic_v3
ENTRYPOINT ["python", "-u", "/opt/videoforge/echo-entrypoint.py"]
