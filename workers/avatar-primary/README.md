# Primary avatar worker skeleton

Python 3.12 fixture-only boundary for future AvatarForcing span-audio chunks and explicit Avatar Profile compatibility checks. It never accepts a full voiceover, resolves a mutable Avatar Profile version, downloads a model, or calls a provider.

```sh
PYTHONPATH=src python3 -m videoforge_avatar_primary
python3 -m unittest discover -s tests
```

The process can be healthy while the model remains `not_loaded`. Future dispatch code must validate the revision-pinned runtime source and acquire its single-use execution claim before model load.
