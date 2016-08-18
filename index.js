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
var mongo = mongoConnect((col, done) => {
  col.find({}).limit(1).toArray((err, doc) => {
    scores = doc[0];
    done();
    setInterval(() => {
      mongoConnect((col, done) => {
        col.updateOne({}, scores);
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
});

function mongoConnect(cb) {
  MongoClient.connect('mongodb://127.0.0.1:27017/as2tracker', (err, db) => {
    var col = db.collection('storage');
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
          parseScoreboard(body, cb);
        });
      })
    }
  });
}

http.listen(3000, function() {
  console.log('Listening on *:3000');
});
