const fs = require('node:fs');
const path = require('node:path');

// Brand logos from Simple Icons (CC0). Trademarks belong to their owners.
const iconsDir = path.join(path.dirname(require.resolve('simple-icons/icons.json')), '..', 'icons');
const catalog = require('simple-icons/icons.json');
const bySlug = new Map(catalog.map((i) => [i.slug, i]));
const cache = new Map();

function rgb(hex) {
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function tint(hex, amount) {
  return `#${rgb(hex)
    .map((c) => Math.round(255 - (255 - c) * amount).toString(16).padStart(2, '0'))
    .join('')}`;
}

// Rounded tile: light brand tint behind a brand-colored logo, or for very light
// brand colors (e.g. JavaScript yellow) a solid brand tile with a dark logo.
function tileSvg(slug) {
  if (cache.has(slug)) return cache.get(slug);
  const icon = bySlug.get(slug);
  if (!icon) return null;
  const source = fs.readFileSync(path.join(iconsDir, `${slug}.svg`), 'utf8');
  const d = (source.match(/<path d="([^"]+)"/) || [])[1];
  if (!d) return null;
  const light = luminance(icon.hex) > 0.4;
  const bg = light ? `#${icon.hex}` : tint(icon.hex, 0.14);
  const fg = light ? '#1f2328' : `#${icon.hex}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img"><title>${icon.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>` +
    `<rect width="48" height="48" rx="12" fill="${bg}"/>` +
    `<path transform="translate(12 12)" fill="${fg}" d="${d}"/></svg>`;
  cache.set(slug, svg);
  return svg;
}

function search(query = '', limit = 40) {
  const q = query.trim().toLowerCase();
  const results = [];
  for (const i of catalog) {
    if (!q || i.slug.includes(q) || i.title.toLowerCase().includes(q)) {
      results.push({ slug: i.slug, title: i.title });
      if (results.length >= limit) break;
    }
  }
  return results;
}

const exists = (slug) => bySlug.has(slug);

module.exports = { tileSvg, search, exists };
