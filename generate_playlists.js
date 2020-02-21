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
var glob = require("glob");
var glob_escape = require("glob-escape");
function lookupPath(d) {

}

parseXML(xml, function(err, result) {
  console.log(result);
  var playlists = result.plist.dict[0].array[0].dict;
  var itunes_root = settings.itunes_root;
  var target_dir = settings.target_directory;
  var obj = [];
  var max = 1000;
  var tracks = result.plist.dict[0].dict[0];
  var trackIndex = {};
  tracks.dict.forEach(function(d) {
    var ind = 0;
    trackIndex[d.integer[0]] = d.string[d.string.length-1];
  });
  var nplaylists = playlists.length;
  playlists.forEach(function(d, i) {
    try {
      
      if (obj.length>max) {
        return;
      }
      console.log(i, nplaylists);
      var r = {};
      r.name = d.string[1].replace(/\:/g,"-");
      r.name = r.name.replace(/\//g," ");
      //console.log(r.name);
      r.entries = [];
      var length = d.array[0].dict.length;
      if (length > max) {return;}
      d.array[0].dict.forEach(function(d, i) {
        try {
          
          //if (i%100 === 0) {console.log(i, length);}
          var path = trackIndex[d.integer];
          path = decodeURIComponent(path);
          path = path.replace("file://localhost/D:/","/mnt/d/");
          if (path.indexOf(itunes_root)===-1) {
            return;
          }
          path = path.replace(itunes_root,"");
          var orgpath = path;
          var found = false;
          path = windows1252.encode(path, {mode:"html"});
          var paths = [orgpath, path];
          paths.forEach(function(path) {
            if (found) {return;}
            path = path.replace(/[^\x00-\x7F]/g, "");
            var noExt = path.split(".");
            var orgExt = noExt.splice(-1);
            noExt = noExt.join(".");
            noExt = noExt.split("/");
            noExt[noExt.length - 1] = "*" + glob_escape(noExt[noExt.length - 1]) + "*";
            noExt = noExt.join("/");
            var toCheck = glob_escape(target_dir) + "/" + noExt;
            var exts = orgExt.concat(["mp3","m4a","mp4","flac"]);
            var files = glob.sync(toCheck);
            if (files.length) {
              var f = files[0].replace(target_dir + "/","");
              r.entries.push(f);
              found = true;
            }
            return;
            exts.forEach(function(ext) {
              if (found) {return;}
              var testPath = toCheck + "." + ext;
              if (fs.existsSync(testPath)) {
                //console.log(testPath);
                found = true;
                r.entries.push(testPath.replace(target_dir + "/",""));
              } /*else {
                console.log("not found: " + testPath);
              }*/
            });
          });
          if (!found) {
            //console.log("not found: " + path);
          }
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
    //console.log(d.name);
    var binary = windows1252.encode(file,{mode:'html'});
    //console.log(d.name);
    fs.writeFileSync("playlists/"+d.name+".m3u",file,{encoding:"binary"});
  });
});

//process.stdin.resume();
