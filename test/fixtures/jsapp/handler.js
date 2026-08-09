const store = require("./store");

function normalize(name) {
  return name.trim().toLowerCase();
}

function handlePut(key, payload) {
  const clean = normalize(payload.name);
  store.write(key, { name: clean });
  return true;
}

module.exports = { handlePut, normalize };
