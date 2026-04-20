/* Minimal CEP bridge with safe fallback. */
(function attachCsInterface(global) {
  if (typeof global.CSInterface !== "undefined") {
    return;
  }

  function CSInterface() {}

  CSInterface.prototype.evalScript = function evalScript(script, callback) {
    if (global.__adobe_cep__ && typeof global.__adobe_cep__.evalScript === "function") {
      global.__adobe_cep__.evalScript(script, callback || function () {});
      return;
    }

    if (typeof callback === "function") {
      callback("Fallback CSInterface: " + script);
    }
  };

  CSInterface.prototype.getSystemPath = function getSystemPath(pathType) {
    if (global.__adobe_cep__ && typeof global.__adobe_cep__.getSystemPath === "function") {
      return global.__adobe_cep__.getSystemPath(pathType || "");
    }
    return "";
  };

  global.SystemPath = global.SystemPath || {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
  };

  global.CSInterface = CSInterface;
})(window);
