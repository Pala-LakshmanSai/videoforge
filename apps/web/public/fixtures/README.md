# Owned synthetic fixture assets

The files in this directory are repository-authored vector fixtures used by the
fixture-mode UI and automated tests. They contain no embedded third-party raster
images, provider outputs, private reference files, or production media.

Their rights status is `owned_synthetic_fixture`. They are deterministic product
fixtures, not evidence that a real provider generated or validated media. The
canonical SHA-256 inventory and provenance records live in
`project-context/evidence/asset_manifest.csv`.

| Path                              | Fixture purpose                         |
| --------------------------------- | --------------------------------------- |
| `avatar/amish-farm-host.svg`      | Synthetic reusable Avatar Hub thumbnail |
| `media/watermelon-market.svg`     | Synthetic project preview frame         |
| `styles/documentary-stock.svg`    | Built-in documentary style cover        |
| `styles/documentary-field.svg`    | Built-in documentary owned example      |
| `styles/documentary-market.svg`   | Built-in documentary owned example      |
| `styles/documentary-workshop.svg` | Built-in documentary owned example      |
| `styles/warm-rural.svg`           | Custom-style fixture cover              |
| `styles/rural-field.svg`          | Synthetic custom-style reference        |
| `styles/rural-hands.svg`          | Synthetic custom-style reference        |
| `styles/rural-kitchen.svg`        | Synthetic custom-style reference        |
| `styles/rural-market.svg`         | Synthetic custom-style reference        |

When changing an asset, update its checksum in the manifest in the same change
and run `pnpm context:validate`.
