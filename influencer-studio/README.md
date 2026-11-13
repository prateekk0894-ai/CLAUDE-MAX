# Influencer Studio

A small local app for running **one fictional AI influencer**: define the persona once,
lock a reference face, then generate new photos of the same person and captions in their voice.

## Run

Needs Node 22+.

```bash
cd influencer-studio
npm install
cp .env.example .env
npm start            # http://localhost:4321
```

Out of the box `IMAGE_PROVIDER=mock` draws placeholder images, so you can try the whole flow for free.

## Real photos and captions

Edit `.env`:

| Setting | What it does |
|---|---|
| `IMAGE_PROVIDER=replicate` + `REPLICATE_API_TOKEN` | Real photos via [Replicate](https://replicate.com). Billed to your account per image. |
| `ANTHROPIC_API_KEY` | Captions, hashtags and alt text written by Claude. Optional. |

## How the face stays the same

1. **Persona**: name, look, style, personality. Saved in `data/persona.json`.
2. **Reference face**: one studio portrait made from the persona (FLUX 1.1 Pro). Regenerate until you like it.
3. **New photo**: each scene is sent together with the reference portrait to an image-editing
   model (FLUX Kontext Pro) with the instruction to keep the same person.

Models can be swapped with `REPLICATE_BASE_MODEL` / `REPLICATE_EDIT_MODEL`. For even tighter
consistency later, train a LoRA on 15-20 good outputs and point `REPLICATE_BASE_MODEL` at it.

Everything generated lives in `data/` (not committed).

## Rules built in

- The persona must be an adult (21+) and fictional. Do not describe a real person's face.
- Safe-for-work only: explicit scenes are rejected.
- Captions always carry `#aiinfluencer` and never claim to be a real human. Instagram, YouTube
  and TikTok also require you to turn on their "AI-generated" label when posting.

## Tests

```bash
npm test
```
