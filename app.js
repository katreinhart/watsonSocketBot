/*eslint-env node*/

//------------------------------------------------------------------------------
// Application Authors
// This application is based off of the socket.io chat example seen here (https://github.com/socketio/socket.io)
// Watson Tone Analyzer and SockBot implementation built by Stefania Kacmarczyk (https://github.com/slkaczma)
// Language Translation and Conversation implemented by Oliver Rodriguez (https://github.com/odrodrig)
//------------------------------------------------------------------------------

var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var request = require('request-promise');

// Pull in Watson Developer Cloud library
var watson = require('watson-developer-cloud');

// cfenv provides access to your Cloud Foundry environment
// for more info, see: https://www.npmjs.com/package/cfenv
var cfenv = require('cfenv');

// Get the app environment from Cloud Foundry
var appEnv = cfenv.getAppEnv();

// Get services from environment variables
var services = appEnv.services;

var username = '';
var password = '';

if (appEnv.isLocal) {
  console.log('Running Locally. Deploy to Bluemix for this app to work.');
} else {
  // If running in the cloud, then we will pull the service credentials from
  // the environment variables
  console.log('Running in Cloud');
  const watsonCreds = services.language_translator[0].credentials;
  const toneCreds = services.tone_analyzer[0].credentials;
  const conversationCreds = services.conversation[0].credentials;

  username = watsonCreds.username;
  password = watsonCreds.password;

  toneUser = toneCreds.username;
  tonePass = toneCreds.password;

  conversationUser = conversationCreds.username;
  conversationPass = conversationCreds.password;

}

const languageTranslation = new watson.LanguageTranslatorV2({
  username: username,
  password: password,
  url: 'https://gateway.watsonplatform.net/language-translator/api/',
});

const toneAnalyzer = watson.tone_analyzer({
  url: 'https://gateway.watsonplatform.net/tone-analyzer/api/',
  username: toneUser,
  password: tonePass,
  version_date: '2016-05-19',
  version: 'v3',
});

const conversation = new watson.ConversationV1({
  username: process.env.CONVERSATION_USERNAME || conversationUser,
  password: process.env.CONVERSATION_PASSWORD || conversationPass,
  url: 'https://gateway.watsonplatform.net/conversation/api',
  version_date: watson.ConversationV1.VERSION_DATE_2017_02_03,
});

// Serve the files out of ./public as our main files
app.use(express.static(__dirname + '/public'));

http.listen(appEnv.port, function () {
  console.log('listening on ' + appEnv.port);
});

// Chatroom
var numUsers = 0;
var chatHistory = [];
var context = {};

io.on('connection', function (socket) {
  var addedUser = false;
  console.log('connected to socket.io');

  // When the client emits 'new message', this listens and executes
  socket.on('new message', function (data) {
    // We tell the client to execute 'new message'
    console.log('in new message: ' + data);
    chatHistory.push(data.message);

    getTone(data.message);

    socket.broadcast.emit('new message', {
      username: socket.username,
      message: data.message,
    });
  });

  // When the client emits 'add user', this listens and executes
  socket.on('add user', function (username) {
    if (addedUser) return;
    console.log('added user');

    // We store the username in the socket session for this client
    socket.username = username;
    ++numUsers;
    addedUser = true;
    socket.emit('login', {
      numUsers: numUsers,
    });

    // Echo globally (all clients) that a person has connected
    socket.broadcast.emit('user joined', {
      username: socket.username,
      numUsers: numUsers,
    });
  });

  // When the client emits 'typing', we broadcast it to others
  socket.on('typing', function () {
    socket.broadcast.emit('typing', {
      username: socket.username,
    });
  });

  // When the client emits 'stop typing', we broadcast it to others
  socket.on('stop typing', function () {
    socket.broadcast.emit('stop typing', {
      username: socket.username,
    });
  });

  // When the user disconnects.. perform this
  socket.on('disconnect', function () {
    if (addedUser) {
      --numUsers;

      // Echo globally that this client has left
      socket.broadcast.emit('user left', {
        username: socket.username,
        numUsers: numUsers,
      });
    }
  });

  /***********************************************************************
  Translation Socket
  ***********************************************************************/

  // When a translation tag is read from chat
  socket.on('translate', function (data) {

    console.log(data.message);
    console.log(data.sourceLang);
    console.log(data.targetLang);

    languageTranslation.translate({
      text: data.message, source: data.sourceLang, target: data.targetLang, },
     function (err, translation) {

      console.log('Watson will translate : ' + data.message);

      if (err) {
        console.log('error:', err);

        socket.emit('translationResults', {
          username: 'Watson',
          message: 'Error translating. Try again.',
        });

        socket.broadcast.emit('translationResults', {
          username: 'Watson',
          message: 'Error translating. Try again.',
        });

      } else {
        console.log(translation.translations[0].translation);
        data.message = translation.translations[0].translation;

        socket.emit('translationResults', {
          username: 'Watson',
          message: data.message,
        });

        socket.broadcast.emit('translationResults', {
          username: 'Watson',
          message: data.message,
        });
      }
    });
  });

  /***********************************************************************
  Watson Socket
  ************************************************************************/
  socket.on('watson', function (data) {

      console.log('Watson socket called');

      const payload = {
        workspace_id: process.env.WORKSPACE_ID || '46903078-ded7-4ec9-b12b-4a7b80f78a1d',
        input: { text: data.message },
        context: context,
      };

      conversation.message(payload, function (err, data) {

        console.log(data);

        if (err) {
          console.error(JSON.stringify(err, null, 2));
        } else {
          var response = data.output.text[0];

          socket.emit('new message', {
            username: 'Watson',
            message: response,
          });

          socket.broadcast.emit('new message', {
            username: 'Watson',
            message: response,
          });
        }
      });
    });

  function getTone(data) {
    var tones;
    var message;
    var name;
    var score;

    toneAnalyzer.tone({ text: data }, function (err, results) {
      if (err)
       console.log('Error getting tone: ' + err);
      else {
        tones = results.document_tone.tone_categories[0].tones;
        var stats = [];

        for (var i = 0; i < tones.length; i++) {
          name = tones[i].tone_name;
          score = tones[i].score;

          stats.push(score);

          console.log(name + ':' + score);
        }

        var topTrait = Math.max.apply(Math, stats);
        var topTraitPercent = (topTrait * 100).toFixed(2);

        if (topTraitPercent > 60.00) {

          switch (topTrait){
            case stats[0]:
              name = tones[0].tone_name;
              message = "The chat is too volatile. Let's be nice! Anger at " + topTraitPercent + '%';
              botTalk(message);
            break;
            case stats[1]:
              name = tones[1].tone_name;
              message = "I'm sorry, I did not mean to offend you. " + topTraitPercent + '% disgusted';
              botTalk(message);
            break;
            case stats[2]:
              name = tones[2].tone_name;
              message = "Muahahahaha! I have made you " + topTraitPercent + '% afraid. FEAR ME!'
              botTalk(message);
            break;
            case stats[3]:
              name = tones[3].tone_name;
              message = "Woohoo! PARTY!" + topTraitPercent + "% joyful."
              botTalk(message);
            break;
            case stats[4]:
              name = tones[4].tone_name;
              message = 'Cheer up ' + socket.username + '. Sadness at ' + topTraitPercent + '%';
              botTalk(message);
            break;
          }
        }
      }
    });
  }

  function botTalk(message) {
    socket.emit('new message', {
      username: 'SockBot',
      message: message,
    });

    socket.broadcast.emit('new message', {
      username: 'SockBot',
      message: message,
    });
  }
});
