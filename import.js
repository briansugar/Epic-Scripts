var walk        = require('walk');
var fs          = require('fs');
var Parse       = require('parse/node');
var ffmpeg      = require('fluent-ffmpeg');
var readChunk   = require('read-chunk');
var fileType    = require('file-type');
var mkdirp      = require('mkdirp');
var gm          = require('gm');
var getDuration = require('get-video-duration');

var files     = [];
var promises  = []

Parse.initialize("l0aFb4s6u3fgaLYLw9RNRumdpaKpRtvwO9oN0wnN");
Parse.serverURL = 'https://cloud.epic.live/parse'

var storyName = process.argv[2];
var dir = process.argv[3];
var epicUser = {"__type": "Pointer", "className": "_User", "objectId": "sLvU1OMk2b"};

if (storyName.indexOf("\/") >= 0) {
  console.log("Error: Name contains /")
  console.log("arg1 = Story Name")
  console.log("arg2 = Directory")
  return
}

var walker  = walk.walk(dir, { followLinks: false });

walker.on('file', function(root, stat, next) {
    // Add this file to the list of files
    files.push(root + '/' + stat.name);
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

        var name = file.split("/").pop()
        if (type == "video") {
          promises.push(getScreenShotFromVideo(file, name, dir))
        }
        else if (type == "image") {
          promises.push(reduceJpegSize(file, name, dir))
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

  var seconds = name.split(".").shift().split("_").pop()
  var momentDate = getBaseMomentDate()
  momentDate.setSeconds(momentDate.getSeconds() + 10)
  var StoryMoment = Parse.Object.extend("StoryMoments")
  var storyMoment = new StoryMoment()
  storyMoment.set("user", epicUser)
  storyMoment.set("moment", moment)
  storyMoment.set("hidden", false)
  storyMoment.set("momentDate", momentDate)
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

function getScreenShotFromVideo(file, name) {
  mkdirp(dir + '/thumbs', function(err) {
    return promises.push(ffmpeg(file)
      .screenshots({
        timemarks: [ '0' ],
        filename: name.replace("mp4", "png").replace("mov", "png"),
        folder: dir + '/thumbs/'
      })
      .on('end', function() {
          console.log('Finished creating thumb for ' + name);
          promises.push(makeJpeg(dir + '/thumbs/' + name.replace("mp4", "png").replace("mov", "png"), name))
      })
      .on('error', function(err, stdout, stderr) {
        console.log("ffmpeg stdout:\n" + stdout);
        console.log("ffmpeg stderr:\n" + stderr);
      })
    )
  })
  // return promise.then(function() {
  //   var proc = new ffmpeg(file)
  //   proc.takeScreenshots({
  //     count: 1,
  //     timemarks: [ '0' ],
  //     filename: name.replace("mp4", "png").replace("mov", "png")
  //   }, dir + '/thumbs/')
  // });
}

function reduceJpegSize(image, name, dir) {
  return gm(image).setFormat("jpg").write(image, function(error){
    if (error) {
      console.log("Error: " + error)
    }
    else {
      console.log("Finished compressing " + name);
    }
  });
}

function makeJpeg(image, name) {
  if (image.indexOf(".png") > 0) {
    gm(image).setFormat("jpg").write(image.replace("png", "jpg"), function(error){
      if (error) {
        console.log(error)
      }
      else {
        console.log("Finished converting thumb png to jpeg for " + name);
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
