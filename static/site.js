(() => {
  'use strict';

  const BUILD = '20260914d';
  const SPEEDS = [0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4.5, 6, 8, 11, 15, 20, 28];
  const SHARP_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_SCALE = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const NOTE_INDEX = { C:0, 'B#':0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4, Fb:4, 'E#':5, F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8, A:9, 'A#':10, Bb:10, B:11, Cb:11 };

  const state = {
    songs: [],
    byId: new Map(),
    filter: '',
    currentSong: null,
    transpose: 0,
    fontSize: clampNumber(Number(localStorage.getItem('bentar_font_size') || 16), 11, 30),
    speedIndex: Math.round(clampNumber(Number(localStorage.getItem('bentar_speed_index') || 5), 0, SPEEDS.length - 1)),
    autoRunning: false,
    autoFrame: 0,
    lastFrameAt: 0,
    scrollCarry: 0,
  };

  const $ = (id) => document.getElementById(id);

  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function loadManifest() {
    const response = await fetch(`./static/data/manifest.json?v=${BUILD}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Library manifest returned ${response.status}`);
    const manifest = await response.json();
    const partNames = Array.isArray(manifest.parts) ? manifest.parts : [];
    if (!partNames.length) throw new Error('The saved-library data parts are missing.');

    const encodedParts = await Promise.all(partNames.map(async name => {
      const partResponse = await fetch(`./static/data/${encodeURIComponent(name)}?v=${BUILD}`, { cache: 'force-cache' });
      if (!partResponse.ok) throw new Error(`${name} returned ${partResponse.status}`);
      return (await partResponse.text()).trim();
    }));

    const songsById = await decodeLibrary(encodedParts.join(''));
    state.songs = Object.values(songsById).sort((a, b) =>
      (a.artist || '').localeCompare(b.artist || '') || (a.title || '').localeCompare(b.title || '')
    );
    state.byId = new Map(state.songs.map(song => [String(song.id), song]));
    $('libraryStatus').textContent = `${state.songs.length} unique tabs from ${manifest.sourceFiles || state.songs.length} saved pages`;
    renderLibrary();
  }

  async function decodeLibrary(encoded) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This browser does not support the saved-library decoder.');
    }
    const binary = atob(encoded);
    const compressed = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) compressed[i] = binary.charCodeAt(i);
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text);
  }

  function normalizedSearch(value) {
    return String(value || '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function renderLibrary() {
    const list = $('libraryList');
    const empty = $('emptyState');
    const query = normalizedSearch(state.filter);
    const terms = query ? query.split(/\s+/) : [];

    const songs = state.songs.filter(song => {
      if (!terms.length) return true;
      const hay = normalizedSearch(`${song.title} ${song.artist} ${song.type || ''}`);
      return terms.every(term => hay.includes(term));
    });

    list.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const song of songs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'song-row';
      button.dataset.id = song.id;
      const capo = song.capoText && !/^no capo$/i.test(song.capoText) ? `<span class="capo-dot">Capo ${escapeHtml(song.capoText.replace(/\s*fret$/i, ''))}</span>` : '';
      button.innerHTML = `
        <span class="song-main">
          <span class="song-name">${escapeHtml(song.title || 'Unknown song')}</span>
          <span class="song-artist">${escapeHtml(song.artist || 'Unknown artist')}</span>
        </span>
        <span class="song-side">${capo}<span class="song-type">${escapeHtml(song.type || 'Chords')}</span></span>`;
      button.addEventListener('click', () => openReader(song.id, true));
      fragment.appendChild(button);
    }
    list.appendChild(fragment);
    empty.hidden = songs.length !== 0;
    empty.textContent = query ? 'No saved tabs match that search.' : 'No saved tabs found.';
  }

  async function loadSong(id) {
    const song = state.byId.get(String(id));
    if (!song) throw new Error('Song is not in the saved library.');
    return song;
  }

  function showLibrary(push = false) {
    stopAutoscroll();
    state.currentSong = null;
    $('readerView').hidden = true;
    $('libraryView').hidden = false;
    $('libraryFilter').hidden = false;
    document.title = 'BenTar';
    if (push) history.pushState({}, '', location.pathname);
    window.scrollTo(0, 0);
  }

  function showReaderShell() {
    stopAutoscroll();
    $('libraryView').hidden = true;
    $('readerView').hidden = false;
    $('libraryFilter').hidden = true;
    $('readerLoading').hidden = false;
    $('readerContent').hidden = true;
    $('readerError').hidden = true;
    window.scrollTo(0, 0);
  }

  function formatCapo(song) {
    if (song.capoText) return song.capoText;
    if (Number(song.capo) > 0) return `${song.capo} fret`;
    return 'No capo';
  }

  function renderMeta(song) {
    const chips = [];
    chips.push(`<span class="meta-chip capo"><strong>Capo</strong> ${escapeHtml(formatCapo(song))}</span>`);
    if (song.tuning) chips.push(`<span class="meta-chip"><strong>Tuning</strong> ${escapeHtml(song.tuning)}</span>`);
    if (song.key) chips.push(`<span class="meta-chip"><strong>Key</strong> ${escapeHtml(song.key)}</span>`);
    if (song.difficulty) chips.push(`<span class="meta-chip"><strong>Difficulty</strong> ${escapeHtml(song.difficulty)}</span>`);
    if (song.source) chips.push(`<span class="meta-chip"><a class="meta-link" href="${escapeHtml(song.source)}" target="_blank" rel="noopener">Original ↗</a></span>`);
    $('songMeta').innerHTML = chips.join('');
  }

  function chordHtml(original) {
    return `<span class="chord" data-chord="${escapeHtml(original)}">${escapeHtml(transposeChord(original, state.transpose))}</span>`;
  }

  function renderChordSheet(song) {
    const reader = $('tabReader');
    const raw = String(song.content || '').replace(/\r\n?/g, '\n');
    const parts = [];
    let last = 0;
    const chordPattern = /\[ch\]([\s\S]*?)\[\/ch\]/gi;
    let match;
    while ((match = chordPattern.exec(raw))) {
      parts.push(escapeHtml(raw.slice(last, match.index)));
      parts.push(chordHtml(match[1].trim()));
      last = chordPattern.lastIndex;
    }
    parts.push(escapeHtml(raw.slice(last)));
    let rendered = parts.join('');
    rendered = rendered.replace(/(^|\n)(\[[^\]\n]{1,40}\])/g, '$1<span class="section-tag">$2</span>');
    reader.innerHTML = rendered;
    reader.style.fontSize = `${state.fontSize}px`;
  }

  async function openReader(id, push = false) {
    showReaderShell();
    if (push) history.pushState({ song: String(id) }, '', `?song=${encodeURIComponent(id)}`);
    try {
      const song = await loadSong(id);
      state.currentSong = song;
      state.transpose = 0;
      $('transposeReset').textContent = '0';
      $('songTitle').textContent = song.title || 'Unknown song';
      $('songArtist').textContent = song.artist || 'Unknown artist';
      document.title = `${song.title} — ${song.artist} | BenTar`;
      renderMeta(song);
      renderChordSheet(song);
      updateSpeedLabel();
      $('readerLoading').hidden = true;
      $('readerContent').hidden = false;
    } catch (error) {
      console.error('BenTar reader error:', error);
      $('readerLoading').hidden = true;
      $('readerError').hidden = false;
      $('readerErrorText').textContent = error?.message || 'The saved tab data could not be loaded.';
    }
  }

  function preferFlats(song, chord) {
    return /b/.test(chord) || /b/.test(song?.key || '');
  }

  function transposeNote(note, steps, useFlats) {
    const index = NOTE_INDEX[note];
    if (index === undefined) return note;
    const scale = useFlats ? FLAT_SCALE : SHARP_SCALE;
    return scale[(index + steps + 1200) % 12];
  }

  function transposeChord(chord, steps) {
    if (!steps || !chord) return chord;
    const text = String(chord);
    const mainMatch = text.match(/^([A-G](?:#|b)?)(.*)$/);
    if (!mainMatch) return text;
    const useFlats = preferFlats(state.currentSong, text);
    const root = transposeNote(mainMatch[1], steps, useFlats);
    let rest = mainMatch[2];
    rest = rest.replace(/\/([A-G](?:#|b)?)$/, (_, bass) => `/${transposeNote(bass, steps, useFlats || /b/.test(bass))}`);
    return root + rest;
  }

  function applyTranspose(delta) {
    state.transpose = clampNumber(state.transpose + delta, -12, 12);
    document.querySelectorAll('#tabReader .chord[data-chord]').forEach(el => {
      el.textContent = transposeChord(el.dataset.chord, state.transpose);
    });
    $('transposeReset').textContent = state.transpose > 0 ? `+${state.transpose}` : String(state.transpose);
  }

  function resetTranspose() {
    state.transpose = 0;
    document.querySelectorAll('#tabReader .chord[data-chord]').forEach(el => {
      el.textContent = el.dataset.chord;
    });
    $('transposeReset').textContent = '0';
  }

  function applyFont(delta) {
    state.fontSize = clampNumber(state.fontSize + delta, 11, 30);
    $('tabReader').style.fontSize = `${state.fontSize}px`;
    localStorage.setItem('bentar_font_size', String(state.fontSize));
  }

  function updateSpeedLabel() {
    const speed = SPEEDS[state.speedIndex];
    $('speedLabel').textContent = `${Number.isInteger(speed) ? speed : speed.toFixed(2).replace(/0$/, '')} px/s`;
    localStorage.setItem('bentar_speed_index', String(state.speedIndex));
  }

  function changeSpeed(delta) {
    state.speedIndex = Math.round(clampNumber(state.speedIndex + delta, 0, SPEEDS.length - 1));
    updateSpeedLabel();
  }

  function autoStep(now) {
    if (!state.autoRunning) return;
    if (!state.lastFrameAt) state.lastFrameAt = now;
    const elapsed = Math.min(250, now - state.lastFrameAt);
    state.lastFrameAt = now;
    state.scrollCarry += SPEEDS[state.speedIndex] * elapsed / 1000;
    const pixels = Math.floor(state.scrollCarry);
    if (pixels >= 1) {
      state.scrollCarry -= pixels;
      window.scrollBy(0, pixels);
    }
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) {
      stopAutoscroll();
      return;
    }
    state.autoFrame = requestAnimationFrame(autoStep);
  }

  function startAutoscroll() {
    if (state.autoRunning) return;
    state.autoRunning = true;
    state.lastFrameAt = 0;
    state.scrollCarry = 0;
    $('autoScroll').textContent = '⏸ Auto';
    $('autoScroll').closest('.auto-group')?.classList.add('is-running');
    state.autoFrame = requestAnimationFrame(autoStep);
  }

  function stopAutoscroll() {
    state.autoRunning = false;
    if (state.autoFrame) cancelAnimationFrame(state.autoFrame);
    state.autoFrame = 0;
    state.lastFrameAt = 0;
    state.scrollCarry = 0;
    if ($('autoScroll')) $('autoScroll').textContent = '▶ Auto';
    $('autoScroll')?.closest('.auto-group')?.classList.remove('is-running');
  }

  function bindControls() {
    $('libraryFilter').addEventListener('input', event => {
      state.filter = event.target.value;
      renderLibrary();
    });
    $('homeButton').addEventListener('click', () => showLibrary(true));
    $('backButton').addEventListener('click', () => showLibrary(true));
    $('errorBackButton').addEventListener('click', () => showLibrary(true));

    $('autoScroll').addEventListener('click', () => state.autoRunning ? stopAutoscroll() : startAutoscroll());
    $('speedDown').addEventListener('click', () => changeSpeed(-1));
    $('speedUp').addEventListener('click', () => changeSpeed(1));

    $('transposeDown').addEventListener('click', () => applyTranspose(-1));
    $('transposeUp').addEventListener('click', () => applyTranspose(1));
    $('transposeReset').addEventListener('click', resetTranspose);
    $('fontDown').addEventListener('click', () => applyFont(-1));
    $('fontUp').addEventListener('click', () => applyFont(1));

    window.addEventListener('popstate', routeFromUrl);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopAutoscroll();
    });
  }

  function routeFromUrl() {
    const id = new URLSearchParams(location.search).get('song');
    if (id) openReader(id, false);
    else showLibrary(false);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindControls();
    updateSpeedLabel();
    try {
      await loadManifest();
      routeFromUrl();
    } catch (error) {
      console.error(error);
      $('libraryStatus').textContent = 'Could not load the saved library.';
      $('emptyState').hidden = false;
      $('emptyState').textContent = error?.message || 'BenTar could not load its saved tab data.';
    }
  });
})();
