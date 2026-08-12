FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

ARG ECHOMIMIC_SOURCE_REVISION=7e89489ca51c0d008fc1963ec6c03fc5bd0b9397
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git clone --filter=blob:none https://github.com/antgroup/echomimic_v3.git /opt/echomimic_v3 \
    && git -C /opt/echomimic_v3 checkout --detach "$ECHOMIMIC_SOURCE_REVISION" \
    && test "$(git -C /opt/echomimic_v3 rev-parse HEAD)" = "$ECHOMIMIC_SOURCE_REVISION" \
    && rm -rf /opt/echomimic_v3/.git

COPY requirements.runtime.txt /opt/videoforge/requirements.runtime.txt
RUN pip install --no-cache-dir -r /opt/videoforge/requirements.runtime.txt
COPY src /opt/videoforge/src
COPY handler.py bootstrap_models.py infer_flash_fp8.py pod_runner.py entrypoint.sh /opt/videoforge/
RUN chmod 0555 /opt/videoforge/entrypoint.sh

ENV ECHOMIMIC_ROOT=/opt/echomimic_v3 \
    ECHOMIMIC_MODEL_ROOT=/models \
    HF_HOME=/models/.cache \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PYTHONPATH=/opt/videoforge/src:/opt/echomimic_v3 \
    PYTHONUNBUFFERED=1
WORKDIR /opt/echomimic_v3
ENTRYPOINT ["/opt/videoforge/entrypoint.sh"]
