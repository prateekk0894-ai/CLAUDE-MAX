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

## Free mode (default): make photos in Gemini, manage them here

The free automatic image services do not produce real-looking people, so by default the studio
writes the prompts and you make the photos in a free image app that does, such as the
[Gemini app](https://gemini.google.com):

1. **Face**: click *Copy face prompt*, paste it into Gemini, save the portrait you like, *Upload face*.
2. **Each photo**: write the scene, click *Copy prompt*. In Gemini, attach your reference face,
   paste the prompt, save the result, then *Upload photo*.
3. **Caption**: click *Write caption* on the photo.

Attaching the same reference face every time is what keeps it the same person. Gemini has a daily
free limit and marks its images as AI-generated. Captions come from
[Pollinations](https://pollinations.ai) (free, no account, one every 30 seconds).

`IMAGE_PROVIDER=pollinations` makes photos automatically for free, but the quality is low: they do
not look like a real person, the face changes between photos, and it sometimes returns an unrelated image.

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
