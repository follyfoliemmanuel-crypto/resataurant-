import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const meta = (key: string): string | undefined => {
  const match = html.match(new RegExp(`<meta\\s+${key}\\s+content="([^"]*)"`));
  return match?.[1];
};

describe("Partage sur les réseaux sociaux (Open Graph)", () => {
  test("les balises Open Graph essentielles sont présentes", () => {
    assert.equal(meta('property="og:type"'), "website");
    assert.match(meta('property="og:title"') ?? "", /Savora/);
    assert.match(meta('property="og:description"') ?? "", /Commandez en ligne/);
    assert.equal(meta('property="og:site_name"'), "Savora");
  });

  test("l'image de partage est absolue, en 1200x630 et sur le même domaine que la page", () => {
    const pageUrl = meta('property="og:url"');
    const imageUrl = meta('property="og:image"');

    assert.ok(pageUrl, "og:url manquant");
    assert.ok(imageUrl, "og:image manquant");
    assert.equal(new URL(imageUrl).origin, new URL(pageUrl).origin);
    assert.equal(new URL(imageUrl).protocol, "https:");
    assert.match(new URL(imageUrl).pathname, /\/og-image\.png$/);

    assert.equal(meta('property="og:image:width"'), "1200");
    assert.equal(meta('property="og:image:height"'), "630");
    assert.equal(meta('property="og:image:type"'), "image/png");
  });

  test("la carte Twitter/X reprend l'image large", () => {
    assert.equal(meta('name="twitter:card"'), "summary_large_image");
    assert.ok(meta('name="twitter:image"'));
    assert.match(meta('name="twitter:title"') ?? "", /Savora/);
  });

  test("le fichier og-image.png existe et fait bien 1200x630", () => {
    const png = readFileSync(new URL("../public/og-image.png", import.meta.url));

    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", "signature PNG invalide");
    assert.equal(png.readUInt32BE(16), 1200, "largeur inattendue");
    assert.equal(png.readUInt32BE(20), 630, "hauteur inattendue");
    assert.ok(png.length < 5 * 1024 * 1024, "image trop lourde pour les réseaux sociaux");
  });
});
