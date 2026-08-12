# VF-9-24F corrected A100 PCIe attempt

The corrected image was published successfully, but the exact A100 PCIe job remained `IN_QUEUE`
for ten minutes without acquiring a worker. The guard cancelled it at `$0`, deleted the endpoint and
template, and the runner plus three independent reads proved absolute zero. No inference ran and no
MP4 exists. The only successor is the same 80 GB A100 SXM capacity class with unchanged inference.
