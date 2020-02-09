var settings = require("./settings.json");
var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var ffmpeg = require("fluent-ffmpeg");
var shell_escape = require("shell-escape");
var windows1252 = require("windows-1252");
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
          results.push(file);
          if (!--pending) done(null, results);
        }
      });
    });
  });
};
var i = 0;
var jobs = [];
var getInfo = function(file, jobID) {
  return new Promise(function(resolve, reject) {
    try {
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
          console.log("bad file" + file);
          resolve({data:null,jobID:jobID});
        }
        try {resolve({data: JSON.parse(out), jobID: jobID});}
        catch(ex) {
          console.log(ex);
          resolve({data:null,jobID:jobID});
        }
      });
    } catch (ex) {
      console.log(ex);
      resolve({data:null, jobID: jobID});
    }
  });
};
var convertOrCopy = function(d) {
  return new Promise(function(resolve, reject) {
    if (d.data===null) {
      resolve(d.jobID);
    }
    if (settings.output_flac) {
      if (d.data.streams[0].codec_name==="alac") {
        if (d.data.format.bit_rate/1000 < settings.convert_bitrate_threshold*1) {
          convert(d, false, resolve, reject);
        } else {
          convert(d, true, resolve, reject);
        }
      } else {
        copy(d, resolve, reject);
      }
    } else {
      if (d.data.format.bit_rate/1000 < settings.convert_bitrate_threshold*1) {
        copy(d, resolve, reject);
      } else {
        convert(d, true, resolve, reject);
      }
    }
  });
};

function mkDirByPathSync(targetDir, {isRelativeToScript = false} = {}) {
  const sep = path.sep;
  const initDir = path.isAbsolute(targetDir) ? sep : '';
  const baseDir = isRelativeToScript ? __dirname : '.';

  targetDir.split(sep).reduce((parentDir, childDir) => {
    const curDir = path.resolve(baseDir, parentDir, childDir);
    try {
      fs.mkdirSync(curDir);
      console.log(`Directory ${curDir} created!`);
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }

      //console.log(`Directory ${curDir} already exists!`);
    }

    return curDir;
  }, initDir);
}

function copy(d, resolve, reject) {
  if (d.data===null) {
    resolve(d.jobID);
    return;
  }
  var path = d.data.format.filename.replace(settings.source_directory,"");
  var path_arr = path.split("/");
  path_arr.splice(-1);
  var path_dir = windows1252.decode(windows1252.encode(path_arr.join("/"), {mode:"html"}));
  mkDirByPathSync(settings.target_directory + path_dir);
  var dest = settings.target_directory + path;
  dest = windows1252.decode(windows1252.encode(dest,{mode:"html"}));
  if (fs.existsSync(dest)) {
    resolve(d.jobID);
  } else {
    console.log("Copy " + d.data.format.filename);
    fs.readFile(d.data.format.filename, function(err, data) {
      fs.writeFile(dest, data, function(err) {
        if (err) {
          console.log(err);
        }
        resolve(d.jobID);
      });
    });
  }
}

function convert(d, force_lossy, resolve, reject) {
  var path = d.data.format.filename.replace(settings.source_directory,"");
  var path_arr = path.split("/");
  var filename = path_arr.splice(-1)[0];
  filename = filename.split(".");
  filename.splice(-1);
  if (settings.output_flac && !force_lossy) {
    filename = filename.join(".") + ".flac";
  } else {
    filename = filename.join(".") + ".m4a";
  }
  var path_dir = path_arr.join("/");
  path_dir = windows1252.decode(windows1252.encode(path_arr.join("/"), {mode:"html"}));
  mkDirByPathSync(settings.target_directory + path_dir);
  var dest = settings.target_directory + path_dir + "/" + filename;
  dest = windows1252.decode(windows1252.encode(dest,{mode:"html"}));
  var codec = "libfdk_aac";
  if (settings.output_flac && !force_lossy) {
    codec = "flac";
  }
  if (settings.output_alac) {
    codec = "alac";
  }
  if (fs.existsSync(dest)) {
    resolve(d.jobID);
  } else {
    try {
      console.log("Converting " + d.data.format.filename);
      var command = shell_escape([
        "ffmpeg",
        "-i",
        d.data.format.filename,
        "-strict",
        "-2",
        "-ac",
        "2",
        "-vn",
        //"-sample_fmt",
        //"s32p",
        "-ab",
        settings.target_bitrate + "k",
        "-acodec",
        codec,
        "-ar",
        "44100",
        dest
      ]);
      console.log(command);
      exec(command, function(err, stdout) {
        if (err) {
          console.log(err);
        }
        resolve(d.jobID);
      });
    } catch (ex) {
      console.log(ex);
      resolve(d.jobID);
    }
  }
}

function finished(result) {
  jobs[result] = null;
  startNewJob();
}

var fileList;
var fileIndex = 0;

function startNewJob() {
  var file;
  var i = 0;
  while (i < settings.max_concurrent) {
    if (!jobs[i]) {
      if (fileIndex >= fileList.length) {
        return;
      }
      file = fileList[fileIndex];
      dest = file.replace(settings.source_directory, settings.target_directory);
      dest = dest.split(".");
      dest.splice(-1);
      dest = dest.join(".");
      dest = windows1252.decode(windows1252.encode(dest,{mode:"html"}));
      if (!(fs.existsSync(dest + ".mp3") || fs.existsSync(dest + ".m4a") || file.indexOf(".DS_Store")!==-1)) {
        try {
          jobs[i] = getInfo(file, i).then(convertOrCopy).then(finished);
        } catch (ex) {
          jobs[i] = null;
        }
        i++;
      }
      fileIndex++;

    } else {
      i++;
    }
  }
}

walk(settings.source_directory, function(err, results) {
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
process.stdin.resume();
