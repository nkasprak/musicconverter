var settings = require("./settings.json");
var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var ffmpeg = require("fluent-ffmpeg");
var shell_escape = require("shell-escape");
var settings = require("./settings.json");
var parseXML = require("xml2js").parseString;
var xml =fs.readFileSync(settings.itunes_xml, "utf-8");
var windows1252 = require("windows-1252");

var settings = require("./settings.json");
var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var ffmpeg = require("fluent-ffmpeg");
var shell_escape = require("shell-escape");

function lookupPath(d) {

}

parseXML(xml, function(err, result) {
  var playlists = result.plist.dict[0].array[0].dict;
  console.log(playlists);
  var itunes_root = settings.itunes_root;
  var obj = [];
  var max = 1000;
  var tracks = result.plist.dict[0].dict[0];
  var trackIndex = {};
  tracks.dict.forEach(function(d) {
    var ind = 0;
    trackIndex[d.integer[0]] = d.string[d.string.length-1];
  });
  playlists.forEach(function(d) {
    try {
      if (obj.length>max) {
        return;
      }
      var r = {};
      r.name = d.string[1].replace(/\:/g,"-");
      r.name = r.name.replace(/\//g," ");
      //console.log(r.name);
      r.entries = [];
      d.array[0].dict.forEach(function(d) {
        try {
          var path = trackIndex[d.integer];
          path = decodeURIComponent(path);
          if (path.indexOf(itunes_root)===-1) {
            return;
          }
          path = path.replace(itunes_root,"");
          path = windows1252.encode(path, {mode:"html"});
          console.log(path);
          r.entries.push(path);
        } catch (ex) {}
      });
      obj.push(r);
    } catch (ex) {

    }
  });
  obj.forEach(function(d) {
    var file = "#EXTM3U\n";
    if (d.entries.length===0 || d.name==="Library" || d.name==="Classical Music" || d.entries.length > 2000) {
      return;
    }
    d.entries.forEach(function(d) {
      file += (d + "\n");
    });
    console.log(d.name);
    var binary = windows1252.encode(file,{mode:'html'});
    console.log(d.name);
    fs.writeFileSync("playlists/"+d.name+".m3u",file,{encoding:"binary"});
  });
});

//process.stdin.resume();
