# VF-9-24G A100 SXM ephemeral sample

A100 SXM acquired after 74.108 seconds and stayed `IN_PROGRESS`, but the ephemeral worker had to
download/verify the 23.9 GB runtime again. The operational cost stop cancelled it before a terminal
model result. No MP4 exists. The runner deleted endpoint/template and three independent reads proved
global zero. Stable post-billing balance is `$15.5379052361`; cumulative delta from the corrected
sample baseline is `$0.802093288`.

The successor uses one temporary persistent model cache, warmed on cheaper RTX 4090, then one A100
inference. It retains the exact BF16 model/input/config and deletes the volume afterward.
