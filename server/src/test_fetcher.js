const { YtdlCore } = require('@ybd-project/ytdl-core');

const customFetcher = async (url, options) => {
  if (options && options.method === 'HEAD') {
    console.log("Intercepted HEAD request for:", url);
    return {
      status: 200,
      ok: true,
      headers: new Headers(),
      body: null
    };
  }
  return fetch(url, options);
};

const core = new YtdlCore({
  fetcher: customFetcher,
  disableBasicCache: true,
  disableFileCache: true
});

async function run() {
  try {
    const videoId = 'dBHURNQASvQ';
    console.log("Fetching full info...");
    const info = await core.getFullInfo(videoId);
    console.log("Formats total count:", info.formats.length);
    
    console.log("Trying to download...");
    const stream = await core.downloadFromInfo(info, { filter: 'videoandaudio' });
    console.log("Download success! Stream type:", typeof stream);
  } catch (err) {
    console.error("Global Error:", err);
  }
}

run();
