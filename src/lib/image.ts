const MAX_DIMENSION = 1200;
const MAX_DATA_URL_LENGTH = 600_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error(
          "Impossible de lire cette photo. Essayez un fichier JPG, PNG, WebP ou GIF.",
        ),
      );
    image.src = src;
  });
}

/**
 * Redimensionne et compresse une photo choisie sur l'appareil avant de
 * l'envoyer à l'API. La data URL produite reste sous la limite du corps JSON
 * du serveur (1 Mo), tout en gardant un rendu correct sur mobile.
 */
export async function fileToOptimizedDataUrl(file: File): Promise<string> {
  if (file.size === 0) {
    throw new Error("Le fichier choisi est vide.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Cette photo est trop lourde (maximum 25 Mo).");
  }
  if (file.type === "image/svg+xml") {
    throw new Error("Le format SVG n'est pas accepté. Utilisez JPG, PNG, WebP ou GIF.");
  }
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("Choisissez un fichier image (JPG, PNG, WebP ou GIF).");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;

    if (!naturalWidth || !naturalHeight) {
      throw new Error("Les dimensions de cette photo sont invalides.");
    }

    const initialScale = Math.min(
      1,
      MAX_DIMENSION / Math.max(naturalWidth, naturalHeight),
    );
    let width = Math.max(1, Math.round(naturalWidth * initialScale));
    let height = Math.max(1, Math.round(naturalHeight * initialScale));
    let quality = 0.82;
    let dataUrl = "";

    // Si la photo reste trop lourde, on réduit progressivement les dimensions
    // et la qualité plutôt que d'envoyer un fichier que le serveur refusera.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Impossible de préparer cette photo dans le navigateur.");
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= MAX_DATA_URL_LENGTH) {
        return dataUrl;
      }

      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
      quality = Math.max(0.55, quality - 0.06);
    }

    throw new Error(
      "La photo reste trop lourde après compression. Choisissez une image plus légère.",
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
