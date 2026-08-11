# VF-9-04 Mage access restoration evidence

Status: browser path superseded safely at `$0`

- Chrome remained unavailable; no browser fallback, token, cookie, credential, or session store was
  accessed.
- First-party indexed Hugging Face pages exposed verified immutable commit
  `395402ba3ef110c96e70d01abe4d178dbe4e01a5`, the official 17.5 GB repository tree, and exact
  transformer weight identity `sha256:6df47df3d7efc9ebdad075b87b3e9e4f74d09dca672d592271788f0ee27ab97d`
  (`8,231,536,760` bytes).
- This evidence is sufficient to admit a deliberately older immutable revision; mutable `main` is
  not used. VF-9-05 performs the fail-closed code admission. No model bytes were downloaded.
