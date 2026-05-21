async function testInstance(instanceUrl) {
  try {
    const videoId = 'nlXqp3FVrq8';
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Requesting ${instanceUrl} for: ${videoUrl}`);
    
    const response = await fetch(instanceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        url: videoUrl
      })
    });
    
    console.log("HTTP status:", response.status);
    const data = await response.json();
    console.log("Response data:", data);
    return data;
  } catch (err) {
    console.error(`Failed for ${instanceUrl}:`, err.message);
    return null;
  }
}

async function run() {
  const instances = [
    "https://cobaltapi.kittycat.boo/",
    "https://dog.kittycat.boo/",
    "https://apicobalt.mgytr.top/",
    "https://melon.clxxped.lol/"
  ];
  
  for (const url of instances) {
    const res = await testInstance(url);
    if (res && res.url) {
      console.log(`🎉 SUCCESS! Working instance: ${url} -> URL: ${res.url}`);
      break;
    }
  }
}

run();
