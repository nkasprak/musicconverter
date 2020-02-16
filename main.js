var settings = require("./settings.json");
var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var ffmpeg = require("fluent-ffmpeg");
var shell_escape = require("shell-escape");
var windows1252 = require("windows-1252");
var uuid = require('uuid/v5');
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
      var file_arr = file.split(".");
      var ext = file_arr[file_arr.length-1];
      if (ext!=="m4a" && ext!=="mp3" && ext!=="flac" && ext!=="mp4") {
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
          resolve({data:null,jobID:jobID});
          return;
        } else {
        try {resolve({data: JSON.parse(out), jobID: jobID});}
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
var convertOrCopy = function(d) {
  return new Promise(function(resolve, reject) {
    if (d.data===null) {
      resolve(d.jobID);
    }
    var tags = {};
    if (d.data.format.tags) {
      tags = d.data.format.tags;
    }
    d.data.format.dest_filename = d.data.format.filename.replace(settings.source_directory,"");
    d.data.format.dest_filename = d.data.format.dest_filename.replace(/[^\x00-\x7F]/g, "");
    var new_metadata = {};
    if (tags.track) {
      var track = tags.track.split("/");
      new_metadata.TRACKNUMBER = track[0];
      if (track.length > 1) {
        new_metadata.TOTALTRACKS = track[1];
      }
    }
    if (tags.disc) {
      var disc = tags.disc.split("/");
      new_metadata.DISCNUMBER = disc[0];
      if (disc.length > 1) {
        new_metadata.TOTALDISCS = disc[1];
      }
    }
    if (settings.output_flac) {
      if (d.data.streams[0].codec_name==="alac") {
        var force_lossy = settings.force_lossy || false;
        if (d.data.format.bit_rate/1000 < settings.convert_bitrate_threshold*1) {
          convert(d, new_metadata, force_lossy, resolve, reject);
        } else {
          convert(d,  new_metadata, true, resolve, reject);
        }
      } else {
        copy(d,  new_metadata, resolve, reject);
      }
    } else {
      if (d.data.format.bit_rate/1000 < settings.convert_bitrate_threshold*1) {
        copy(d,  new_metadata, resolve, reject);
      } else {
        convert(d, new_metadata, true, resolve, reject);
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

function copy(d, new_metadata, resolve, reject) {
  if (d.data===null) {
    resolve(d.jobID);
    return;
  }
  var path = d.data.format.dest_filename;
  var path_arr = path.split("/");
  var filename = path_arr.splice(-1)[0];
  path = path_arr.join("/");
  /*if (new_metadata.TRACKNUMBER) {
    filename = left_pad(new_metadata.TRACKNUMBER,2) + filename;
  }
  if (new_metadata.DISCNUMBER) {
    filename = left_pad(new_metadata.DISCNUMBER,2) + filename;
  }*/
  path = path + "/" + filename;
  
  var tmp = settings.target_directory + "/" + uuid(filename, uuid_namespace);
  var path_dir = windows1252.decode(windows1252.encode(path_arr.join("/"), {mode:"html"}));
  mkDirByPathSync(settings.target_directory + path_dir);
  var dest = settings.target_directory + path;
  dest = windows1252.decode(windows1252.encode(dest,{mode:"html"}));
  dest_file_list[dest] = true;
  if (fs.existsSync(dest)) {
    resolve(d.jobID);
  } else {
    console.log("Copy " + d.data.format.filename);
    fs.readFile(d.data.format.filename, function(err, data) {
      fs.writeFile(tmp, data, function(err) {
        if (err) {
          console.log(err);
        }
        fs.rename(tmp, dest, function() {
          resolve(d.jobID);
        });
      });
    });
  }
}

function left_pad(n, zeroes) {
  n = n + "";
  while (n.length < zeroes) {
    n = "0" + n;
  }
  return n;
}

function convert(d, new_metadata, force_lossy, resolve, reject) {
  var path = d.data.format.dest_filename;
 
  var path_arr = path.split("/");
  var filename = path_arr.splice(-1)[0];
  filename = filename.split(".");
  filename.splice(-1);
  var ext = ".m4a";
  if (settings.output_flac && !force_lossy) {
    ext = ".flac";
  }
  filename = filename.join(".") + ext;
  /*if (new_metadata.TRACKNUMBER) {
    filename = left_pad(new_metadata.TRACKNUMBER,2) + filename;
  }
  
  if (new_metadata.DISCNUMBER) {
    filename = left_pad(new_metadata.DISCNUMBER,2) + filename;
  }*/
  var path_dir = path_arr.join("/");
  path_dir = windows1252.decode(windows1252.encode(path_arr.join("/"), {mode:"html"}));
  mkDirByPathSync(settings.target_directory + path_dir);
  var dest = settings.target_directory + path_dir + "/" + filename;
  dest = windows1252.decode(windows1252.encode(dest,{mode:"html"}));
  dest_file_list[dest] = true;
  var codec = "libfdk_aac";
  if (settings.output_flac && !force_lossy) {
    codec = "flac";
  }
  if (settings.output_alac && !force_lossy) {
    codec = "alac";
  }
  if (fs.existsSync(dest)) {
    resolve(d.jobID);
  } else {
    var tmp = settings.target_directory + "/" + uuid(filename, uuid_namespace) + ext;
    try {
      console.log("Converting " + d.data.format.filename);
      var cmd_arr = [
        "ffmpeg",
        "-i",
        d.data.format.filename,
        "-strict",
        "-2",
        "-ac",
        "2",
        "-vn",
        "-ab",
        settings.target_bitrate + "k",
        "-acodec",
        codec,
        "-ar",
        "44100"
      ];
      if (new_metadata) {
        Object.keys(new_metadata).forEach((key)=> {
          cmd_arr.push("-metadata");
          cmd_arr.push(key + "=" + new_metadata[key]);
        });
      }
      cmd_arr.push(tmp);
      var command = shell_escape(cmd_arr);
      console.log(command);
      exec(command, function(err, stdout) {
        if (err) {
          console.log(err);
        }
        fs.rename(tmp, dest, function() {
          resolve(d.jobID);
        });
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
            jobs[i] = getInfo(file, i).then(convertOrCopy).then(finished);
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
    console.log("finished file walk, checking for deleted files in destination...");
    walk(settings.target_directory, function(err, results) {
      results.forEach((file)=> {
        if (!dest_file_list[file]) {
          if (deleteUnmanaged) {
            fs.unlinkSync(file);
            console.log("deleted " + file);
          } else {
            console.log("would delete " + file +", use --delete");
          }
        }
      });
    });
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
//process.stdin.resume();
