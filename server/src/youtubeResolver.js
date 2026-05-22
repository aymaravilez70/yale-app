const fs = require('fs');
const path = require('path');
const os = require('os');
const NodeCache = require('node-cache');
const youtubedl = require('youtube-dl-exec');

const streamUrlCache = new NodeCache({ stdTTL: 1800, checkperiod: 300 });

const INNERTUBE_CLIENTS = ['IOS', 'MWEB', 'ANDROID', 'WEB', 'TV_EMBEDDED', 'WEB_CREATOR'];

const PIPED_API_BASES = (process.env.PIPED_API_URLS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

const DEFAULT_PIPED_BASES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi-libre.kavin.rocks',
  'https://piped-api.privacy.com.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.leptons.xyz',
];

let Innertube;
let ytInstance = null;
let cookiesFilePath = null;

function resolveCookiesPath() {
  if (process.env.YOUTUBE_COOKIE_FILE) {
    return process.env.YOUTUBE_COOKIE_FILE;
  }
  const b64 = process.env.YOUTUBE_COOKIES_B64;
  if (!b64) return null;
  if (cookiesFilePath && fs.existsSync(cookiesFilePath)) return cookiesFilePath;
  const target = path.join(os.tmpdir(), 'yale-youtube-cookies.txt');
  fs.writeFileSync(target, Buffer.from(b64, 'base64').toString('utf8'), 'utf8');
  cookiesFilePath = target;
  return cookiesFilePath;
}

async function getYoutubeInstance(forceNew = false) {
  if (forceNew) ytInstance = null;
  if (!ytInstance) {
    if (!Innertube) {
      const module = await import('youtubei.js');
      Innertube = module.Innertube;
      const Platform = module.Platform;
      const vm = require('vm');
      if (Platform?.shim) {
        Platform.shim.eval = (code, env) => {
          const wrappedCode = `(() => { ${code.output} })()`;
          return vm.runInNewContext(wrappedCode, env);
        };
      }
    }
    ytInstance = await Innertube.create({ generate_session_locally: true });
  }
  return ytInstance;
}

function resetYoutubeInstance() {
  ytInstance = null;
}

function pickCombinedFormat(info) {
  if (!info?.streaming_data) return null;

  let format = null;
  try {
    format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
  } catch {
    format = null;
  }

  if (!format || format.has_audio === false) {
    const combined = (info.streaming_data.formats || [])
      .filter((f) => f.has_video && f.has_audio)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    format = combined[0] || null;
  }

  if (!format) {
    try {
      format = info.chooseFormat({ type: 'video+audio', quality: '360p' });
    } catch {
      format = null;
    }
  }

  if (!format || format.has_audio === false) return null;
  return format;
}

async function resolveWithInnertube(videoId) {
  const yt = await getYoutubeInstance();
  let lastReason = 'Streaming data not available';

  for (const client of INNERTUBE_CLIENTS) {
    try {
      const info = await yt.getInfo(videoId, { client });
      const status = info.playability_status?.status;
      const reason =
        info.playability_status?.reason || info.playability_status?.error_screen?.reason?.text;

      if (status && status !== 'OK') {
        lastReason = reason || status;
        console.warn(`⚠️ YouTube [${client}] ${videoId}: ${status} — ${lastReason}`);
        continue;
      }

      const format = pickCombinedFormat(info);
      if (!format) {
        lastReason = 'No hay formato video+audio';
        continue;
      }

      const streamUrl = await format.decipher(yt.session.player);
      if (!streamUrl) {
        lastReason = 'No se pudo descifrar URL';
        continue;
      }

      console.log(`✅ Stream InnerTube [${client}] ${videoId} (${format.quality_label || format.itag})`);
      return streamUrl;
    } catch (err) {
      lastReason = err.message || String(err);
      console.warn(`⚠️ YouTube [${client}] ${videoId}: ${lastReason}`);
    }
  }

  throw new Error(lastReason);
}

function buildYtDlpBaseOpts() {
  const opts = {
    noWarnings: true,
    noPlaylist: true,
    socketTimeout: 30,
    retries: 3,
  };
  const cookies = resolveCookiesPath();
  if (cookies) {
    opts.cookies = cookies;
  }
  return opts;
}

function logCookiesStatus() {
  const cookiesPath = resolveCookiesPath();
  if (!cookiesPath) {
    console.log('🍪 Cookies: no configuradas');
    return;
  }
  try {
    const content = fs.readFileSync(cookiesPath, 'utf8');
    const hasYoutube =
      content.includes('.youtube.com') ||
      content.includes('youtube.com\t') ||
      content.includes('youtube.com ');
    console.log(
      `🍪 Cookies: ${cookiesPath}, bytes=${content.length}, youtube=${hasYoutube ? 'sí' : 'NO — exporta de nuevo'}`
    );
  } catch (e) {
    console.warn(`🍪 Cookies: no se pudo leer (${e.message})`);
  }
}

/** Elige URL directa del JSON de yt-dlp sin usar -f (evita "format not available"). */
function pickUrlFromYtDlpMeta(meta) {
  if (meta?.url) return { url: meta.url, formatId: meta.format_id, via: 'meta.url' };

  const formats = meta?.formats || [];
  const combined = formats
    .filter((f) => f?.url && f.acodec !== 'none' && f.vcodec !== 'none')
    .sort((a, b) => {
      const dh = (b.height || 0) - (a.height || 0);
      if (dh !== 0) return dh;
      return (b.tbr || b.vbr || 0) - (a.tbr || a.vbr || 0);
    });
  if (combined[0]?.url) {
    return { url: combined[0].url, formatId: combined[0].format_id, via: 'formats muxed' };
  }

  const audioOnly = formats
    .filter((f) => f?.url && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
    .sort((a, b) => (b.abr || 0) - (a.abr || 0));
  if (audioOnly[0]?.url) {
    return { url: audioOnly[0].url, formatId: audioOnly[0].format_id, via: 'audio only' };
  }

  return null;
}

async function fetchYtDlpJson(watchUrl, extraOpts = {}) {
  const opts = {
    ...buildYtDlpBaseOpts(),
    dumpSingleJson: true,
    ...extraOpts,
  };
  delete opts.format;
  return youtubedl(watchUrl, opts);
}

async function resolveWithYtDlp(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const errors = [];
  console.log(`🎬 Stream yt-dlp: ${videoId}`);
  logCookiesStatus();

  const clientArgs = [
    process.env.YOUTUBE_YTDLP_EXTRACTOR_ARGS,
    'youtube:player_client=android,web',
    'youtube:player_client=ios',
    'youtube:player_client=tv_embedded',
    'youtube:player_client=mweb',
  ].filter(Boolean);

  for (const extractorArgs of clientArgs) {
    try {
      const meta = await fetchYtDlpJson(watchUrl, { extractorArgs });
      const picked = pickUrlFromYtDlpMeta(meta);
      if (!picked?.url) {
        errors.push(`${extractorArgs}: JSON sin URLs (${meta?.formats?.length || 0} formatos)`);
        continue;
      }
      console.log(
        `✅ Stream yt-dlp ${videoId} (${picked.formatId || '?'}) [${extractorArgs}] via ${picked.via}`
      );
      return picked.url;
    } catch (err) {
      const msg = (err.stderr || err.message || String(err)).replace(/\s+/g, ' ').trim();
      errors.push(`${extractorArgs}: ${msg.slice(0, 160)}`);
      console.warn(`⚠️ yt-dlp list [${extractorArgs}]: ${msg.slice(0, 120)}`);
    }
  }

  if (process.env.YOUTUBE_YTDLP_FORMAT) {
    try {
      const meta = await youtubedl(watchUrl, {
        ...buildYtDlpBaseOpts(),
        dumpSingleJson: true,
        format: process.env.YOUTUBE_YTDLP_FORMAT,
        extractorArgs: process.env.YOUTUBE_YTDLP_EXTRACTOR_ARGS || 'youtube:player_client=android,web',
      });
      const picked = pickUrlFromYtDlpMeta(meta);
      if (picked?.url) return picked.url;
    } catch (err) {
      errors.push(`env format: ${(err.stderr || err.message || '').slice(0, 120)}`);
    }
  }

  throw new Error(errors.join(' | ') || 'yt-dlp falló');
}

function pickPipedStreamUrl(data) {
  if (data?.error || data?.message) {
    throw new Error(data.message || data.error);
  }
  const streams = data?.formatStreams || [];
  const progressive = streams
    .filter((s) => s?.url && (s.mimeType || '').includes('mp4'))
    .sort((a, b) => (b?.bitrate || 0) - (a?.bitrate || 0));
  if (progressive[0]?.url) return progressive[0].url;

  const video = (data?.videoStreams || []).find((s) => s?.url);
  if (video?.url) return video.url;

  const audio = (data?.audioStreams || []).find((s) => s?.url);
  if (audio?.url) return audio.url;

  throw new Error('Piped no devolvió streams utilizables');
}

async function resolveWithPiped(videoId) {
  const bases = PIPED_API_BASES.length ? PIPED_API_BASES : DEFAULT_PIPED_BASES;
  const errors = [];

  for (const base of bases) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`${base}/streams/${videoId}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Yale/1.0' },
      });
      clearTimeout(timer);
      const text = await res.text();
      if (!text.startsWith('{')) {
        errors.push(`${base}: HTTP ${res.status}`);
        continue;
      }
      const data = JSON.parse(text);
      const url = pickPipedStreamUrl(data);
      console.log(`✅ Stream Piped ${videoId} via ${base}`);
      return url;
    } catch (err) {
      errors.push(`${base}: ${(err.message || err).toString().slice(0, 80)}`);
    }
  }

  throw new Error(errors.join(' | ') || 'Piped falló');
}

async function resolveYoutubeStreamUrl(videoId) {
  const cached = streamUrlCache.get(videoId);
  if (cached) return cached;

  const hasCookies = !!resolveCookiesPath();
  const preferYtDlp = process.env.YOUTUBE_USE_YTDLP === 'true';
  const errors = [];

  const tryYtDlp = async () => {
    const url = await resolveWithYtDlp(videoId);
    streamUrlCache.set(videoId, url);
    return url;
  };

  const tryInnertube = async (fresh = false) => {
    if (fresh) resetYoutubeInstance();
    const url = await resolveWithInnertube(videoId);
    streamUrlCache.set(videoId, url);
    return url;
  };

  const tryPiped = async () => {
    const url = await resolveWithPiped(videoId);
    streamUrlCache.set(videoId, url);
    return url;
  };

  if (preferYtDlp || hasCookies) {
    try {
      return await tryYtDlp();
    } catch (err) {
      errors.push(`yt-dlp: ${err.message}`);
    }
  }

  try {
    return await tryInnertube();
  } catch (err) {
    errors.push(`innertube: ${err.message}`);
    try {
      return await tryInnertube(true);
    } catch (retryErr) {
      errors.push(`innertube(retry): ${retryErr.message}`);
    }
  }

  if (!preferYtDlp) {
    try {
      return await tryYtDlp();
    } catch (err) {
      errors.push(`yt-dlp: ${err.message}`);
    }
  }

  try {
    return await tryPiped();
  } catch (err) {
    errors.push(`piped: ${err.message}`);
  }

  const detail = errors.join(' || ');
  if (!hasCookies) {
    throw new Error(
      `YouTube bloqueó la IP de Render. Debes añadir cookies: en Render crea YOUTUBE_COOKIES_B64 (exporta cookies.txt de tu cuenta YouTube en base64). Detalle: ${detail}`
    );
  }
  throw new Error(`No se pudo obtener el stream. Detalle: ${detail}`);
}

function invalidateStreamCache(videoId) {
  if (videoId) streamUrlCache.del(videoId);
}

module.exports = {
  getYoutubeInstance,
  resetYoutubeInstance,
  resolveYoutubeStreamUrl,
  invalidateStreamCache,
};
