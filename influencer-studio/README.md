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

It works with **no API key and no cost** out of the box.

## Free mode (default)

Photos and captions come from [Pollinations](https://pollinations.ai), which needs no account. Its limits:

- One image every 45 seconds and one caption every 30 seconds. The app waits and retries for you.
- Images are at most 768x768 in area, lower quality than paid models, with a small `pollinations.ai` logo in the corner.
- **The face is similar between photos, not identical.** The free model cannot look at the reference
  portrait, so the app repeats the same written description and seed for every photo. Keep the
  "Face" and "Hair" fields short and specific; that is what holds the look together.

## Paid mode (optional, better)

Edit `.env`:

| Setting | What it does |
|---|---|
| `IMAGE_PROVIDER=replicate` + `REPLICATE_API_TOKEN` | Photos via [Replicate](https://replicate.com), billed per image. Each scene is sent together with the reference portrait to an image-editing model (FLUX Kontext Pro), so the face is truly the same person. Not yet tested against a live account. |
| `CAPTION_PROVIDER=claude` + `ANTHROPIC_API_KEY` | Captions written by Claude. Not yet tested against a live key. |

`IMAGE_PROVIDER=mock` draws placeholder images offline (used by the tests).

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
