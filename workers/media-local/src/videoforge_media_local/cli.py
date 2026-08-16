from __future__ import annotations

from videoforge_image_media.local_cli import main as shared_media_main

from .artifacts import R2PortFixtureArtifactResolver


def main() -> int:
    return shared_media_main(
        resolver_factory=R2PortFixtureArtifactResolver,
        accepted_commands=frozenset({"transcribe", "render"}),
    )


if __name__ == "__main__":
    raise SystemExit(main())
