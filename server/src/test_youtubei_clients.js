const { Innertube, Platform } = require('youtubei.js');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'clients_log.txt');
fs.writeFileSync(logFile, ''); // clear

function log(msg, ...args) {
  const line = msg + ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n';
  fs.appendFileSync(logFile, line);
  console.log(msg, ...args);
}

Platform.shim.eval = (data) => {
  const code = typeof data === 'string' ? data : (data.output || data.code || data);
  return new Function(code)();
};

async function testClient(clientType) {
  try {
    log(`\n--- Testing Client Type: ${clientType} ---`);
    const youtube = await Innertube.create({ client_type: clientType });
    const videoId = 'dBHURNQASvQ';
    const info = await youtube.getInfo(videoId);
    
    log(`[${clientType}] Video Title:`, info.basic_info.title);
    
    // Check available formats
    const formats = info.streaming_data?.formats || [];
    const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
    log(`[${clientType}] Progressive formats count:`, formats.length);
    
    if (formats.length === 0) {
      log(`[${clientType}] No progressive formats returned.`);
      return;
    }
    
    // Choose the best progressive format
    const format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
    log(`[${clientType}] Chosen format itag:`, format.itag, "quality:", format.quality_label);
    
    log(`[${clientType}] Deciphering format URL...`);
    const decryptedUrl = await format.decipher(youtube.session.player);
    log(`[${clientType}] Decrypted Streaming URL (prefix):`, decryptedUrl.substring(0, 100) + "...");
    
    log(`[${clientType}] Fetching first 100 bytes...`);
    const response = await fetch(decryptedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com/',
        'Range': 'bytes=0-99'
      }
    });
    
    log(`[${clientType}] HTTP Response Status:`, response.status);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      log(`[${clientType}] SUCCESS! Byte length:`, buffer.byteLength);
      return decryptedUrl;
    } else {
      log(`[${clientType}] Failed. Status:`, response.status, "Reason:", response.statusText);
    }
  } catch (err) {
    log(`[${clientType}] Error:`, err.message);
  }
  return null;
}

async function run() {
  const clients = ['ANDROID', 'IOS', 'TV', 'MWEB', 'WEB'];
  for (const client of clients) {
    const successUrl = await testClient(client);
    if (successUrl) {
      log(`\n🎉🎉 FOUND WORKING CLIENT: ${client} 🎉🎉`);
    }
  }
}

run();
