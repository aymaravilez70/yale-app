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
    console.log("Decrypted Streaming URL (prefix):", decryptedUrl.substring(0, 100) + "...");
    
    console.log("Attempting fetch with youtube.session.http by passing a URL object...");
    const response = await youtube.session.http.fetch(new URL(decryptedUrl), {
      headers: {
        'Range': 'bytes=0-99' // Fetch only first 100 bytes
      }
    });
    
    console.log("HTTP Response Status:", response.status);
    console.log("HTTP Headers:", Object.fromEntries(response.headers.entries()));
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      console.log("🎉🎉 SUCCESSFUL FETCH WITH SESSION HTTP AND URL OBJECT! Byte length:", buffer.byteLength);
    } else {
      const text = await response.text();
      console.log("Failed. Body:", text.substring(0, 200));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
