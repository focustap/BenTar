(() => {
  'use strict';

  const BUILD = '20260914e';
  const DIRECTORY_API = 'https://api.github.com/repos/focustap/BenTar/contents/raw-tabs?ref=main';
  const LIBRARY_CACHE_KEY = 'bentar_raw_tabs_index_v1';
  const SPEEDS = [0.15, 0.25, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4.5, 6, 8, 11, 15, 20, 28];
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

  function normalizedSearch(value) {
    return String(value || '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function normalizeType(value) {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (/ukulele/i.test(raw)) return 'Ukulele Chords';
    if (/bass/i.test(raw)) return 'Bass Tab';
    if (/^tabs?$/i.test(raw)) return 'Tab';
    return 'Chords';
  }

  function parseSavedFilename(name) {
    let stem = String(name || '').replace(/\.html?$/i, '');
    stem = stem.replace(/-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/i, '');
    stem = stem.replace(/^(?:tabs\.ultimate-guitar\.com|page)(?:-\(\d+\))?\s*/i, '');
    stem = stem.replace(/^[-\s]+/, '').replace(/^\(\d+\)\s*/, '').trim();

    const byParts = stem.split(/\s+by\s+/i);
    let left = (byParts.shift() || stem).trim();
    let artist = byParts.join(' by ').trim();
    artist = artist
      .replace(/\s+@\s+Ultimate-Guitar\.Com.*$/i, '')
      .replace(/\s+@\s+Ultimate-Guit.*$/i, '')
      .trim();

    const typeMatch = left.match(/^(.*?)\s+(UKULELE\s+CHORDS?|BASS\s+TABS?|CHORDS?|TABS?)(?:\s+\(ver\s+(\d+)\))?$/i);
    const title = (typeMatch?.[1] || left || 'Unknown song').trim();
    const type = normalizeType(typeMatch?.[2] || 'Chords');
    const version = typeMatch?.[3] || '';

    return {
      title,
      artist: artist || 'Unknown artist',
      type,
      version,
    };
  }

  function dedupeKey(song) {
    return [song.title, song.artist, song.type, song.version || '']
      .map(value => String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim())
      .join('|');
  }

  function cachedDirectory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LIBRARY_CACHE_KEY) || 'null');
      return Array.isArray(parsed?.files) ? parsed.files : null;
    } catch {
      return null;
    }
  }

  function saveDirectoryCache(files) {
    try {
      localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), files }));
    } catch {
      // Storage is only a fallback; the live directory remains the source of truth.
    }
  }

  async function fetchRawDirectory() {
    try {
      const response = await fetch(`${DIRECTORY_API}&_=${BUILD}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`GitHub library listing returned ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('GitHub returned an unexpected library listing.');
      const files = data
        .filter(item => item?.type === 'file' && /\.html?$/i.test(item.name || ''))
        .map(item => ({
          name: item.name,
          sha: item.sha,
          size: Number(item.size || 0),
          download_url: item.download_url || '',
        }));
      saveDirectoryCache(files);
      return files;
    } catch (error) {
      const cached = cachedDirectory();
      if (cached?.length) return cached;
      throw error;
    }
  }

  async function loadLibrary() {
    const files = await fetchRawDirectory();
    const unique = new Map();

    for (const file of files) {
      const parsed = parseSavedFilename(file.name);
      const song = {
        id: String(file.sha || file.name),
        fileName: file.name,
        fileSize: Number(file.size || 0),
        downloadUrl: file.download_url || '',
        ...parsed,
      };
      const key = dedupeKey(song);
      const previous = unique.get(key);
      if (!previous || song.fileSize > previous.fileSize) unique.set(key, song);
    }

    state.songs = [...unique.values()].sort((a, b) =>
      (a.artist || '').localeCompare(b.artist || '') ||
      (a.title || '').localeCompare(b.title || '') ||
      (a.version || '').localeCompare(b.version || '')
    );
    state.byId = new Map(state.songs.map(song => [String(song.id), song]));

    const sourceText = files.length === state.songs.length
      ? `${state.songs.length} saved tabs`
      : `${state.songs.length} unique tabs from ${files.length} saved pages`;
    $('libraryStatus').textContent = sourceText;
    renderLibrary();
  }

  function renderLibrary() {
    const list = $('libraryList');
    const empty = $('emptyState');
    const query = normalizedSearch(state.filter);
    const terms = query ? query.split(/\s+/) : [];

    const songs = state.songs.filter(song => {
      if (!terms.length) return true;
      const hay = normalizedSearch(`${song.title} ${song.artist} ${song.type || ''} ${song.version ? `version ${song.version}` : ''}`);
      return terms.every(term => hay.includes(term));
    });

    list.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const song of songs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'song-row';
      button.dataset.id = song.id;
      const capo = song.capoText && !/^no capo$/i.test(song.capoText)
        ? `<span class="capo-dot">Capo ${escapeHtml(song.capoText.replace(/\s*fret$/i, ''))}</span>`
        : '';
      const version = song.version ? ` v${escapeHtml(song.version)}` : '';
      button.innerHTML = `
        <span class="song-main">
          <span class="song-name">${escapeHtml(song.title || 'Unknown song')}</span>
          <span class="song-artist">${escapeHtml(song.artist || 'Unknown artist')}</span>
        </span>
        <span class="song-side">${capo}<span class="song-type">${escapeHtml(song.type || 'Chords')}${version}</span></span>`;
      button.addEventListener('click', () => openReader(song.id, true));
      fragment.appendChild(button);
    }
    list.appendChild(fragment);
    empty.hidden = songs.length !== 0;
    empty.textContent = query ? 'No saved tabs match that search.' : 'No saved tabs found.';
  }

  function labeledMeta(doc, label) {
    const wanted = String(label || '').toLocaleLowerCase();
    for (const row of doc.querySelectorAll('tr')) {
      const th = row.querySelector('th');
      const td = row.querySelector('td');
      if (!th || !td) continue;
      const heading = th.textContent.replace(/:/g, '').trim().toLocaleLowerCase();
      if (heading === wanted) return td.textContent.trim();
    }
    return '';
  }

  function cleanHeaderTitle(value) {
    return String(value || '')
      .replace(/\s+(?:UKULELE\s+CHORDS?|BASS\s+TABS?|CHORDS?|TABS?)(?:\s+\(ver\s+\d+\))?\s*$/i, '')
      .trim();
  }

  function chooseTabPre(doc) {
    const candidates = [...doc.querySelectorAll('pre')];
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const aScore = a.querySelectorAll('span[data-name]').length * 10000 + (a.textContent || '').length;
      const bScore = b.querySelectorAll('span[data-name]').length * 10000 + (b.textContent || '').length;
      return bScore - aScore;
    });
    return candidates[0];
  }

  function serializeTabPre(root) {
    let out = '';

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue || '';
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const el = node;
      if (el.classList?.contains('d8c-l')) return;
      if (el.matches?.('span[data-name]')) {
        const chord = (el.getAttribute('data-name') || el.textContent || '').trim();
        if (chord) out += `[ch]${chord}[/ch]`;
        return;
      }
      if (el.tagName === 'BR') {
        out += '\n';
        return;
      }
      for (const child of el.childNodes) walk(child);
    }

    walk(root);
    return out.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{5,}/g, '\n\n\n\n').replace(/\s+$/, '');
  }

  function parseSavedPage(html, shell) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const pre = chooseTabPre(doc);
    if (!pre) throw new Error('This saved page does not contain a readable tab section.');

    const header = doc.querySelector('header.ygsMD') || doc.querySelector('header');
    const exactTitle = cleanHeaderTitle(header?.querySelector('h1')?.textContent || doc.querySelector('h1.giatc')?.textContent || '');
    const artist = header?.querySelector('.nGwD6 a')?.textContent?.trim() || shell.artist;
    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
    const content = serializeTabPre(pre);
    if (!content.trim()) throw new Error('The saved chord sheet is empty.');

    return {
      title: exactTitle || shell.title,
      artist: artist || shell.artist,
      capoText: doc.querySelector('#capo')?.textContent?.trim() || labeledMeta(doc, 'Capo') || 'No capo',
      tuning: doc.querySelector('#tuning')?.textContent?.trim() || labeledMeta(doc, 'Tuning'),
      difficulty: doc.querySelector('#difficulty')?.textContent?.trim() || labeledMeta(doc, 'Difficulty'),
      key: labeledMeta(doc, 'Key'),
      source: /^https?:\/\//i.test(canonical) ? canonical : '',
      content,
      loaded: true,
    };
  }

  async function loadSong(id) {
    const song = state.byId.get(String(id));
    if (!song) throw new Error('Song is not in the saved library.');
    if (song.loaded && song.content) return song;

    const localUrl = `./raw-tabs/${encodeURIComponent(song.fileName)}`;
    let response = await fetch(localUrl, { cache: 'force-cache' });
    if (!response.ok && song.downloadUrl) {
      response = await fetch(song.downloadUrl, { cache: 'force-cache' });
    }
    if (!response.ok) throw new Error(`Saved page returned ${response.status}`);

    const html = await response.text();
    Object.assign(song, parseSavedPage(html, song));
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
    renderLibrary();
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
      await loadLibrary();
      routeFromUrl();
    } catch (error) {
      console.error(error);
      $('libraryStatus').textContent = 'Could not load the saved library.';
      $('emptyState').hidden = false;
      $('emptyState').textContent = error?.message || 'BenTar could not load its saved tab files.';
    }
  });
})();
