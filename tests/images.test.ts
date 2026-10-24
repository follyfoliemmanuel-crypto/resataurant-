import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "../server/lib/http.js";
import {
  MAX_IMAGE_BYTES,
  normalizeImageUrl,
  parseImageDataUrl,
} from "../server/lib/images.js";

const GIF_1X1 =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const JPEG_HEADER = `data:image/jpg;base64,${Buffer.from([
  0xff, 0xd8, 0xff, 0xe0,
]).toString("base64")}`;

function isHttpError(status: number) {
  return (error: unknown) => error instanceof HttpError && error.status === status;
}

describe("Photos de plats", () => {
  test("décode une image GIF valide", () => {
    const parsed = parseImageDataUrl(GIF_1X1);
    assert.ok(parsed);
    assert.equal(parsed.mimeType, "image/gif");
    assert.ok(parsed.data.length > 0);
  });

  test("normalise image/jpg en image/jpeg", () => {
    const parsed = parseImageDataUrl(JPEG_HEADER);
    assert.ok(parsed);
    assert.equal(parsed.mimeType, "image/jpeg");
  });

  test("refuse un contenu qui ne correspond pas au type annoncé", () => {
    assert.throws(
      () => parseImageDataUrl("data:image/png;base64,AAAA"),
      isHttpError(400),
    );
  });

  test("refuse un format non autorisé", () => {
    assert.throws(
      () =>
        parseImageDataUrl(
          "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
        ),
      isHttpError(400),
    );
  });

  test("refuse une image trop lourde", () => {
    const tooLarge = `data:image/gif;base64,${Buffer.alloc(
      MAX_IMAGE_BYTES + 1,
    ).toString("base64")}`;
    assert.throws(() => parseImageDataUrl(tooLarge), isHttpError(413));
  });

  test("accepte les URL http(s) et les chemins locaux", () => {
    assert.equal(
      normalizeImageUrl("https://images.example.com/plat.jpg"),
      "https://images.example.com/plat.jpg",
    );
    assert.equal(normalizeImageUrl("/images/plat.jpg"), "/images/plat.jpg");
    assert.equal(normalizeImageUrl("  "), null);
    assert.equal(normalizeImageUrl(null), null);
  });

  test("refuse les URL dangereuses ou les data URLs dans image_url", () => {
    assert.throws(() => normalizeImageUrl("javascript:alert(1)"), isHttpError(400));
    assert.throws(() => normalizeImageUrl("//evil.example.com/photo.jpg"), isHttpError(400));
    assert.throws(() => normalizeImageUrl(GIF_1X1), isHttpError(400));
  });
});
