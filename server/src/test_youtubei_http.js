const { Innertube, Platform } = require('youtubei.js');

Platform.shim.eval = (data) => {
  const code = typeof data === 'string' ? data : (data.output || data.code || data);
  return new Function(code)();
};

async function run() {
  try {
    const youtube = await Innertube.create();
    console.log("Keys of youtube.session.http:", Object.keys(youtube.session.http));
    console.log("youtube.session.http.baseURL:", youtube.session.http.baseURL);
    console.log("Keys of youtube.session.http.headers:", [...youtube.session.http.headers.keys()]);
  } catch (err) {
    console.error(err);
  }
}

run();
