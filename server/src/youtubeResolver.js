const NodeCache = require('node-cache');
const youtubedl = require('youtube-dl-exec');

const streamUrlCache = new NodeCache({ stdTTL: 1800, checkperiod: 300 });

/** Orden pensado para VPS/datacenter: IOS/MWEB suelen ir mejor que WEB puro. */
const INNERTUBE_CLIENTS = ['IOS', 'MWEB', 'ANDROID', 'WEB', 'TV_EMBEDDED', 'WEB_CREATOR'];

let Innertube;
let ytInstance = null;

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

async function resolveWithInnertube(videoId, { retryFreshSession = false } = {}) {
  const yt = await getYoutubeInstance(retryFreshSession);
  let lastReason = 'Streaming data not available';

  for (const client of INNERTUBE_CLIENTS) {
    try {
      const info = await yt.getInfo(videoId, { client });
      const status = info.playability_status?.status;
      const reason = info.playability_status?.reason || info.playability_status?.error_screen?.reason?.text;

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

async function resolveWithYtDlp(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const opts = {
    dumpSingleJson: true,
    format: process.env.YOUTUBE_YTDLP_FORMAT || '18/b[height<=480]/b',
    noWarnings: true,
    noPlaylist: true,
    extractorArgs: process.env.YOUTUBE_YTDLP_EXTRACTOR_ARGS || 'youtube:player_client=android,web',
  };

  if (process.env.YOUTUBE_COOKIE_FILE) {
    opts.cookies = process.env.YOUTUBE_COOKIE_FILE;
  }

  console.log(`🎬 Stream yt-dlp fallback: ${videoId}`);
  const meta = await youtubedl(watchUrl, opts);
  if (!meta?.url) {
    throw new Error(meta?.title ? 'yt-dlp no devolvió URL' : 'yt-dlp falló');
  }
  console.log(`✅ Stream yt-dlp ${videoId} (${meta.format_id || meta.ext})`);
  return meta.url;
}

async function resolveYoutubeStreamUrl(videoId) {
  const cached = streamUrlCache.get(videoId);
  if (cached) return cached;

  const preferYtDlp = process.env.YOUTUBE_USE_YTDLP === 'true';
  const errors = [];

  if (preferYtDlp) {
    try {
      const url = await resolveWithYtDlp(videoId);
      streamUrlCache.set(videoId, url);
      return url;
    } catch (err) {
      errors.push(`yt-dlp: ${err.message}`);
    }
  }

  try {
    const url = await resolveWithInnertube(videoId);
    streamUrlCache.set(videoId, url);
    return url;
  } catch (err) {
    errors.push(`innertube: ${err.message}`);
    resetYoutubeInstance();
    try {
      const url = await resolveWithInnertube(videoId, { retryFreshSession: true });
      streamUrlCache.set(videoId, url);
      return url;
    } catch (retryErr) {
      errors.push(`innertube(retry): ${retryErr.message}`);
    }
  }

  try {
    const url = await resolveWithYtDlp(videoId);
    streamUrlCache.set(videoId, url);
    return url;
  } catch (err) {
    errors.push(`yt-dlp: ${err.message}`);
  }

  const detail = errors.join(' | ');
  throw new Error(
    detail.includes('LOGIN_REQUIRED') || detail.includes('bot')
      ? 'YouTube bloqueó el servidor (IP de Render). El servidor reintentará con yt-dlp; si persiste, sube cookies con YOUTUBE_COOKIE_FILE.'
      : detail || 'Streaming data not available'
  );
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
