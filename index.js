let app = require('express')();
let http = require('http').Server(app);
let io = require('socket.io')(http);

let fs = require('fs');
let util = require('util');
let deepEqual = require('deep-equal');

let request = require('request');
let MongoClient = require('mongodb').MongoClient;

let xml2js = require('xml2js');

var scores = null;
var songs = null;
mongoConnect('storage', (col, done) => {
  col.find({}).limit(1).toArray((err, doc) => {
    scores = doc[0];
    done();
    setInterval(() => {
      mongoConnect('storage', (col, done) => {
        col.updateOne({}, scores);
        done();
      });
    }, 5000);
  });
});
mongoConnect('songs', (col, done) => {
  col.find({}).limit(1).toArray((err, doc) => {
    songs = doc[0];
    done();
    setInterval(() => {
      mongoConnect('songs', (col, done) => {
        col.updateOne({}, songs);
        done();
      });
    }, 5000);
  });
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/as2tracker-client/index.html');
});

io.on('connection', (socket) => {
  console.log('Connection');
  socket.on('song_update', updateSong);
  socket.on('get_scoreboard', (songid, cb) => {
    var fscores = {};
    Object.keys(scores).filter((mode) => songid in scores[mode]).forEach((mode) => {
      fscores[mode] = getTopScores(cloneObject(scores[mode][songid]));
    });
    if (cb)
      cb(fscores);
  });
  socket.on('init', () => {
    socket.emit('random_songs', getRandomSongs(songs, 10));
  });
});

function getRandomSongs(arr, max) {
  var songs = Object.keys(arr);
  songs.pop();
  var result = new Array(max);
  if (songs.length > max) {
    // Array randomizer (http://stackoverflow.com/a/19270021/1469722)
    var len = songs.length,
        taken = new Array(len);
    while (max--) {
      var x = Math.floor(Math.random() * len);
      result[n] = songs[x in taken ? taken[x] : x];
      taken[x] = --len;
    }
  }
  else {
    result = songs;
  }
  result = result.map((id) => {
    data = arr[id];
    return {
      title: data['title'],
      artist: data['artist'],
      id: id
    };
  });
  return result;
}

function mongoConnect(collection, cb) {
  MongoClient.connect('mongodb://127.0.0.1:27017/as2tracker', (err, db) => {
    var col = db.collection(collection);
    cb(col, () => db.close());
  });
}

function zeroPrefix(a) {
  return a.toString().length == 1 ? '0' + a : a;
}

function cloneObject(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getTopScores(scores) {
  Object.keys(scores).map((user) => {
    rides = scores[user];
    newest = new Date(Math.max.apply(null, Object.keys(rides).map(d => new Date(d))));
    dateString = [
      [zeroPrefix(newest.getFullYear()),
       zeroPrefix(newest.getMonth() + 1), // Thanks Java
       zeroPrefix(newest.getDate())].join('-'),
      [zeroPrefix(newest.getHours()),
       zeroPrefix(newest.getMinutes()),
       zeroPrefix(newest.getSeconds())].join(':')].join(' ');
    scores[user] = scores[user][dateString];
  });
  return scores;
}

function parseScoreboard(xml, cb) {
  xml2js.parseString(xml, (err, obj) => {
    var scoreboards = obj.document.scoreboards[0].scoreboard;
    var global = scoreboards.filter((el, i, arr) => {
      return el.$.name == "public";
    })[0];
    var rides = global.ride.map((ride) => {
      return {
        username: ride.username[0],
        userid: ride.$.userid,
        steamid: ride.$.steamid,
        score: ride.$.score,
        ridetime: ride.$.ridetime
      }
    });
    var mode = obj.document.modename[0].$.modename;
    if (!(mode in scores)) {
      scores[mode] = {};
    }
    var songid = obj.document.scoreboards[0].$.songid;
    if (!(songid in scores[mode])) {
      scores[mode][songid] = {};
    }
    var o = scores[mode][songid];
    var n = cloneObject(o);
    for (var ride of rides) {
      if (!(ride.userid in n)) {
        n[ride.userid] = {};
      }
      n[ride.userid][ride.ridetime] = ride;
    }
    scores[mode][songid] = cloneObject(n);
    var oldTop = getTopScores(o);
    var newTop = getTopScores(n);
    var changes = {'new': [], 'change':[]};
    for (var entry in newTop) {
      if (!(entry in oldTop)) {
        changes['new'].push(newTop[entry]);
      }
      else if (!deepEqual(oldTop[entry], newTop[entry])) {
        changes['change'].push({
          'old': oldTop[entry],
          'new': newTop[entry]
        });
      }
    }
    if (cb)
      cb(songid, changes);
  });
}

function updateSong(title, artist, duration, cb) {
  console.log('Got song:', title, artist);
  fs.readdir('modes', (err, files) => {
    for (file of files) {
      fs.readFile('modes/' + file, (err, script) => {
        request.post('http://audiosurf2.com/as/airgame_rides6.php', {
          form: {
            title: title,
            artist: artist,
            duration: duration,
            density: 0,
            source: script,
            steamid: -1
          }
        }, (err, response, body) => {
          if (err) console.log(err);
          parseScoreboard(body, (songid, mode, changes) => {
            cb(songid, mode, changes);
            songs[songid] = {title: title, artist: artist};
            io.emit('update', title, artist, songid, mode, changes);
          });
        });
      })
    }
  });
}

http.listen(3000, function() {
  console.log('Listening on *:3000');
});
