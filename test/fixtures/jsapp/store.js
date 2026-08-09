const fs = require("fs");

function write(key, value) {
  fs.writeFileSync(key + ".json", JSON.stringify(value));
}

function read(key) {
  return JSON.parse(fs.readFileSync(key + ".json", "utf8"));
}

module.exports = { write, read };
