const fs = require("fs");

var list =JSON.parse(fs.readFileSync("./codecs.json"))
var r = [];
list.forEach((item) => {
  if (item[1] === "alac") {
    r.push(item);
  }
})
fs.writeFileSync("alac_files.json", JSON.stringify(r, null, " "));