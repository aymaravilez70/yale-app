const { YtdlCore } = require('@ybd-project/ytdl-core');
const fs = require('fs');
const path = require('path');
const core = new YtdlCore();

const logFile = path.join(__dirname, 'debug_log.txt');
fs.writeFileSync(logFile, ''); // clear

function log(msg, ...args) {
  const line = msg + ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n';
  fs.appendFileSync(logFile, line);
  console.log(msg, ...args);
}

async function run() {
  try {
    const videoId = 'dBHURNQASvQ';
    log("Fetching full info...");
    const info = await core.getFullInfo(videoId);
    log("Formats total count:", info.formats.length);
    
    // Print unique client names
    const clients = [...new Set(info.formats.map(f => f.sourceClientName))];
    log("Clients available in formats:", clients);
    
    // Print details of first 5 formats
    log("First 5 formats details:");
    info.formats.slice(0, 5).forEach((f, i) => {
      log(`Format ${i}: itag=${f.itag}, client=${f.sourceClientName}, hasVideo=${f.hasVideo}, hasAudio=${f.hasAudio}, url=${f.url ? 'Yes' : 'No'}`);
    });

    log("Trying chooseFormat with default options...");
    try {
      const format = YtdlCore.chooseFormat(info.formats, {});
      log("chooseFormat default success:", format.itag);
    } catch (e) {
      log("chooseFormat default error:", e.message);
    }

    log("Trying chooseFormat with filter: 'videoandaudio'...");
    try {
      const format = YtdlCore.chooseFormat(info.formats, { filter: 'videoandaudio' });
      log("chooseFormat videoandaudio success:", format.itag);
    } catch (e) {
      log("chooseFormat videoandaudio error:", e.message);
    }

    log("Trying to download...");
    try {
      const stream = await core.downloadFromInfo(info);
      log("Download success! Stream type:", typeof stream);
    } catch (e) {
      log("Download error:", e.message, e.stack);
    }
  } catch (err) {
    log("Global Error:", err.message, err.stack);
  }
}

run();
