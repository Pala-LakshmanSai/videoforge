"""RunPod queue entrypoint for the V2-08 SoulX Serverless candidate."""

from soulx_serverless import handler


def main() -> None:
    import runpod

    runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    main()
