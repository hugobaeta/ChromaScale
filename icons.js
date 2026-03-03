// ChromaScale — Inline SVG Icon Library
// 24 icons, zero external dependencies. Replaces Phosphor Icons CDN (~250KB).

const ICON_PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14M10 11v6M14 11v6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1.08z"/>',
  'floppy-disk': '<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  'arrow-counter-clockwise': '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>',
  'arrow-clockwise': '<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.13-9.36L23 10"/>',
  export: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  'chart-line': '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/>',
  'grid-four': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  'eye-slash': '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.78 7.78 5.5 5.5 0 017.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  terminal: '<path d="M4 17l6-5-6-5M12 19h8"/>',
  'cloud-arrow-up': '<path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/><path d="M14 16l-2-2-2 2M12 14v6"/>',
  folders: '<path d="M20 17V7a2 2 0 00-2-2h-5l-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2z"/>',
  'sliders-horizontal': '<path d="M21 4H14M10 4H3M21 12H12M8 12H3M21 20H16M12 20H3M14 1v6M8 9v6M16 17v6"/>',
  palette: '<path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10a2 2 0 002-2v-.09a2 2 0 012-1.91h1.5A5.5 5.5 0 0022 12.5 10 10 0 0012 2z"/><circle cx="7.5" cy="11.5" r="1.5" fill="currentColor"/><circle cx="12" cy="7.5" r="1.5" fill="currentColor"/><circle cx="16.5" cy="11.5" r="1.5" fill="currentColor"/>',
  'caret-left': '<path d="M15 18l-6-6 6-6"/>',
  'caret-right': '<path d="M9 18l6-6-6-6"/>',
  'caret-down': '<path d="M6 9l6 6 6-6"/>',
  pencil: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  warning: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
};

// Dot-based icons use fill instead of stroke
const ICON_FILL_PATHS = {
  'dots-six-vertical': '<circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>',
  'dots-three': '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  spinner: '<path d="M12 2a10 10 0 019.95 9" stroke-width="2.5"/>',
};

/**
 * Returns an inline SVG string for the named icon.
 * @param {string} name - Icon name (e.g. 'sun', 'copy', 'dots-three')
 * @param {number} [size=16] - Width and height in pixels
 * @param {string} [extraClass=''] - Additional CSS class(es)
 * @returns {string} SVG markup string
 */
function icon(name, size, extraClass) {
  size = size || 16;
  const cls = extraClass ? ` class="${extraClass}"` : '';

  if (ICON_PATHS[name]) {
    return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
  }
  if (ICON_FILL_PATHS[name]) {
    const isSpinner = name === 'spinner';
    return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="${isSpinner ? 'none' : 'currentColor'}" stroke="${isSpinner ? 'currentColor' : 'none'}" stroke-linecap="round">${ICON_FILL_PATHS[name]}</svg>`;
  }
  return '';
}

// Expose globally
window.icon = icon;
