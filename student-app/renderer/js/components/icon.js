import { state } from '../state.js';
import { hue, initials } from '../lib/format.js';

// Subject logo tile served by the server; falls back to colored initials.
export function iconTile(icon, label, size = 'md') {
  const tile = document.createElement('span');
  tile.className = `icon-tile ${size}`;
  tile.setAttribute('aria-hidden', 'true');
  const fallback = () => {
    tile.classList.add('fallback');
    tile.style.setProperty('--tile-hue', hue(label));
    tile.textContent = initials(label);
  };
  if (icon) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = `${state.server}/icons/${encodeURIComponent(icon)}.svg`;
    img.onerror = () => {
      img.remove();
      fallback();
    };
    tile.appendChild(img);
  } else {
    fallback();
  }
  return tile;
}
