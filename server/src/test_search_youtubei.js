const { Innertube, Platform } = require('youtubei.js');

Platform.shim.eval = (data) => {
  const code = typeof data === 'string' ? data : (data.output || data.code || data);
  return new Function(code)();
};

async function run() {
  try {
    console.log("Initializing Innertube...");
    const youtube = await Innertube.create();
    console.log("Searching for 'hola'...");
    const search = await youtube.search('hola', { type: 'video' });
    console.log("Search keys:", Object.keys(search));
    
    // Log the first result
    const firstVideo = search.results[0]; // Let's log 'results' instead of 'videos' if 'videos' is empty
    console.log("Search results count:", search.results?.length);
    console.log("Search videos count:", search.videos?.length);
    console.log("First result title:", firstVideo?.title?.text || firstVideo?.title);
    console.log("First result id:", firstVideo?.id);
    console.log("First result thumbnails:", JSON.stringify(firstVideo?.thumbnails));
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
