var settings = require("./settings_flac.json");
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
    if (!settings.filter_low_bitrate_mode) {
      d.data.format.dest_filename = d.data.format.dest_filename.replace(/[^\x00-\x7F]/g, "");
    }
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
    if (settings.filter_low_bitrate_mode) {
      if (d.data.streams[0].codec_name==="alac") {
        copy(d, {}, resolve, reject);
      } else {
        resolve(d.jobID);
      }
      return;
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

function get_bitrate(file) {
  return new Promise(function(resolve, reject) {
    var command = shell_escape([
      "ffprobe",
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=bit_rate",
      file
    ]);
    console.log(command);
    exec(command, function(err, out) {
      if (err) {
        console.log("bad command: " + command);
        resolve(null);
        return;
      } else {
        var d = JSON.parse(out);
        console.log(d);
        resolve(d.streams[0].bit_rate);
        return;
      }
    });
  });
}

function copy(d, new_metadata, resolve, reject) {
  if (d.data===null) {
    resolve(d.jobID);
    return;
  }
  var path = d.data.format.dest_filename;
  var path_arr = path.split("/");
  var filename = path_arr.splice(-1)[0];
  var ext = filename.split(".");
  ext = "." + ext[ext.length-1];
  path = path_arr.join("/");
  if (new_metadata.TRACKNUMBER) {
    filename = left_pad(new_metadata.TRACKNUMBER,2) + filename;
  }
  if (new_metadata.DISCNUMBER) {
    filename = left_pad(new_metadata.DISCNUMBER,2) + filename;
  }
  path = path + "/" + filename;
  
  var tmp = settings.target_directory + "/" + uuid(filename, uuid_namespace);
  var path_dir;
  if (!settings.filter_low_bitrate_mode) {
    path_dir = windows1252.decode(windows1252.encode(path_arr.join("/"), {mode:"html"}));
  } else {
    path_dir = path_arr.join("/");
  }
  mkDirByPathSync(settings.target_directory + path_dir);
  var dest = settings.target_directory + path; 
  if (!settings.filter_low_bitrate_mode) {
    dest = windows1252.decode(windows1252.encode(dest,{mode:"html"}));
  }
  dest_file_list[dest] = true;
  var exists_at_dest = false;
  if (fs.existsSync(dest)) {
    exists_at_dest = true;
    if (ext===".flac") {
      resolve(d.jobID);
      return;
    }
    get_bitrate(dest).then(function(br) {
      if (!br) {
        resolve(d.jobID);
        return;
      }
      get_bitrate(d.data.format.filename).then(function(source_br) {
        if (br >= 0.9*settings.target_bitrate*1000  || br >= source_br) {
          console.log("existing bitrate is fine");
          resolve(d.jobID);
        } else {
          console.log("existing bitrate too low, proceeding");
          finish();
        }
      });
      
    });
  } else {
    finish();
  }
  function finish() {
    console.log("Copy " + d.data.format.filename);
    fs.readFile(d.data.format.filename, function(err, data) {
      console.log(err);
      fs.stat(d.data.format.filename, function(err, stats) {
        console.log(err);
        fs.writeFile(tmp, data, function(err) {
          console.log(tmp);
          if (err) {
            console.log(err);
          }
          if (exists_at_dest) {
            fs.unlinkSync(dest);
          }
          fs.rename(tmp, dest, function() {
            fs.utimes(dest, stats.atime, stats.mtime, function(err) {
              console.log(err);
              resolve(d.jobID);
            });
          });
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

  var exists_at_dest = false;
  if (fs.existsSync(dest)) {
    exists_at_dest = true;
    if (ext===".flac") {
      resolve(d.jobID);
      return;
    }
    get_bitrate(dest).then(function(br) {
      if (!br) {
        resolve(d.jobID);
      } else if (br >= 0.9*settings.target_bitrate*1000) {
        console.log("existing bitrate is fine");
        resolve(d.jobID);
      } else {
        console.log("existing bitrate too low, proceeding");
        finish();
      }
    });
  } else {
    finish();
  }
  function finish() {
    var tmp = settings.target_directory + "/" + uuid(filename, uuid_namespace) + ext;
    try {
      console.log("Converting " + d.data.format.filename);
      
      fs.stat(d.data.format.filename, function(err, stats) {
        console.log(err);
        var cmd_arr = [
          "ffmpeg",
          "-i",
          d.data.format.filename,
          "-strict",
          "-2",
          "-ac",
          "2",
          "-vn",
          "-sample_fmt",
          "s16"
        ];
        if (codec !== "alac" && codec !== "flac") {
          cmd_arr = cmd_arr.concat([
          "-ab",
          settings.target_bitrate + "k"
          ]);
        }
        cmd_arr = cmd_arr.concat([
          "-acodec",
          codec
        ]);
        if (settings.passthrough_sample_rate !== true) {
          cmd_arr = cmd_arr.concat([
            "-ar",
            "44100"
          ])
        }
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
          if (exists_at_dest) {
            fs.unlinkSync(dest);
          }
          fs.rename(tmp, dest, function() {
            fs.utimes(dest, stats.atime, stats.mtime, function(err) {
              console.log(err);
              resolve(d.jobID);
            });
          });
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
