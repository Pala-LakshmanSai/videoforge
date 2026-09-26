"""Provider-free transfer benchmark with synthetic bodies and simulated response latency.

Run with the candidate media-local/image-media source directories on PYTHONPATH.
This is an isolated latency fixture, not a production/network speed measurement.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import statistics
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

from videoforge_media_local import personal_execution as worker
from videoforge_media_local.cloud_job import _local_path


def sample(mode: str, count: int, delay: float, payload_size: int) -> dict[str, object]:
    payloads = {
        f"https://fixture.invalid/{index}": bytes([index % 256]) * payload_size
        for index in range(count)
    }
    objects = []
    for url, payload in payloads.items():
        digest = hashlib.sha256(payload).hexdigest()
        objects.append(
            {
                "uri": f"vf-local://objects/sha256/{digest[:2]}/{digest}.png",
                "url": url,
                "sha256": f"sha256:{digest}",
                "bytes": len(payload),
            }
        )
    lock = threading.Lock()
    active = peak = requests = received = 0

    class Response(io.BytesIO):
        def read(self, maximum: int = -1) -> bytes:
            nonlocal received
            body = super().read(maximum)
            with lock:
                received += len(body)
            return body

        def __exit__(self, *args: object) -> bool | None:
            nonlocal active
            with lock:
                active -= 1
            return super().__exit__(*args)

    def urlopen(url: str, **_kwargs: object) -> Response:
        nonlocal active, peak, requests
        with lock:
            active += 1
            peak = max(peak, active)
            requests += 1
        time.sleep(delay)
        return Response(payloads[url])

    with tempfile.TemporaryDirectory(prefix="videoforge-transfer-benchmark-") as root:
        scratch = Path(root)
        started = time.perf_counter()
        cpu_started = time.process_time()
        with patch.object(worker.urllib.request, "urlopen", side_effect=urlopen):
            if mode == "serial":
                for item in objects:
                    worker._download(item, _local_path(scratch, item["uri"]), lambda: False)
            else:
                worker._download_render_inputs(tuple(objects), scratch, lambda: False)
        wall = time.perf_counter() - started
        cpu = time.process_time() - cpu_started
        verified = all(
            _local_path(scratch, item["uri"]).read_bytes() == payloads[item["url"]]
            for item in objects
        )
    assert verified and requests == count and received == count * payload_size and active == 0
    return {
        "mode": mode,
        "wall_seconds": wall,
        "process_cpu_seconds": cpu,
        "requests": requests,
        "received_bytes": received,
        "max_concurrent_streams": peak,
        "all_bytes_verified": verified,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    samples = [
        sample(mode, 12, 0.1, 256 * 1024)
        for _ in range(3)
        for mode in ("serial", "bounded_parallel")
    ]
    serial = statistics.median(s["wall_seconds"] for s in samples if s["mode"] == "serial")
    parallel = statistics.median(
        s["wall_seconds"] for s in samples if s["mode"] == "bounded_parallel"
    )
    result = {
        "schema_version": "videoforge-worker-transfer-speed-evidence/v1",
        "baseline_source": "f5e64f7c (serial execution path)",
        "worker_source": worker.__file__,
        "scope": "synthetic bodies; mocked HTTPS response opener; real file writes and SHA256",
        "network_or_provider_calls": 0,
        "fixture": {
            "objects": 12,
            "object_bytes": 256 * 1024,
            "simulated_header_latency_seconds": 0.1,
            "paired_repeats": 3,
        },
        "samples": samples,
        "serial_median_seconds": serial,
        "parallel_median_seconds": parallel,
        "fixture_download_time_reduction_percent": 100 * (1 - parallel / serial),
        "limitations": [
            "Not actual HTTPS, actual production assets, or an end-to-end production benchmark.",
            "Does not measure energy, real bandwidth, server limits, or installed-platform parity.",
            "Same successful GET count/bytes; two-attempt per-object retry bound retained.",
            "Ambiguous PUT recovery omitted: this worker has no safe reconciliation read endpoint.",
            "INFO phase timings need configured local logging to be retained.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                key: result[key]
                for key in (
                    "serial_median_seconds",
                    "parallel_median_seconds",
                    "fixture_download_time_reduction_percent",
                )
            }
        )
    )


if __name__ == "__main__":
    main()
