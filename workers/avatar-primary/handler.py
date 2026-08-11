from __future__ import annotations

import runpod

from videoforge_avatar_primary import (
    AvatarPrimaryInlineJob,
    AvatarPrimaryJob,
    run_avatar_primary_inline_job,
    run_avatar_primary_job,
)


def handler(event: dict[str, object]) -> dict[str, object]:
    try:
        value = event.get("input")
        if isinstance(value, dict) and value.get("mode") == "INLINE_QUALIFICATION_V1":
            job = AvatarPrimaryInlineJob.from_value(value)
            return {"ok": True, "result": run_avatar_primary_inline_job(job)}
        job = AvatarPrimaryJob.from_value(value)
        return {"ok": True, "result": run_avatar_primary_job(job)}
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) else "AVATAR_PRIMARY_FAILED"
        return {"ok": False, "error_code": code[:120]}


runpod.serverless.start({"handler": handler})
