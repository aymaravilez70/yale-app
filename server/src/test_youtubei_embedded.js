const { Innertube, Platform } = require('youtubei.js');

Platform.shim.eval = (data) => {
  const code = typeof data === 'string' ? data : (data.output || data.code || data);
  return new Function(code)();
};

async function run() {
  try {
    console.log("Testing client_type: WEB_EMBEDDED");
    const youtube = await Innertube.create({ client_type: 'WEB_EMBEDDED' });
    const videoId = 'dBHURNQASvQ';
    const info = await youtube.getInfo(videoId);
    
    console.log("Video Title:", info.basic_info.title);
    
    const formats = info.streaming_data?.formats || [];
    console.log("Progressive formats count:", formats.length);
    
    if (formats.length > 0) {
      const format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
      console.log("Chosen format itag:", format.itag, "quality:", format.quality_label);
      
      const decryptedUrl = await format.decipher(youtube.session.player);
      console.log("Decrypted URL:", decryptedUrl.substring(0, 100) + "...");
      
      console.log("Fetching first 100 bytes...");
      const response = await fetch(decryptedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
          'Referer': 'https://www.youtube.com/',
          'Origin': 'https://www.youtube.com/',
          'Range': 'bytes=0-99'
        }
      });
      
      console.log("HTTP Response Status:", response.status);
      if (response.ok) {
        console.log("🎉 SUCCESS WITH WEB_EMBEDDED!");
      }
    }
  } catch (err) {
    console.error("Error with WEB_EMBEDDED:", err.message);
  }
}

run();
