const { Innertube, Platform } = require('youtubei.js');

// Provide custom evaluator
Platform.shim.eval = (data) => {
  console.log("type of data in eval:", typeof data);
  console.log("data representation:", data);
  if (data && typeof data === 'object') {
    console.log("keys of data:", Object.keys(data));
    console.log("data.code:", data.code);
    console.log("data.output:", data.output);
  }
  // Try evaluating the string or data.code or data.output
  const code = (typeof data === 'string') ? data : (data.code || data.output || data);
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
    console.log("Selected format itag:", format.itag, "mime_type:", format.mime_type, "quality:", format.quality_label);
    
    console.log("Downloading stream...");
    const stream = await info.download({
      type: 'video+audio',
      quality: 'best'
    });
    
    console.log("Stream successfully obtained! Stream type:", typeof stream);
    
    // Check if the stream is a readable stream by reading the first chunk
    const reader = stream.getReader();
    const { value, done } = await reader.read();
    console.log("First chunk read successfully! Byte length:", value ? value.byteLength : 0);
  } catch (err) {
    console.error("Error using youtubei.js:", err);
  }
}

run();
