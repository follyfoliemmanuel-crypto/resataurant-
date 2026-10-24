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

describe("SEO technique", () => {
  const publicFile = (name: string): string =>
    readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");

  test("la page déclare l'URL canonique de production", () => {
    const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/)?.[1];
    assert.equal(canonical, "https://resataurant-savora.vercel.app/");
  });

  test("la balise de vérification Google Search Console est présente", () => {
    assert.equal(
      meta('name="google-site-verification"'),
      "s1FhGG_XGW0ZeiVCJcaZlKN8iuO9PtUSeEDs2KW8j2I",
    );
  });

  test("le titre et la description sont courts et décrivent Savora", () => {
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
    const description = meta('name="description"') ?? "";

    assert.match(title, /Savora/);
    assert.ok(title.length <= 60, `titre trop long (${title.length} caractères)`);
    assert.match(description, /Savora/);
    assert.ok(
      description.length >= 80 && description.length <= 160,
      `description de longueur inattendue (${description.length} caractères)`,
    );
  });

  test("les favicons référencés sont ceux de Savora", () => {
    assert.match(html, /<link rel="icon" type="image\/png" sizes="64x64" href="\/favicon\.png"/);
    assert.match(html, /<link rel="apple-touch-icon"[^>]+href="\/logo-savora-sm\.png"/);
    assert.doesNotMatch(html, /href="\/favicon\.svg"/);
  });

  test("robots.txt autorise la page publique, exclut l'API et pointe le sitemap", () => {
    const robots = publicFile("robots.txt");

    assert.match(robots, /^User-agent:\s*\*$/m);
    assert.match(robots, /^Allow:\s*\/$/m);
    assert.match(robots, /^Disallow:\s*\/api\/$/m);
    assert.match(
      robots,
      /^Sitemap:\s*https:\/\/resataurant-savora\.vercel\.app\/sitemap\.xml$/m,
    );
    assert.doesNotMatch(robots, /^Disallow:\s*\/$/m);
  });

  test("sitemap.xml ne contient que l'URL publique canonique", () => {
    const sitemap = publicFile("sitemap.xml");
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

    assert.deepEqual(locs, ["https://resataurant-savora.vercel.app/"]);
    assert.doesNotMatch(sitemap, /\/api\//);
  });

  test("les données structurées décrivent le site, l'organisation et la fiche restaurant réelle", () => {
    const jsonLd = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    )?.[1];
    assert.ok(jsonLd, "JSON-LD manquant");

    const data = JSON.parse(jsonLd) as {
      "@graph"?: Array<Record<string, unknown>>;
    };
    const graph = data["@graph"] ?? [];
    const types = graph.map((node) => node["@type"]);

    assert.ok(types.includes("WebSite"));
    assert.ok(types.includes("Organization"));
    assert.ok(types.includes("Restaurant"));
    assert.ok(!types.includes("LocalBusiness"));

    const website = graph.find((node) => node["@type"] === "WebSite");
    assert.equal(website?.["url"], "https://resataurant-savora.vercel.app/");

    const restaurant = graph.find((node) => node["@type"] === "Restaurant") as
      | Record<string, unknown>
      | undefined;
    assert.ok(restaurant, "fiche Restaurant manquante");
    assert.equal(restaurant["name"], "Savora Restaurant & Grill");
    assert.equal(restaurant["telephone"], "+228 70 30 97 44");
    assert.equal(restaurant["email"], "contact@savora.restaurant");
    assert.equal(restaurant["currenciesAccepted"], "XOF");
    assert.ok(Array.isArray(restaurant["openingHoursSpecification"]));

    const address = restaurant["address"] as Record<string, unknown> | undefined;
    assert.equal(address?.["streetAddress"], "Boulevard du 13 Janvier");
    assert.equal(address?.["addressLocality"], "Lomé");

    assert.ok(!("aggregateRating" in restaurant), "aucune note inventée");
    assert.ok(!("review" in restaurant), "aucun avis inventé");
    assert.ok(!("priceRange" in restaurant), "aucun prix inventé");
  });
});
