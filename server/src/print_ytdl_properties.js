const { YtdlCore } = require('@ybd-project/ytdl-core');

const core = new YtdlCore();

async function run() {
  try {
    console.log("Fetching a video to trigger poToken generation...");
    await core.getFullInfo('dBHURNQASvQ');
    
    console.log("Keys of YtdlCore instance:", Object.keys(core));
    console.log("poToken value:", core.poToken);
    console.log("visitorData value:", core.visitorData);
    
    // Check if there are other private fields or methods
    for (const key in core) {
      console.log(`core.${key}:`, typeof core[key], core[key]);
    }
  } catch (err) {
    console.error(err);
  }
}

run();
