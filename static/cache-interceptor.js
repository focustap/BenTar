(() => {
  const FREETAR_PROXY_PREFIX = 'https://tabs.proxy.freetar.de/tab/';
  const nativeFetch = window.fetch.bind(window);
  let manifestPromise = null;

  function loadManifest() {
    if (!manifestPromise) {
      manifestPromise = nativeFetch('./static/chords/manifest.json', { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`Chord cache manifest returned ${response.status}`);
          return response.json();
        })
        .then(data => data.songs || {});
    }
    return manifestPromise;
  }

  function escapeAttribute(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function asFreetarHtml(song) {
    const payload = {
      store: {
        page: {
          data: {
            tab: {
              artist_name: song.artist || 'Unknown artist',
              song_name: song.title || 'Unknown song',
              version: Number(song.version || 1),
              tab_url: song.tabUrl || null,
            },
            tab_view: {
              ug_difficulty: song.difficulty || null,
              meta: {
                capo: song.capo || null,
                tuning: song.tuning ? { value: song.tuning } : null,
              },
              wiki_tab: {
                content: song.content || '',
              },
            },
          },
        },
      },
    };

    return `<div class="js-store" data-content="${escapeAttribute(JSON.stringify(payload))}"></div>`;
  }

  window.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    if (!rawUrl || !rawUrl.startsWith(FREETAR_PROXY_PREFIX)) {
      return nativeFetch(input, init);
    }

    try {
      const path = new URL(rawUrl).pathname;
      const manifest = await loadManifest();
      const filename = manifest[path];
      if (!filename) {
        return new Response('Not cached', { status: 404, statusText: 'Not cached' });
      }

      const cachedResponse = await nativeFetch(`./static/chords/${encodeURIComponent(filename)}`, {
        cache: 'no-store',
      });
      if (!cachedResponse.ok) {
        return new Response('Cached tab missing', {
          status: cachedResponse.status,
          statusText: 'Cached tab missing',
        });
      }

      const song = await cachedResponse.json();
      return new Response(asFreetarHtml(song), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (error) {
      console.error('BenTar cache intercept error:', error);
      return new Response('Chord cache unavailable', {
        status: 503,
        statusText: 'Chord cache unavailable',
      });
    }
  };
})();
