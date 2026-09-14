(() => {
  const FREETAR = 'https://freetar.de';
  const TAB_PROXY = 'https://tabs.proxy.freetar.de/tab/';

  const state = {
    library: {},
    filter: '',
    scrollTimer: null,
    scrollSpeed: 2,
    transpose: 0,
    fontSize: Number(localStorage.getItem('bentar_font_size') || 16),
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalizeTabPath(value) {
    if (!value) return '';
    try {
      if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
    } catch {}
    if (!value.startsWith('/')) value = '/' + value;
    const i = value.indexOf('/tab/');
    if (i >= 0) value = value.slice(i);
    return value;
  }

  async function loadLibrary() {
    const status = $('libraryStatus');
    try {
      const manifestResponse = await fetch('./static/library/manifest.json', { cache: 'no-store' });
      if (!manifestResponse.ok) throw new Error(`manifest ${manifestResponse.status}`);
      const files = await manifestResponse.json();
      const chunks = await Promise.all(files.map(async (name) => {
        const response = await fetch(`./static/library/${encodeURIComponent(name)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${name} ${response.status}`);
        return response.json();
      }));
      state.library = Object.assign({}, ...chunks);
      status.textContent = `${Object.keys(state.library).length} saved tabs`;
      renderLibrary();
    } catch (error) {
      console.error(error);
      status.textContent = 'Could not load the GitHub library.';
      $('emptyState').hidden = false;
      $('emptyState').textContent = 'BenTar could not load its saved-tabs files from GitHub.';
    }
  }

  function renderLibrary() {
    const list = $('libraryList');
    const empty = $('emptyState');
    const query = state.filter.trim().toLowerCase();
    const songs = Object.values(state.library)
      .filter(song => `${song.artist_name || ''} ${song.song || ''} ${song.type || ''}`.toLowerCase().includes(query))
      .sort((a, b) => (a.artist_name || '').localeCompare(b.artist_name || '') || (a.song || '').localeCompare(b.song || ''));

    list.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const song of songs) {
      const path = normalizeTabPath(song.tab_url);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'song-row';
      button.dataset.path = path;
      button.innerHTML = `
        <span>
          <span class="song-name">${escapeHtml(song.song || 'Unknown song')}</span>
          <span class="song-artist">${escapeHtml(song.artist_name || 'Unknown artist')}</span>
        </span>
        <span class="song-type">${escapeHtml(song.type || 'Tab')}</span>`;
      button.addEventListener('click', () => openReader(path, true));
      fragment.appendChild(button);
    }
    list.appendChild(fragment);
    empty.hidden = songs.length !== 0;
    empty.textContent = query ? 'No saved tabs match that search.' : 'No saved tabs found.';
  }

  function stopAutoscroll() {
    if (state.scrollTimer) clearInterval(state.scrollTimer);
    state.scrollTimer = null;
    $('autoScroll').textContent = '▶ Auto';
  }

  function startAutoscroll() {
    stopAutoscroll();
    state.scrollTimer = setInterval(() => window.scrollBy(0, 1), Math.max(12, 100 - state.scrollSpeed * 11));
    $('autoScroll').textContent = '⏸ Auto';
  }

  function showLibrary(push = false) {
    stopAutoscroll();
    $('readerView').hidden = true;
    $('libraryView').hidden = false;
    $('libraryFilter').hidden = false;
    document.title = 'BenTar';
    if (push) history.pushState({}, '', location.pathname);
    window.scrollTo(0, 0);
  }

  function showReaderShell() {
    $('libraryView').hidden = true;
    $('readerView').hidden = false;
    $('libraryFilter').hidden = true;
    $('readerLoading').hidden = false;
    $('readerContent').hidden = true;
    $('readerError').hidden = true;
    window.scrollTo(0, 0);
  }

  function formatTab(raw) {
    let text = String(raw || '')
      .replaceAll('\\r\\n', '\n')
      .replaceAll('\\n', '\n')
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n');
    text = escapeHtml(text);
    text = text.replace(/\[ch\]([^[]+?)\[\/ch\]/gi, (_, chordText) => {
      const chord = chordText.trim();
      const parts = chord.split('/');
      const main = parts[0];
      const bass = parts[1];
      const match = main.match(/^([A-G](?:#|b)?)(.*)$/);
      if (!match) return `<span class="chord">${escapeHtml(chord)}</span>`;
      const [, root, quality] = match;
      let out = `<span class="chord"><span class="chord-root" data-original="${root}">${root}</span>${quality}`;
      if (bass) out += `/<span class="chord-root" data-original="${bass}">${bass}</span>`;
      return out + '</span>';
    });
    text = text.replaceAll('[tab]', '').replaceAll('[/tab]', '');
    text = text.replaceAll(' ', '&nbsp;').replaceAll('\n', '<br>');
    return text;
  }

  function parseSong(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const store = doc.querySelector('div.js-store');
    if (!store) throw new Error('No Freetar/UG song payload was found.');
    const data = JSON.parse(store.getAttribute('data-content'));
    const page = data.store.page.data;
    const tab = page.tab;
    const view = page.tab_view;
    const meta = view.meta && typeof view.meta === 'object' ? view.meta : {};
    const tuningData = meta.tuning;
    const tuning = tuningData && typeof tuningData === 'object'
      ? [tuningData.value, tuningData.name && `(${tuningData.name})`].filter(Boolean).join(' ')
      : null;
    return {
      artist: tab.artist_name || 'Unknown artist',
      title: tab.song_name || 'Unknown song',
      version: Number(tab.version || 1),
      difficulty: view.ug_difficulty || null,
      capo: meta.capo || null,
      tuning,
      tabUrl: tab.tab_url || null,
      content: view.wiki_tab?.content || '',
    };
  }

  async function fetchSong(path) {
    const proxyPath = normalizeTabPath(path).replace(/^\/tab\//, '');
    const response = await fetch(TAB_PROXY + proxyPath, { mode: 'cors', cache: 'no-store' });
    if (!response.ok) throw new Error(`Freetar proxy returned ${response.status}`);
    return parseSong(await response.text());
  }

  async function openReader(path, push = false) {
    path = normalizeTabPath(path);
    if (!path.startsWith('/tab/')) return;
    showReaderShell();
    if (push) history.pushState({ tab: path }, '', `?tab=${encodeURIComponent(path)}`);

    $('openFreetar').href = FREETAR + path;
    try {
      const song = await fetchSong(path);
      $('songTitle').textContent = song.title + (song.version > 1 ? ` (ver ${song.version})` : '');
      $('songArtist').textContent = song.artist;
      document.title = `${song.artist} — ${song.title} | BenTar`;

      const meta = [];
      if (song.difficulty) meta.push(`<span>Difficulty: ${escapeHtml(song.difficulty)}</span>`);
      meta.push(`<span>Capo: ${song.capo ? escapeHtml(song.capo) : 'none'}</span>`);
      if (song.tuning) meta.push(`<span>Tuning: ${escapeHtml(song.tuning)}</span>`);
      $('songMeta').innerHTML = meta.join('');

      const reader = $('tabReader');
      reader.innerHTML = formatTab(song.content);
      reader.style.fontSize = `${state.fontSize}px`;
      state.transpose = 0;
      $('transposeLabel').textContent = '0';
      $('speedLabel').textContent = String(state.scrollSpeed);

      $('readerLoading').hidden = true;
      $('readerContent').hidden = false;
    } catch (error) {
      console.error('BenTar reader error:', error);
      $('readerLoading').hidden = true;
      $('readerError').hidden = false;
    }
  }

  const sharpScale = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const enharmonic = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
  function transposeRoot(root, steps) {
    const normalized = enharmonic[root] || root;
    const index = sharpScale.indexOf(normalized);
    return index < 0 ? root : sharpScale[(index + steps + 120) % 12];
  }

  function applyTranspose() {
    document.querySelectorAll('#tabReader .chord-root').forEach(el => {
      el.textContent = transposeRoot(el.dataset.original || el.textContent, state.transpose);
    });
    $('transposeLabel').textContent = state.transpose > 0 ? `+${state.transpose}` : String(state.transpose);
  }

  function applyFont(delta) {
    state.fontSize = Math.max(11, Math.min(30, state.fontSize + delta));
    $('tabReader').style.fontSize = `${state.fontSize}px`;
    localStorage.setItem('bentar_font_size', String(state.fontSize));
  }

  function bindControls() {
    $('libraryFilter').addEventListener('input', (event) => {
      state.filter = event.target.value;
      renderLibrary();
    });
    $('homeButton').addEventListener('click', () => showLibrary(true));
    $('backButton').addEventListener('click', () => showLibrary(true));
    $('errorBackButton').addEventListener('click', () => showLibrary(true));
    $('autoScroll').addEventListener('click', () => state.scrollTimer ? stopAutoscroll() : startAutoscroll());
    $('speedDown').addEventListener('click', () => {
      state.scrollSpeed = Math.max(1, state.scrollSpeed - 1);
      $('speedLabel').textContent = String(state.scrollSpeed);
      if (state.scrollTimer) startAutoscroll();
    });
    $('speedUp').addEventListener('click', () => {
      state.scrollSpeed = Math.min(8, state.scrollSpeed + 1);
      $('speedLabel').textContent = String(state.scrollSpeed);
      if (state.scrollTimer) startAutoscroll();
    });
    $('transposeDown').addEventListener('click', () => { state.transpose--; applyTranspose(); });
    $('transposeUp').addEventListener('click', () => { state.transpose++; applyTranspose(); });
    $('fontDown').addEventListener('click', () => applyFont(-1));
    $('fontUp').addEventListener('click', () => applyFont(1));
    window.addEventListener('popstate', () => routeFromUrl());
  }

  function routeFromUrl() {
    const path = new URLSearchParams(location.search).get('tab');
    if (path) openReader(path, false);
    else showLibrary(false);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindControls();
    await loadLibrary();
    routeFromUrl();
  });
})();
