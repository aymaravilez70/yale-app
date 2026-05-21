async function getStreamUrl(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch("https://cobaltapi.kittycat.boo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      url: videoUrl
    })
  });
  const data = await response.json();
  return data.url;
}

async function run() {
  try {
    const videoId = 'S3AhEdekRw8';
    console.log("Getting fresh stream URL for:", videoId);
    const streamUrl = await getStreamUrl(videoId);
    console.log("Stream URL:", streamUrl);
    
    console.log("Fetching stream URL headers...");
    const res = await fetch(streamUrl, {
      method: "HEAD"
    });
    console.log("Response status:", res.status);
    console.log("Headers:", Object.fromEntries(res.headers.entries()));
  } catch (err) {
    console.error(err);
  }
}

run();
