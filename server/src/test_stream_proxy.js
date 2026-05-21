const express = require('express');
const { Innertube, Platform } = require('youtubei.js');

Platform.shim.eval = (data) => {
  const code = typeof data === 'string' ? data : (data.output || data.code || data);
  return new Function(code)();
};

const app = express();
let youtubeInstance = null;

async function getInnertube() {
  if (!youtubeInstance) {
    youtubeInstance = await Innertube.create();
  }
  return youtubeInstance;
}

app.get('/test-stream', async (req, res) => {
  const videoId = req.query.videoId || 'S3AhEdekRw8';
  console.log(`[TEST STREAM] Request for videoId: ${videoId}`);
  
  try {
    const youtube = await getInnertube();
    const info = await youtube.getInfo(videoId, { client: 'ANDROID' });
    const format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
    if (!format) {
      return res.status(500).send("No combined format found");
    }
    
    const decryptedUrl = await format.decipher(youtube.session.player);
    console.log(`[TEST STREAM] Decrypted URL prefix: ${decryptedUrl.substring(0, 80)}...`);
    
    const clientHeaders = {};
    if (req.headers.range) {
      clientHeaders['Range'] = req.headers.range;
      console.log(`[TEST STREAM] Client requested range: ${req.headers.range}`);
    }
    clientHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
    clientHeaders['Referer'] = 'https://www.youtube.com/';
    
    const targetResponse = await fetch(decryptedUrl, {
      headers: clientHeaders
    });
    
    res.status(targetResponse.status);
    console.log(`[TEST STREAM] Target CDN status: ${targetResponse.status}`);
    
    const headersToCopy = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control'
    ];
    
    for (const h of headersToCopy) {
      const val = targetResponse.headers.get(h);
      if (val) {
        res.setHeader(h, val);
        console.log(`[TEST STREAM] Copying header ${h}: ${val}`);
      }
    }
    
    if (!res.getHeader('content-type')) {
      res.setHeader('content-type', 'video/mp4');
    }
    
    const reader = targetResponse.body.getReader();
    let totalBytes = 0;
    
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log(`[TEST STREAM] Completed streaming. Total bytes sent: ${totalBytes}`);
            res.end();
            break;
          }
          totalBytes += value.length;
          res.write(value);
        }
      } catch (err) {
        console.error("[TEST STREAM] Pipe error:", err.message);
        res.end();
      }
    };
    
    pump();
  } catch (err) {
    console.error("[TEST STREAM] Error:", err);
    res.status(500).send(err.message);
  }
});

const PORT = 4099;
app.listen(PORT, () => {
  console.log(`Test server running on http://localhost:${PORT}`);
  
  // Make a sample fetch to our own server to verify it streams correctly
  setTimeout(async () => {
    try {
      console.log("\n[TEST CLIENT] Making request to our own local proxy...");
      const res = await fetch(`http://localhost:${PORT}/test-stream?videoId=S3AhEdekRw8`, {
        headers: {
          'Range': 'bytes=0-99'
        }
      });
      console.log("[TEST CLIENT] Local proxy response status:", res.status);
      console.log("[TEST CLIENT] Local proxy response headers:", Object.fromEntries(res.headers.entries()));
      const buffer = await res.arrayBuffer();
      console.log(`[TEST CLIENT] Successfully streamed ${buffer.byteLength} bytes from our own proxy! 🎉🎉`);
      process.exit(0);
    } catch (err) {
      console.error("[TEST CLIENT] Error fetching from proxy:", err);
      process.exit(1);
    }
  }, 2000);
});
