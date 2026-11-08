import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

/**
 * The card every link to this site unfurls into, on any surface that reads
 * Open Graph: a message, a post, a Slack paste, a search preview.
 *
 * It carries no rendered text. `ImageResponse` composites with Satori, which
 * needs font files handed to it, and neither brand face is on disk here:
 * `next/font` fetches Manrope and Inter at build time into the build output.
 * Setting the words in whatever default font ships with the renderer would put
 * a typeface on the card that appears nowhere else in the brand, so the card
 * shows the wordmark, which is vector artwork and needs no font at all, and
 * lets `og:title` and `og:description` carry the words. Every surface that
 * shows this image shows those two next to it.
 *
 * Both assets are read once at module scope, not per request. Neither depends
 * on the request, and the file convention caches the result anyway.
 */
export const alt =
  "Noreon, a continuous cardiovascular prevention platform";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const wordmark = `data:image/svg+xml;base64,${await readFile(
  join(process.cwd(), "public/brand/logo/noreon-wordmark-white.svg"),
  "base64",
)}`;

const wave = `data:image/png;base64,${await readFile(
  join(process.cwd(), "public/brand/wave/wave-gold-on-navy.png"),
  "base64",
)}`;

/**
 * The ground is `--noreon-navy-700`, the brand's dark surface and the one the
 * white wordmark and the gold wave are both cut for. Satori resolves no custom
 * properties, so the value is transcribed; `pnpm check:tokens` compares it
 * against the vendored `styles/noreon/colors.css` and fails if it drifts.
 *
 * The wave PNG is one of the six flat crops in `public/brand/wave/`. The app
 * draws the same figure from tokens in `components/brand/dot-field.tsx`, but
 * that redraw is built out of gradients, blurs and masks, none of which Satori
 * supports. A flat crop at a fixed size in a fixed colour is exactly the case
 * those PNGs exist for.
 */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          backgroundColor: "#222B56",
          position: "relative",
        }}
      >
        {/* Anchored to the bottom right, where the crop's crest already sits,
            and oversized so the fan runs off the edge rather than ending in
            mid air. */}
        <img
          src={wave}
          width={1500}
          height={750}
          style={{ position: "absolute", right: -120, bottom: -150 }}
          alt=""
        />
        <img src={wordmark} width={560} height={102} style={{ marginLeft: 96 }} alt="" />
      </div>
    ),
    { ...size },
  );
}
