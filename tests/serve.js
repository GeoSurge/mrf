const serveStatic = require("serve-static");
const http = require("http");
const finalhandler = require("finalhandler");

module.exports = port => {
  const serve = serveStatic(".", {
    acceptRanges: true
  });

  const server = http.createServer(function onRequest(req, res) {
    serve(req, res, finalhandler(req, res));
  });

  server.listen(port);
};
