function makeReq({ method = 'POST', body = {} } = {}) {
  return { method, body };
}

function makeRes() {
  const res = {
    statusCode: null,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonBody = payload;
      return this;
    },
  };
  return res;
}

module.exports = { makeReq, makeRes };
