/**
 * Derives every app icon from the one piece of brand artwork.
 *
 *   public/brand/logo/app-icon.png   the source, owned by the design team
 *     -> app/icon.png                the tab icon, copied byte for byte
 *     -> app/apple-icon.png          180px, opaque, for the iOS home screen
 *     -> app/favicon.ico             16, 32 and 48, for /favicon.ico
 *     -> public/icons/icon-192.png   the web app manifest's icons
 *     -> public/icons/icon-512.png
 *
 * Run it when the design team replaces the source, and commit what it writes.
 * It needs sharp, which this app does not otherwise depend on, so install it
 * for the run and take it back out again:
 *
 *   pnpm add -D sharp && node scripts/make-icons.mjs && pnpm remove sharp
 *
 * The source is 106px square, which is smaller than every size below it except
 * the favicon. Everything larger is an upscale and is soft at the edges as a
 * result; the fix is a larger source from the design team, not a sharper
 * resample here.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "public", "brand", "logo", "app-icon.png");

const square = (size) =>
  sharp(source).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();

/**
 * The tile's own blue, sampled from the artwork at its centre rather than
 * named. The mark is not painted in one of the palette's steps: it carries a
 * gradient of its own, deeper than --noreon-navy-700. Naming a token here would
 * put a seam around the tile wherever the fill shows.
 */
const { data, info } = await sharp(source).raw().toBuffer({ resolveWithObject: true });
const centre = (Math.round(info.height / 2) * info.width + Math.round(info.width / 2)) * info.channels;
const fill = { r: data[centre], g: data[centre + 1], b: data[centre + 2] };

// No resample: the tab icon is drawn at 16 or 32px from whatever it is handed,
// and the source is already larger than both.
copyFileSync(source, join(root, "app", "icon.png"));

// Opaque, because iOS composites a transparent icon onto black before applying
// its own corner mask, which would ring the tile in black at every corner.
writeFileSync(
  join(root, "app", "apple-icon.png"),
  await sharp(await square(180)).flatten({ background: fill }).png().toBuffer(),
);

mkdirSync(join(root, "public", "icons"), { recursive: true });
writeFileSync(join(root, "public", "icons", "icon-192.png"), await square(192));
writeFileSync(join(root, "public", "icons", "icon-512.png"), await square(512));

/**
 * The .ico container, written by hand because sharp does not emit one.
 *
 * Three sizes, each stored as a whole PNG inside the container rather than as
 * a bitmap, which every browser released since Vista reads and which keeps the
 * alpha channel intact. The layout is a six byte header, then one sixteen byte
 * directory entry per image, then the images themselves.
 */
const SIZES = [16, 32, 48];
const images = await Promise.all(SIZES.map(square));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon rather than cursor
header.writeUInt16LE(SIZES.length, 4);

let offset = header.length + 16 * SIZES.length;
const directory = SIZES.map((size, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0); // width, where 0 would mean 256
  entry.writeUInt8(size, 1); // height
  entry.writeUInt8(0, 2); // palette entries: none, this is truecolour
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(images[i].length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return entry;
});

writeFileSync(
  join(root, "app", "favicon.ico"),
  Buffer.concat([header, ...directory, ...images]),
);

console.log(`Icons written from ${source}, tile fill #${[fill.r, fill.g, fill.b].map((c) => c.toString(16).padStart(2, "0")).join("")}.`);
