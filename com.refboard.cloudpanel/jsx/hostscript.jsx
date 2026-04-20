var REFBOARD_BUILD = {
  panelVersion: "1.0.0",
  jsxVersion: "1.0.0",
  buildTime: "2026-04-20T00:00:00Z"
};

function getPluginBuildInfo() {
  try {
    return JSON.stringify({
      ok: true,
      data: REFBOARD_BUILD
    });
  } catch (e) {
    return '{"ok":false,"error":"build info failed"}';
  }
}

function pingHost(data) {
  try {
    return JSON.stringify({
      ok: true,
      message: "Host pong",
      echo: data || null
    });
  } catch (e) {
    return '{"ok":false,"error":"ping failed"}';
  }
}

function createDemoTextOnArtboard(data) {
  try {
    if (!app.documents.length) {
      return '{"ok":false,"error":"NO_DOCUMENT"}';
    }
    var doc = app.activeDocument;
    var textFrame = doc.textFrames.add();
    textFrame.contents = (data && data.text) ? data.text : "Cloud module is active";
    textFrame.position = [100, 100];
    return '{"ok":true,"message":"TEXT_CREATED"}';
  } catch (e) {
    return '{"ok":false,"error":"ERR:' + e.toString() + '"}';
  }
}
