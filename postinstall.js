var fs = require("fs");
var default_settings = fs.readFileSync("./default.settings.json");
fs.writeFileSync("settings.json",default_settings,"utf-8");
