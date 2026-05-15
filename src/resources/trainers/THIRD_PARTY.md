# Hugging Face Trainer Sprite Assets

The `hf-trainer-*.webp` files in this directory are converted from JPEG samples in:

- Repository: <https://huggingface.co/sWizad/pokemon-trainer-sprite-pixelart>
- Listed license: `bespoke-lora-trained-license`
- License link from model card: <https://multimodal.art/civitai-licenses?allowNoCredit=True&allowCommercialUse=Image&allowDerivatives=True&allowDifferentLicense=True>

Transform:

- Source JPEGs are downloaded by `scripts/build-hf-trainer-assets.mjs`.
- Simple backgrounds are flood-filled from image edges and converted to transparent alpha.
- Sprites are cropped, padded, downscaled to 96x96 with nearest-neighbor sampling, and encoded as
  lossless WebP.

Source to output mapping:

- `9737393.jpeg` -> `hf-trainer-01-harley-quinn.webp`
- `9737398.jpeg` -> `hf-trainer-02-summer-dress.webp`
- `9737407.jpeg` -> `hf-trainer-03-evil-fairy.webp`
- `9737429.jpeg` -> `hf-trainer-04-turtle-step.webp`
- `9737466.jpeg` -> `hf-trainer-05-dragon-queen.webp`
- `9737470.jpeg` -> `hf-trainer-06-long-coat.webp`
- `9737471.jpeg` -> `hf-trainer-07-red-suit.webp`
- `9737472.jpeg` -> `hf-trainer-08-silent-comic.webp`
- `9737478.jpeg` -> `hf-trainer-09-card-trickster.webp`
- `9737481.jpeg` -> `hf-trainer-10-forest-sword.webp`
- `9737483.jpeg` -> `hf-trainer-11-armored-hero.webp`
- `9737499.jpeg` -> `hf-trainer-12-kimono-sakura.webp`
- `9737502.jpeg` -> `hf-trainer-13-blue-flame-witch.webp`
- `9737504.jpeg` -> `hf-trainer-14-hooded-solo.webp`
- `9737508.jpeg` -> `hf-trainer-15-pirate-captain.webp`
- `9737509.jpeg` -> `hf-trainer-16-winged-angel.webp`

# Pokemon Showdown Trainer Sprite Assets

The `ps-trainer-*.webp` files in this directory are converted from PNG files in:

- Source index: <https://play.pokemonshowdown.com/sprites/trainers/>
- Source notice: many sprites are not from the games, appropriate artist credit is required if used
  elsewhere, and editing without permission is disallowed.
- Distribution note: verify that the target release context has permission to ship these sprites; the
  source notice is retained here so this does not get lost during asset packaging.

Transform:

- Source PNGs are downloaded by `scripts/build-showdown-trainer-assets.mjs`.
- Source transparency is preserved; transparent padding is cropped.
- Sprites are resized to 96x96 with nearest-neighbor sampling and encoded as lossless WebP.

Per-file metadata:

- `pokemon-showdown-trainers.json` records each source PNG, generated WebP output, source URL, and
  listed artist where the source index provides one.
