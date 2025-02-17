var settings = require("./settings_mm_check.json");
var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var ffmpeg = require("fluent-ffmpeg");
var date_cutoff = new Date(settings.date_cutoff).getTime() || 0;
var shell_escape = require("shell-escape");
var windows1252 = require("windows-1252");
var uuid = require('uuid/v5');
const { date } = require("gulp-util");
var uuid_namespace = require('uuid/v1')();
var dest_file_list = {};
var deleteUnmanaged = false;
process.argv.forEach((arg)=> {
  if (arg==="--delete") {
    deleteUnmanaged = true;
  }
});
var walk = function(dir, done) {
  var results = [];
  fs.readdir(dir, function(err, list) {
    if (err) return done(err);
    var pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(function(file) {
      file = path.resolve(dir, file);
      fs.stat(file, function(err, stat) {
        if (stat && stat.isDirectory()) {
          walk(file, function(err, res) {
            results = results.concat(res);
            if (!--pending) done(null, results);
          });
        } else {
          var mtime = new Date(stat.mtime).getTime();
          var ctime = new Date(stat.ctime).getTime();
          if (Math.max(mtime, ctime) > date_cutoff) {
            results.push(file);
          }
          if (!--pending) done(null, results);
        }
      });
    });
  });
};
var i = 0;
var jobs = [];
var codec_list = [];
var getInfo = function(file, jobID) {
  return new Promise(function(resolve, reject) {
    try {
      var file_arr = file.split(".");
      var ext = file_arr[file_arr.length-1];
      if (ext!=="m4a" && ext!=="mp3" && ext!=="flac" && ext!=="mp4" && ext!=="m4p") {
        //console.log("not a music file: " + file);
        resolve({data:null,jobID:jobID});
        return;
      }
      var command = shell_escape([
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        file
      ]);
      exec(command, function(err, out) {
        if (err) {
          console.log("bad command: " + command);
          console.log(err);
          resolve({data:null,jobID:jobID});
          return;
        } else {
          try {
            var data = JSON.parse(out);
            var codec = data.streams[0].codec_name;
            if (codec === "alac") {
              codec_list.push([file, codec]);
            }
            console.log(file);
            resolve({data, jobID: jobID});
          }
          catch(ex) {
            console.log("parse error: " + file);
            resolve({data:null,jobID:jobID});
            return;
          }
        }
      });
    } catch (ex) {
      console.log(ex);
      resolve({data:null, jobID: jobID});
      return;
    }
  });
};

function finished(result) {
  var { jobID } = result;
  jobs[jobID] = null;
  startNewJob();
}

var fileList;
var fileIndex = 0;

function startNewJob() {
  var file;
  var i = 0;
  var not_finished = false;
  while (i < settings.max_concurrent) {
    if (!jobs[i]) {
      if (fileIndex >= fileList.length) {
        i++;
      } else {
        not_finished = true;
        var need_restart = false;
        file = fileList[fileIndex];
        dest = file.replace(settings.source_directory, settings.target_directory);
        dest = dest.split(".");
        dest.splice(-1);
        dest = dest.join(".");
        dest = windows1252.decode(windows1252.encode(dest,{mode:"html"}));
        if (file.indexOf(".DS_Store")===-1) {
          try {
            jobs[i] = getInfo(file, i).then(finished);
          } catch (ex) {
            jobs[i] = null;
          }
          i++;
        } else {
          need_restart = true;
        }
        fileIndex++;
        if (need_restart) {
          startNewJob();
        }
      }

    } else {
      not_finished = true;
      i++;
    }
  }
  if (not_finished === false) {
    fs.writeFileSync("./codecs.json", JSON.stringify(codec_list, null, " "));
  }
}

walk(settings.source_directory, function(err, results) {
  console.log(err);
  fileList = results;

/*  fileList.forEach(function(f, i) {
    try {
      windows1252.encode(f);
    } catch (ex) {
      var dest = f.replace(settings.source_directory,settings.target_directory);
      try {
        fs.unlinkSync(dest);
      } catch (ex) {
        console.log(ex);
      }
    }
  });
  return;*/
  startNewJob();
});
//process.stdin.resume();
