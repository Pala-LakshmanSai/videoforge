# VF-9-24E A100 EchoMimic sample

The exact A100 80 GB job reached `COMPLETED` but the worker returned generic
`AVATAR_PRIMARY_FAILED` before inference evidence or MP4. Static flow inspection found the published
worker still rejected every runtime GPU except RTX 4090 and left input-download/GPU-query exceptions
generic. Measured spend was `$0.0044856296`.

The runner deleted the endpoint and template. Its final observation plus three subsequent independent
reads proved zero Pods, workers, endpoints, private templates, and network volumes.
