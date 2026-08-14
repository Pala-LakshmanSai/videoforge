from __future__ import annotations

import asyncio
import sys

COMFYUI_ROOT = "/opt/comfyui"
REQUIRED_NODES = (
    "UNETLoader",
    "CLIPLoader",
    "VAELoader",
    "TextEncodeMageFlowEdit",
    "KSampler",
    "VAEDecode",
    "SaveImage",
)


def main() -> None:
    sys.path.insert(0, COMFYUI_ROOT)
    import comfy.options

    comfy.options.enable_args_parsing()
    sys.argv = [sys.argv[0], "--cpu"]
    import nodes

    from comfy_extras.nodes_mage import comfy_entrypoint

    async def mage_node_ids() -> set[str]:
        extension = await comfy_entrypoint()
        node_types = await extension.get_node_list()
        return {node_type.define_schema().node_id for node_type in node_types}

    available = {*nodes.NODE_CLASS_MAPPINGS, *asyncio.run(mage_node_ids())}
    missing = [name for name in REQUIRED_NODES if name not in available]
    if missing:
        raise SystemExit(f"ComfyUI missing required Mage nodes: {missing}")
    print(f"verified {len(REQUIRED_NODES)} required Mage nodes")


if __name__ == "__main__":
    main()
