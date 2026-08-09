# Avatar repair worker skeleton

Python 3.12 fixture-only boundary for future cold MuseTalk lip-only repair jobs. This lane is not a general retry path: it will accept only an otherwise-good AvatarForcing clip plus the original selected span audio after explicit defect classification.

```sh
PYTHONPATH=src python3 -m videoforge_avatar_repair
python3 -m unittest discover -s tests
```

There are no models, provider clients, secrets, downloads, or external calls in this skeleton. Process health and model readiness remain separate.
