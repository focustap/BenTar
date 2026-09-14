(() => {
  const STORAGE_KEY = 'bentar_favorites';
  const THEME_KEY = 'bentar_theme';

  function getFavorites() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function setFavorites(value) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  function normalizeTabUrl(value) {
    if (!value) return '';
    try {
      if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
    } catch {}
    if (!value.startsWith('/')) value = '/' + value;
    if (!value.startsWith('/tab/')) {
      const index = value.indexOf('/tab/');
      if (index >= 0) value = value.slice(index);
    }
    return value;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalizeImportedFavorites(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Expected a Freetar favorites JSON object.');
    }

    const normalized = {};
    for (const [key, item] of Object.entries(raw)) {
      if (!item || typeof item !== 'object') continue;
      const tabUrl = normalizeTabUrl(item.tab_url || key);
      if (!tabUrl.startsWith('/tab/')) continue;
      normalized[tabUrl] = {
        artist_name: String(item.artist_name || item.artist || 'Unknown artist'),
        song: String(item.song || item.song_name || 'Unknown song'),
        rating: String(item.rating ?? '0'),
        type: String(item.type || 'Chords'),
        tab_url: tabUrl,
      };
    }

    if (!Object.keys(normalized).length) {
      throw new Error('No valid saved tabs were found in that file.');
    }
    return normalized;
  }

  function applyTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) document.documentElement.setAttribute('data-bs-theme', saved);
  }

  function initThemeButton() {
    const button = document.getElementById('themeToggle');
    if (!button) return;
    button.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-bs-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-bs-theme', next);
      localStorage.setItem(THEME_KEY, next);
    });
  }

  function initLibraryPage() {
    const fileInput = document.getElementById('favoritesFile');
    const tbody = document.querySelector('#libraryTable tbody');
    const table = document.getElementById('libraryTable');
    const empty = document.getElementById('emptyLibrary');
    const count = document.getElementById('libraryCount');
    const filter = document.getElementById('libraryFilter');
    const clear = document.getElementById('clearLibrary');

    if (!tbody || !table || !empty) return;

    function render() {
      const favorites = getFavorites();
      const query = (filter?.value || '').trim().toLowerCase();
      const all = Object.values(favorites).sort((a, b) => {
        const byArtist = a.artist_name.localeCompare(b.artist_name);
        return byArtist || a.song.localeCompare(b.song);
      });
      const visible = all.filter(song =>
        `${song.artist_name} ${song.song} ${song.type}`.toLowerCase().includes(query)
      );

      tbody.innerHTML = '';
      for (const song of visible) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${escapeHtml(song.artist_name)}</td>
          <td><a href="${escapeHtml(normalizeTabUrl(song.tab_url))}">${escapeHtml(song.song)}</a></td>
          <td class="d-none d-md-table-cell">${escapeHtml(song.type)}</td>
          <td class="text-end"><button class="btn btn-sm btn-outline-danger removeFavorite" data-url="${escapeHtml(normalizeTabUrl(song.tab_url))}" type="button">×</button></td>
        `;
        tbody.appendChild(row);
      }

      const hasAny = all.length > 0;
      table.classList.toggle('d-none', !hasAny);
      empty.classList.toggle('d-none', hasAny);
      if (count) count.textContent = hasAny ? `${all.length} saved tab${all.length === 1 ? '' : 's'}` : 'No imported tabs yet';

      tbody.querySelectorAll('.removeFavorite').forEach(button => {
        button.addEventListener('click', () => {
          const favoritesNow = getFavorites();
          delete favoritesNow[button.dataset.url];
          setFavorites(favoritesNow);
          render();
          syncSearchStars();
        });
      });
    }

    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const imported = normalizeImportedFavorites(JSON.parse(await file.text()));
        setFavorites(imported);
        render();
        syncSearchStars();
        alert(`Imported ${Object.keys(imported).length} saved tabs.`);
      } catch (error) {
        alert(`Could not import that JSON: ${error.message}`);
      } finally {
        fileInput.value = '';
      }
    });

    clear?.addEventListener('click', () => {
      if (!Object.keys(getFavorites()).length) return;
      if (confirm('Clear all imported BenTar favorites from this browser?')) {
        localStorage.removeItem(STORAGE_KEY);
        render();
        syncSearchStars();
      }
    });

    filter?.addEventListener('input', render);

    document.querySelectorAll('.saveFavorite').forEach(button => {
      button.addEventListener('click', () => {
        const url = normalizeTabUrl(button.dataset.url);
        const favorites = getFavorites();
        if (favorites[url]) {
          delete favorites[url];
        } else {
          favorites[url] = {
            artist_name: button.dataset.artist || 'Unknown artist',
            song: button.dataset.song || 'Unknown song',
            rating: button.dataset.rating || '0',
            type: button.dataset.type || 'Chords',
            tab_url: url,
          };
        }
        setFavorites(favorites);
        render();
        syncSearchStars();
      });
    });

    function syncSearchStars() {
      const favorites = getFavorites();
      document.querySelectorAll('.saveFavorite').forEach(button => {
        const saved = Boolean(favorites[normalizeTabUrl(button.dataset.url)]);
        button.textContent = saved ? '★' : '☆';
        button.classList.toggle('btn-warning', saved);
        button.classList.toggle('btn-outline-warning', !saved);
      });
    }

    render();
    syncSearchStars();
  }

  function initReader() {
    const reader = document.getElementById('tabReader');
    if (!reader) return;

    let scrollTimer = null;
    let scrollSpeed = 2;
    let transposeSteps = 0;
    let fontSize = Number(localStorage.getItem('bentar_font_size') || 16);

    const speedLabel = document.getElementById('speedLabel');
    const transposeLabel = document.getElementById('transposeLabel');
    const autoButton = document.getElementById('autoscrollToggle');

    function updateSpeed() {
      if (speedLabel) speedLabel.textContent = `Speed ${scrollSpeed}`;
    }

    function stopAutoscroll() {
      if (scrollTimer) clearInterval(scrollTimer);
      scrollTimer = null;
      if (autoButton) autoButton.textContent = '▶ Autoscroll';
    }

    function startAutoscroll() {
      stopAutoscroll();
      scrollTimer = setInterval(() => window.scrollBy(0, 1), Math.max(12, 90 - scrollSpeed * 10));
      if (autoButton) autoButton.textContent = '⏸ Autoscroll';
    }

    autoButton?.addEventListener('click', () => scrollTimer ? stopAutoscroll() : startAutoscroll());
    document.getElementById('speedDown')?.addEventListener('click', () => {
      scrollSpeed = Math.max(1, scrollSpeed - 1); updateSpeed(); if (scrollTimer) startAutoscroll();
    });
    document.getElementById('speedUp')?.addEventListener('click', () => {
      scrollSpeed = Math.min(8, scrollSpeed + 1); updateSpeed(); if (scrollTimer) startAutoscroll();
    });

    const chromaticSharp = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const enharmonic = {Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#', Bb:'A#'};

    function transposeRoot(root, steps) {
      const normalized = enharmonic[root] || root;
      const index = chromaticSharp.indexOf(normalized);
      if (index < 0) return root;
      return chromaticSharp[(index + steps + 120) % 12];
    }

    const originals = [...reader.querySelectorAll('.chord-root')].map(el => ({el, root: el.textContent.trim()}));
    function renderTranspose() {
      originals.forEach(({el, root}) => { el.textContent = transposeRoot(root, transposeSteps); });
      if (transposeLabel) transposeLabel.textContent = transposeSteps > 0 ? `+${transposeSteps}` : String(transposeSteps);
    }

    document.getElementById('transposeDown')?.addEventListener('click', () => { transposeSteps--; renderTranspose(); });
    document.getElementById('transposeUp')?.addEventListener('click', () => { transposeSteps++; renderTranspose(); });

    function applyFont() {
      fontSize = Math.max(11, Math.min(28, fontSize));
      reader.style.fontSize = `${fontSize}px`;
      localStorage.setItem('bentar_font_size', String(fontSize));
    }
    document.getElementById('fontDown')?.addEventListener('click', () => { fontSize--; applyFont(); });
    document.getElementById('fontUp')?.addEventListener('click', () => { fontSize++; applyFont(); });

    updateSpeed();
    applyFont();
  }

  applyTheme();
  document.addEventListener('DOMContentLoaded', initThemeButton);
  window.BenTar = { initLibraryPage, initReader };
})();
