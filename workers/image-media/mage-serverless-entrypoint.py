"""RunPod queue entrypoint.  The import happens only in the published worker image."""

from mage_serverless import handler


def main() -> None:
    import runpod

    runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    main()
