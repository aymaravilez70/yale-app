async function getStreamUrl(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  // 1. Fetch current working instances from cobalt.directory
  let instances = [];
  try {
    console.log("Fetching dynamic working Cobalt APIs...");
    const res = await fetch("https://cobalt.directory/api/working?type=api");
    const json = await res.json();
    if (json && json.data && Array.isArray(json.data.youtube)) {
      instances = json.data.youtube;
      console.log(`Fetched ${instances.length} working Cobalt APIs for YouTube.`);
    }
  } catch (err) {
    console.warn("Failed to fetch dynamic Cobalt instances:", err.message);
  }
  
  // 2. Add some hardcoded backups at the end if none fetched or to ensure coverage
  const backupInstances = [
    "https://cobaltapi.kittycat.boo",
    "https://lime.clxxped.lol",
    "https://grapefruit.clxxped.lol",
    "https://dog.kittycat.boo",
    "https://api.cobalt.blackcat.sweeux.org"
  ];
  
  // Deduplicate and combine
  const allInstances = [...new Set([...instances, ...backupInstances])];
  console.log("Combined active instances list:", allInstances);
  
  // 3. Fallback through them
  for (const instance of allInstances) {
    try {
      console.log(`🔗 Trying Cobalt at: ${instance}`);
      const response = await fetch(instance, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          url: videoUrl
        })
      });
      
      console.log(`Response status from ${instance}: ${response.status}`);
      if (response.status === 200) {
        const data = await response.json();
        if (data && data.url) {
          console.log(`🎉 SUCCESS! Streaming URL obtained:`, data.url.substring(0, 120) + "...");
          return data.url;
        }
      } else {
        const text = await response.text();
        console.log(`Failed. Body:`, text.substring(0, 150));
      }
    } catch (err) {
      console.error(`❌ Failed instance ${instance}:`, err.message);
    }
  }
  return null;
}

async function run() {
  const videoId = 'dBHURNQASvQ'; // Maluma - Según Quién
  console.log(`Starting dynamic Cobalt stream test for: ${videoId}`);
  const streamUrl = await getStreamUrl(videoId);
  if (streamUrl) {
    console.log("\n🎉 TEST SUCCESS! Video stream URL:", streamUrl);
  } else {
    console.log("\n❌ TEST FAILED: No working Cobalt API found.");
  }
}

run();
