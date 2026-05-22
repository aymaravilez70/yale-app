/** Plataformas de streaming soportadas vía browser_sync (embed WebView) */
export const STREAMING_PLATFORMS = {
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    homeUrl: 'https://m.youtube.com',
    accent: '#FF0000',
    mode: 'native',
  },
  browser: {
    id: 'browser',
    name: 'Navegador',
    subtitle: 'Cuevana, Netflix y más',
    homeUrl: 'https://duckduckgo.com',
    accent: '#6366f1',
    mode: 'browser_sync',
    defaultTitle: 'Navegador Sincronizado',
    favicon: (url) =>
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
        (url || 'https://duckduckgo.com').replace(/^https?:\/\//, '').split('/')[0]
      )}&sz=128`,
  },
  kick: {
    id: 'kick',
    name: 'Kick',
    subtitle: 'Streams en vivo sincronizados',
    homeUrl: 'https://kick.com',
    accent: '#53FC18',
    mode: 'browser_sync',
    defaultTitle: 'Kick',
    favicon: () =>
      'https://www.google.com/s2/favicons?domain=kick.com&sz=128',
    matchHost: (host) => /kick\.com$/i.test(host) || host.endsWith('.kick.com'),
  },
};

export function getStreamingPlatform(id) {
  return STREAMING_PLATFORMS[id] || STREAMING_PLATFORMS.browser;
}

export function buildBrowserSyncVideo({ url, title, poster, platformId = 'browser' }) {
  const platform = getStreamingPlatform(platformId);
  return {
    id: 'browser_sync',
    titulo: title || platform.defaultTitle,
    miniatura: poster || platform.favicon(url),
    browserUrl: url,
    browserPlatform: platformId,
  };
}

/** Solo dispara KICK_STREAM_DETECTED en canal con stream EN VIVO (no categorías). */
export const KICK_LIVE_DETECT_SCRIPT = `
(function() {
  var lastSentKey = null;
  var BLOCKED = {
    categories:1, category:1, browse:1, discover:1, videos:1, video:1,
    following:1, settings:1, dashboard:1, login:1, signup:1, search:1,
    clips:1, popular:1, trending:1, tags:1, about:1, privacy:1, terms:1,
    guidelines:1, partners:1, ads:1, community:1, help:1, support:1
  };

  function channelSlugFromUrl(url) {
    try {
      var u = new URL(url);
      var host = u.hostname.toLowerCase();
      if (host !== 'kick.com' && !host.endsWith('.kick.com')) return null;
      var parts = u.pathname.replace(/^\\/+|\\/+$/g, '').split('/').filter(Boolean);
      if (parts.length !== 1) return null;
      var slug = parts[0].toLowerCase();
      if (BLOCKED[slug] || !/^[a-z0-9_-]{2,}$/i.test(slug)) return null;
      return slug;
    } catch (e) { return null; }
  }

  function pageShowsLive() {
    var body = document.body;
    if (!body) return false;
    var text = body.innerText || '';
    if (/\\b(offline|not live|no está en vivo)\\b/i.test(text)) return false;

    var nodes = document.querySelectorAll('span, div, p, strong, a');
    for (var i = 0; i < nodes.length && i < 200; i++) {
      var el = nodes[i];
      var t = (el.textContent || '').trim();
      if (t === 'LIVE' || t === 'Live' || t === 'EN VIVO' || t === 'En vivo') {
        var r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 48) return true;
      }
    }

    var video = document.querySelector('video');
    if (video && video.readyState >= 2) {
      if (/\\bLIVE\\b|\\bEN VIVO\\b/i.test(text)) return true;
      if (!video.paused && video.currentTime > 0) return true;
    }
    return false;
  }

  function checkKickLive() {
    try {
      var url = window.location.href;
      var channel = channelSlugFromUrl(url);
      if (!channel) {
        lastSentKey = null;
        return;
      }
      if (!pageShowsLive()) return;

      var cleanUrl = url.split('?')[0].split('#')[0];
      var key = channel + ':' + cleanUrl;
      if (key === lastSentKey) return;
      lastSentKey = key;

      var title = (document.title || channel)
        .replace(/\\s*-\\s*Kick.*$/i, '')
        .replace(/\\s*\\|\\s*Kick.*$/i, '')
        .trim() || channel;

      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'KICK_STREAM_DETECTED',
        url: cleanUrl,
        channel: channel,
        title: title,
        isLive: true
      }));
    } catch (e) {}
  }

  setInterval(checkKickLive, 2000);
  document.addEventListener('DOMContentLoaded', checkKickLive);
  window.addEventListener('load', checkKickLive);
  try {
    var obs = new MutationObserver(checkKickLive);
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  checkKickLive();
})();
true;
`;
