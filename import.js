var walk        = require('walk');
var fs          = require('fs');
var Parse       = require('parse/node');
var ffmpeg      = require('fluent-ffmpeg');
var readChunk   = require('read-chunk');
var fileType    = require('file-type');
var mkdirp      = require('mkdirp');
var gm          = require('gm');
var getDuration = require('get-video-duration');
var probe       = require('node-ffprobe');
var titleCase   = require('title-case');

var files     = [];
var promises  = []

Parse.initialize("l0aFb4s6u3fgaLYLw9RNRumdpaKpRtvwO9oN0wnN");
Parse.serverURL = 'https://cloud.epic.live/parse'

var dir = process.argv[2];
if (!dir) {
  console.log("Usage: node import.js Directory {Story Name} {-r}")
  return
}

var storyName =  createStoryName(dir)
var timeline = "+"
if (process.argv[3] && process.argv[3].indexOf("-r") === 0) {
  timeline = "-"
}
else if (process.argv[3]) {
  storyName = process.argv[3]
}
if (process.argv[4] && process.argv[4].indexOf("-r") === 0) {
  timeline = "-"
}

var epicUser = {"__type": "Pointer", "className": "_User", "objectId": "sLvU1OMk2b"};

if (storyName.indexOf("\/") >= 0) {
  console.log("Error: Name contains /")
  console.log("arg1 = Directory")
  console.log("arg2 = Story Name")
  return
}

var walker  = walk.walk(dir, { followLinks: false });

walker.on('file', function(root, stat, next) {
    // Add this file to the list of files
    if (stat.name.indexOf(".DS_Store") < 0) {
      files.push(root + '/' + stat.name);
      console.log(stat.name)
    }
    next();
});

walker.on('end', function() {
  var Story = Parse.Object.extend("Story");
  var story = new Story();
  story.set("user", epicUser);
  story.set("name", storyName);
  story.set("momentsCount", files.length);
  story.set("lastMomentDate", getBaseMomentDate())
  story.save(null, {
    success: function (story) {
      console.log("Story Save ok");
      console.log(story.id)

      files.forEach(function(file){
        var buffer = readChunk.sync(file, 0, 262);
        var bufferType = fileType(buffer);
        var type;
        if (bufferType == null) {
          return
        }
        if (bufferType.mime == "video/mp4") {
          type = "video"
        }
        if (bufferType.mime == "image/jpeg") {
          type = "image"
        }
        if (bufferType.mime == "image/png") {
          type = "image"
        }

        var name = getFileName(file)
        if (type == "video") {
          promises.push(addAudioIfNeeded(file))
          promises.push(getScreenShotFromVideo(file, dir))
        }
        else if (type == "image") {
          promises.push(reduceJpegSize(file, dir))
        }

        var parseFile = new Parse.File(name, {base64: base64_encode(file)});
        parseFile.save().then(function() {
          var previewImage = ""
          var mediaFileType = ""
          var duration = ""
          if (type == "image") {
            previewImage = file
            mediaFileType = "public.jpeg"
            duration = 3
            saveMoment(name, previewImage, parseFile, mediaFileType, duration, story)
          }
          else if (type == "video") {
            previewImage = dir + "/thumbs/" + name.replace("mp4", "jpg").replace("mov", "jpg"),
            mediaFileType = "public.mpeg-4"
            getDuration(file).then(function (duration) {
              promises.push(saveMoment(name, previewImage, parseFile, mediaFileType, duration, story))
            })
          }
          else {
            console.log("Error! Why are we here?")
            return
          }

        }, function(error) {
          console.log(error)
        });


      });

      Parse.Promise.when(promises).then(
        function(result) {
          console.log("All promises done.")
        },
        function(error) {
          console.log(error);
      });

    },
    error: function (error) {
        console.log("Save ko");
    }
  });
});

function saveStoryMoment(moment, story, name) {
  var StoryMoment = Parse.Object.extend("StoryMoments")
  var storyMoment = new StoryMoment()
  storyMoment.set("user", epicUser)
  storyMoment.set("moment", moment)
  storyMoment.set("hidden", false)
  storyMoment.set("momentDate", getMomentDate(name))
  storyMoment.set("views", 0)
  storyMoment.set("comments", 0)
  storyMoment.set("likes", 0)
  storyMoment.set("story", story)
  storyMoment.save().then(function() {
    console.log("story moment saved " + storyMoment.id)

  }, function(error) {
    console.log(name)
    console.log(error)
  })

}

function saveMoment(name, previewImage, parseFile, mediaFileType, duration, story) {
  var parseThumbFile = new Parse.File(name.replace("mp4", "jpg").replace("mov", "jpg"), {base64: base64_encode(previewImage)});
  parseThumbFile.save().then(function() {
    var Moment = Parse.Object.extend("Moment");
    var moment = new Moment();
    moment.set("user", epicUser);
    moment.set("mediaFile", parseFile);
    moment.set("previewImage", parseThumbFile);
    moment.set("mediaFileType", mediaFileType);
    moment.set("fileName", name);
    moment.set("duration", duration);
    moment.set("momentDate", getMomentDate(name))
    moment.save().then(function() {
      console.log("moment saved " + moment.id)

      promises.push(saveStoryMoment(moment, story, name))

    }, function(error) {
      console.log(name)
      console.log(error)
    })

  }, function(error) {
    console.log(name)
    console.log(error)
  })
}

function getScreenShotFromVideo(file) {
  mkdirp(dir + '/thumbs', function(err) {
    return promises.push(ffmpeg(file)
      .screenshots({
        timemarks: [ '0' ],
        filename: getFileName(file).replace("mp4", "png").replace("mov", "png"),
        folder: dir + '/thumbs/'
      })
      .on('end', function() {
          console.log('Finished creating thumb for ' + getFileName(file));
          promises.push(makeJpeg(dir + '/thumbs/' + getFileName(file).replace("mp4", "png").replace("mov", "png"), getFileName(file)))
      })
      .on('error', function(err, stdout, stderr) {
        console.log("ffmpeg stdout:\n" + stdout);
        console.log("ffmpeg stderr:\n" + stderr);
      })
    )
  })
}

function reduceJpegSize(image, dir) {
  return gm(image).setFormat("jpg").write(image, function(error){
    if (error) {
      console.log("Error: " + error)
    }
    else {
      console.log("Finished compressing " + getFileName(image));
    }
  });
}

function makeJpeg(image) {
  if (image.indexOf(".png") > 0) {
    gm(image).setFormat("jpg").write(image.replace("png", "jpg"), function(error){
      if (error) {
        console.log(error)
      }
      else {
        console.log("Finished converting thumb png to jpeg for " + getFileName(image));
        return promises.push(fs.unlinkSync(image));
      }
    });
  }
}

function convertToJpeg(dir) {
  var promise = Parse.Promise.as();
  return promise.then(function(){
    console.log("hello")
  })
}

function base64_encode(file) {
    // read binary data
    var bitmap = fs.readFileSync(file);
    // convert binary data to base64 encoded string
    return new Buffer(bitmap).toString('base64');
}

function getBaseMomentDate() {
  var date = dir.split(" ").shift().split("/").pop()
  var pattern = /(\d{2})(\d{2})(\d{2})/;
  return new Date(date.replace(pattern,'20$3-$1-$2'));
}

function addAudioTrack(file) {
  var fileNoSpaces = file.replace(/\ /g, "\\ ")
  var tmpFile = fileNoSpaces.replace("IMG_", "IMG2_")
  var exec = require('child_process').exec;
  exec('ffmpeg -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -i ' + fileNoSpaces + ' \
  -shortest -c:v copy -c:a aac ' + tmpFile + '; mv ' + tmpFile + ' ' + fileNoSpaces, function(error, stdout, stderr) {
    if (!error) {
      console.log("Audio track added to " + getFileName(file))
    }
    else {
     console.log(error)
    }
  });
}

function getFileName(file) {
  return file.split("/").pop()
}

function addAudioIfNeeded(file) {
  var needsAudioTrack = true
  return probe(file, function(err, probeData) {
    probeData.streams.forEach(function(stream) {
        if (stream.codec_name == "aac") {
          needsAudioTrack = false
        }
    })
    if (needsAudioTrack) {
      console.log("No Audio track found for " + getFileName(file))
      addAudioTrack(file)
    }
    else {
      console.log("Audio track found for " + getFileName(file))
    }
  });
}

function createStoryName(dir) {
  var dirPieces = dir.split("/")
  var name = dirPieces.pop()
  if (name == "") {
    name = dirPieces.pop()
  }
  var namePieces = name.split(" ")
  namePieces.shift()
  name = titleCase(namePieces.join(" "))
  return name
}

function getMomentDate(name) {
  var seconds = name.split(".").shift().split("_").pop()
  var momentDate = getBaseMomentDate()
  if (timeline == '-') {
    momentDate.setSeconds(momentDate.getSeconds() - seconds)
  }
  else {
    momentDate.setSeconds(momentDate.getSeconds() + seconds)
  }
  return momentDate
}
