/**
 * Product image URLs — same layout as kcw-api parts9_explorer / image handler.
 * public/{bucket}/{base_folder}/{bcode}/{bcode}.jpg (+ _2.._5 variants)
 */

export function getImageConfig(env = process.env) {
  const supabaseUrl = String(env.SUPABASE_URL || env.SUPABASE_DB_URL || "").replace(/\/$/, "");
  return {
    supabaseUrl,
    supabaseImageBucket: env.SUPABASE_IMAGE_BUCKET || "pictures",
    supabaseImageBaseFolder: (env.SUPABASE_IMAGE_BASE_FOLDER || "product").replace(/^\/|\/$/g, ""),
  };
}

export function productImageCandidates(bcode, config = getImageConfig()) {
  const code = String(bcode || "").trim();
  if (!code || !config.supabaseUrl) return [];
  const bucket = config.supabaseImageBucket || "pictures";
  const folder = config.supabaseImageBaseFolder || "product";
  const names = [code + ".jpg", ...[2, 3, 4, 5].map((i) => `${code}_${i}.jpg`)];
  return names.map(
    (name) => `${config.supabaseUrl}/storage/v1/object/public/${bucket}/${folder}/${code}/${name}`
  );
}

export async function findFirstProductImage(bcode, config = getImageConfig()) {
  for (const url of productImageCandidates(bcode, config)) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) });
      if (res.ok) return url;
    } catch {
      /* try next slot */
    }
  }
  return null;
}

/** @returns {Promise<Map<string, string>>} bcode -> first existing image URL */
export async function resolveProductImages(bcodes, config = getImageConfig(), { concurrency = 8 } = {}) {
  const map = new Map();
  const unique = [...new Set(bcodes.map((b) => String(b || "").trim()).filter(Boolean))];
  if (!unique.length || !config.supabaseUrl) return map;

  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const hits = await Promise.all(
      batch.map(async (bcode) => {
        const url = await findFirstProductImage(bcode, config);
        return url ? [bcode, url] : null;
      })
    );
    for (const hit of hits) {
      if (hit) map.set(hit[0], hit[1]);
    }
  }
  return map;
}
