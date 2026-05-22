const fs = require('fs');
const path = require('path');
const os = require('os');
const NodeCache = require('node-cache');
const youtubedl = require('youtube-dl-exec');

const streamUrlCache = new NodeCache({ stdTTL: 1800, checkperiod: 300 });

const INNERTUBE_CLIENTS = ['IOS', 'MWEB', 'ANDROID', 'WEB', 'TV_EMBEDDED', 'WEB_CREATOR'];

const YTDLP_ATTEMPTS = [
  { extractorArgs: 'youtube:player_client=android,web', format: '18/b[height<=480]/b' },
  { extractorArgs: 'youtube:player_client=ios', format: '18/b[height<=480]/b' },
  { extractorArgs: 'youtube:player_client=tv_embedded', format: 'b[height<=480]/b' },
  { extractorArgs: 'youtube:player_client=mweb', format: '18/b/b' },
];

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

async function resolveWithYtDlp(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const baseOpts = buildYtDlpBaseOpts();
  const attempts = YTDLP_ATTEMPTS.map((a) => ({
    ...baseOpts,
    dumpSingleJson: true,
    format: process.env.YOUTUBE_YTDLP_FORMAT || a.format,
    extractorArgs: a.extractorArgs,
  }));

  if (process.env.YOUTUBE_YTDLP_EXTRACTOR_ARGS) {
    attempts.unshift({
      ...baseOpts,
      dumpSingleJson: true,
      format: process.env.YOUTUBE_YTDLP_FORMAT || '18/b[height<=480]/b',
      extractorArgs: process.env.YOUTUBE_YTDLP_EXTRACTOR_ARGS,
    });
  }

  const errors = [];
  console.log(`🎬 Stream yt-dlp: ${videoId} (cookies: ${resolveCookiesPath() ? 'sí' : 'no'})`);

  for (const opts of attempts) {
    try {
      const meta = await youtubedl(watchUrl, opts);
      if (!meta?.url) {
        errors.push(`${opts.extractorArgs}: sin URL`);
        continue;
      }
      console.log(`✅ Stream yt-dlp ${videoId} (${meta.format_id || meta.ext}) [${opts.extractorArgs}]`);
      return meta.url;
    } catch (err) {
      const msg = err.stderr?.slice(0, 200) || err.message || String(err);
      errors.push(msg.replace(/\s+/g, ' ').trim());
      console.warn(`⚠️ yt-dlp [${opts.extractorArgs}]: ${msg.slice(0, 120)}`);
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
