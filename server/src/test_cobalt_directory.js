async function run() {
  try {
    console.log("Fetching working Cobalt APIs from cobalt.directory...");
    const res = await fetch("https://cobalt.directory/api/working?type=api");
    const json = await res.json();
    console.log("JSON structure:", Object.keys(json));
    console.log("JSON data keys or value type:", typeof json.data, json.data ? Object.keys(json.data) : 'null');
    console.log("Sample of json.data:", JSON.stringify(json.data).substring(0, 300));
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
