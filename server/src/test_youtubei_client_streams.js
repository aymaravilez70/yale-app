const { Innertube, Platform } = require('youtubei.js');

Platform.shim.eval = (data) => {
  const code = typeof data === 'string' ? data : (data.output || data.code || data);
  return new Function(code)();
};

async function testClient(clientName) {
  try {
    console.log(`\n--- TESTING CLIENT: ${clientName} ---`);
    const youtube = await Innertube.create();
    const videoId = 'S3AhEdekRw8';
    
    console.log(`Fetching info with client: ${clientName}...`);
    const info = await youtube.getInfo(videoId, { client: clientName });
    console.log("Video Title:", info.basic_info.title);
    
    console.log("Choosing format...");
    const format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
    if (!format) {
      console.log("No combined format found.");
      return;
    }
    
    console.log("Deciphering format URL...");
    const decryptedUrl = await format.decipher(youtube.session.player);
    console.log("Decrypted Streaming URL prefix:", decryptedUrl.substring(0, 100) + "...");
    
    console.log("Attempting standard fetch on decrypted URL...");
    const response = await fetch(decryptedUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/',
        'Range': 'bytes=0-99'
      }
    });
    
    console.log("HTTP Status:", response.status);
    if (response.ok) {
      console.log(`🎉🎉 SUCCESS FOR CLIENT ${clientName}!`);
      return true;
    } else {
      console.log(`❌ Failed for client ${clientName}. Status: ${response.status}`);
      const text = await response.text();
      console.log("Body prefix:", text.substring(0, 150));
    }
  } catch (err) {
    console.error(`Error for client ${clientName}:`, err.message);
  }
  return false;
}

async function run() {
  const clients = ['ANDROID', 'IOS', 'TV', 'YTMUSIC'];
  for (const client of clients) {
    const success = await testClient(client);
    if (success) {
      console.log(`\n🚀 FOUND WORKING CLIENT: ${client}`);
      break;
    }
  }
}

run();
