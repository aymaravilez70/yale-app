const { Innertube, Platform } = require('youtubei.js');

Platform.shim.eval = (data) => {
  const code = typeof data === 'string' ? data : (data.output || data.code || data);
  return new Function(code)();
};

async function run() {
  try {
    console.log("Initializing Innertube...");
    const youtube = await Innertube.create();
    const videoId = 'dBHURNQASvQ';
    console.log(`Fetching info for video ${videoId}...`);
    const info = await youtube.getInfo(videoId);
    
    console.log("Video Title:", info.basic_info.title);
    
    console.log("Choosing format...");
    const format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
    
    console.log("Deciphering format URL...");
    const decryptedUrl = await format.decipher(youtube.session.player);
    console.log("Decrypted Streaming URL:", decryptedUrl);
    
    console.log("Attempting fetch with Youtube headers...");
    const response = await fetch(decryptedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com/',
        'Range': 'bytes=0-99' // Fetch only first 100 bytes
      }
    });
    
    console.log("HTTP Response Status:", response.status);
    console.log("HTTP Headers:", Object.fromEntries(response.headers.entries()));
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      console.log("SUCCESSFULLY FETCHED CHUNK! Byte length:", buffer.byteLength);
    } else {
      const text = await response.text();
      console.log("Failed to fetch. Body prefix:", text.substring(0, 200));
    }
  } catch (err) {
    console.error("Error using youtubei.js:", err);
  }
}

run();
