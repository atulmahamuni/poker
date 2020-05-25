var express = require('express'),
	app = express(),
	server = require('http').createServer(app),
	io = require('socket.io').listen(server),
	lessMiddleware = require('less-middleware'),
	path = require('path'),
	Table = require('./poker_modules/table'),
	Player = require('./poker_modules/player');

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(app.router);
app.use(lessMiddleware(__dirname + '/public'));
app.use(express.static(path.join(__dirname, 'public')));

// Development Only
if ( 'development' == app.get('env') ) {
	app.use( express.errorHandler() );
}

var players = [];
var tables = [];
var eventEmitter = {};

var port = process.env.PORT || 3000;
server.listen(port);
console.log('Listening on port ' + port);

// The lobby
app.get('/', function( req, res ) {
	res.render('index');
});

// The lobby data (the array of tables and their data)
app.get('/lobby-data', function( req, res ) {
	var lobbyTables = [];
	for ( var tableId in tables ) {
		// Sending the public data of the public tables to the lobby screen
		if( !tables[tableId].privateTable ) {
			lobbyTables[tableId] = {};
			lobbyTables[tableId].id = tables[tableId].public.id;
			lobbyTables[tableId].name = tables[tableId].public.name;
			lobbyTables[tableId].seatsCount = tables[tableId].public.seatsCount;
			lobbyTables[tableId].playersSeatedCount = tables[tableId].public.playersSeatedCount;
			lobbyTables[tableId].bigBlind = tables[tableId].smallBlind * 2;
            lobbyTables[tableId].smallBlind = tables[tableId].smallBlind;
            lobbyTables[tableId].defaultActionTimeout = tables[tableId].public.defaultActionTimeout;
            lobbyTables[tableId].minBet = tables[tableId].public.minBet;
		}
	}
	res.send( lobbyTables );
});

// If the table is requested manually, redirect to lobby
app.get('/table-10/:tableId', function( req, res ) {
	res.redirect('/');
});

// If the table is requested manually, redirect to lobby
app.get('/table-6/:tableId', function( req, res ) {
	res.redirect('/');
});

// If the table is requested manually, redirect to lobby
app.get('/table-2/:tableId', function( req, res ) {
	res.redirect('/');
});

// The table data
app.get('/table-data/:tableId', function( req, res ) {
	if( typeof req.params.tableId !== 'undefined' && typeof tables[req.params.tableId] !== 'undefined' ) {
		res.send( { 'table': tables[req.params.tableId].public } );
	}
});

io.sockets.on('connection', function( socket ) {

	/**
	 * When a player enters a room
	 * @param object table-data
	 */
	socket.on('enterRoom', function( tableId, callback ) {
		if( typeof players[socket.id] !== 'undefined') {
			if (players[socket.id].room === null) {
				// Add the player to the socket room
				socket.join('table-' + tableId);
				// Add the room to the player's data
				players[socket.id].room = tableId;
			} else {
				let table = players[socket.id].sittingOnTable;
				callback({
					'success': true,
					'table': (table) ? table.public : null,
					'seat' : players[socket.id].seat,
					'buttons': (table && players[socket.id].seat == table.public.activeSeat) ? players[socket.id].buttons : ''
				});

				players[socket.id].socket.emit('dealingCards', players[socket.id].cards);
			}
		}
	});

	/**
	 * When a player leaves a room
	 */
	socket.on('leaveRoom', function() {
		if( typeof players[socket.id] !== 'undefined' && players[socket.id].room !== null && players[socket.id].sittingOnTable == null) {
			// Remove the player from the socket room
			socket.leave( 'table-' + players[socket.id].room );
			// Remove the room to the player's data
			players[socket.id].room = null;
		}
	});

	/**
	 * When a player disconnects
	 */
	//TODO allow player to reconnect
	socket.on('disconnect', function() {
		var table = getTable(socket);
		var player = players[socket.id];
		if (table && player) {
			player.disconnected = true;
			// // Remove the player from the seat
			// players[socket.id].playerLeft();
			// // Remove the player object from the players array
			// delete players[socket.id];
		}
	});

	/**
	 * When a new player enters the application
	 * @param string newScreenName
	 * @param function callback
	 */
	socket.on('register', function( newScreenName, callback ) {
		// If a new screen name is posted
		var player = null;
		if( typeof newScreenName !== 'undefined' ) {
			var newScreenName = newScreenName.trim();
			// If the new screen name is not an empty string
			if( newScreenName && typeof players[socket.id] === 'undefined' ) {
				var nameExists = false;
				for( player of players ) {
					if( player.public.name && player.public.name == newScreenName ) {
						nameExists = true;
						break;
					}
				}
				if( !nameExists ) {
					// Creating the player object
					players[socket.id] = new Player( socket, newScreenName, 1000 );
					callback( { 'success': true, screenName: newScreenName, totalChips: players[socket.id].chips } );
				} else {
					if (player.disconnected) {
						players[socket.id] = player;
						callback( { 'success': true, reconnect: true, screenName: newScreenName, totalChips: players[socket.id].chips } )
					} else {
						callback({'success': false, 'message': 'This name is taken'});
					}
				}
			} else {
				callback( { 'success': false, 'message': 'Please enter a screen name' } );
			}
		} else {
			callback( { 'success': false, 'message': '' } );
		}
	});

	/**
	 * When a player requests to sit on a table
	 * @param function callback
	 */
	socket.on('sitOnTheTable', function( data, callback ) {
		if( 
			// A seat has been specified
			typeof data.seat !== 'undefined'
			// A table id is specified
			&& typeof data.tableId !== 'undefined'
			// The table exists
			&& typeof tables[data.tableId] !== 'undefined'
			// The seat number is an integer and less than the total number of seats
			&& typeof data.seat === 'number'
			&& data.seat >= 0 
			&& data.seat < tables[data.tableId].public.seatsCount
			&& typeof players[socket.id] !== 'undefined'
			// The seat is empty
			&& tables[data.tableId].seats[data.seat] == null
			// The player isn't sitting on any other tables
			&& players[socket.id].sittingOnTable == null
			// The player had joined the room of the table
			&& players[socket.id].room === data.tableId
			// The chips number chosen is a number
			&& typeof data.chips !== 'undefined'
			&& !isNaN(parseInt(data.chips)) 
			&& isFinite(data.chips)
			// The chips number is an integer
			&& data.chips % 1 === 0
		){
			// The chips the player chose are less than the total chips the player has
			if( data.chips > players[socket.id].chips )
				callback( { 'success': false, 'error': 'You don\'t have that many chips' } );
			else if( data.chips > tables[data.tableId].public.maxBuyIn || data.chips < tables[data.tableId].public.minBuyIn )
				callback( { 'success': false, 'error': 'The amount of chips should be between the maximum and the minimum amount of allowed buy in' } );
			else {
				// Give the response to the user
				callback( { 'success': true } );
				// Add the player to the table
				tables[data.tableId].playerSatOnTheTable( players[socket.id], data.seat, data.chips );
			}
		} else {
			// If the user is not allowed to sit in, notify the user
			callback( { 'success': false } );
		}
	});

	/**
	 * Start a game if there are more than 2 players
	 * @param function callback
	 */
	socket.on('startGame', function(data,callback) {
		table = tables[data.tableId];
		if( !table.public.gameIsOn && table.public.playersSeatedCount > 1 ) {
			callback({'success': true});
			table.startGame();
		} else {
				callback( { 'success': false, 'error': 'Need at least 2 players'} );
		}
	})

	/**
	 * When a player checks
	 * @param function callback
	 */
	socket.on('autoPlay', function(callback){
		var player = players[socket.id];
		var table = (player) ? player.sittingOnTable : null;

		if (table && player) {
			player.public.autoPlay = !player.public.autoPlay;
			callback( {
				'success': true,
				'autoPlay': player.public.autoPlay
			});
		}
	});

	/**
	 * When a player checks
	 * @param function callback
	 */
	socket.on('check', function(callback){
		var table = getTable(socket);
		var player = players[socket.id];
		if (table && player && table.public.biggestBet === player.public.bet) {
			callback( { 'success': true } );
			table.playerChecked();
		}
	});

	/**
	 * When a player folds
	 * @param function callback
	 */
	socket.on('fold', function( callback ){
		if (table = getTable(socket)) {
			// Sending the callback first, because the next functions may need to send data to the same player, that shouldn't be overwritten
			callback({'success': true});
			table.playerFolded();
		}
	});

	/**
	 * When a player calls
	 * @param function callback
	 */
	socket.on('call', function( callback ){
		if (table = getTable(socket)) {
			callback({'success': true});
			table.playerBet(0);
		}
	});

	/**
	 * When a player bets
	 * @param number amount
	 * @param function callback
	 */
	socket.on('bet', function(amount, raised, callback) {
		if (table = getTable(socket)) {
			player = table.seats[table.public.activeSeat];
			// Validating the bet amount
			amount = parseInt(amount);
			if (amount && isFinite(amount)) {
				// Sending the callback first, because the next functions may need to send data to the same player, that shouldn't be overwritten
				callback({'success': true});
				table.playerBet(amount, raised);
			}
		}
	});

	/**
	 * When a message from a player is sent
	 * @param string message
	 */
	socket.on('sendMessage', function( message ) {
		message = message.trim();
		if( message && players[socket.id].room ) {
			socket.broadcast.to( 'table-' + players[socket.id].room ).emit( 'receiveMessage', { 'message': htmlEntities( message ), 'sender': players[socket.id].public.name } );
		}
	});
});

var getTable = function (socket) {
	table = (players[socket.id]) ? players[socket.id].sittingOnTable : null;
	return (table && table.public.activeSeat != null && table.seats[table.public.activeSeat].socket.id === socket.id) ? table : null;
}
/**
 * Event emitter function that will be sent to the table objects
 * Tables use the eventEmitter in order to send events to the client
 * and update the table data in the ui
 * @param string tableId
 */
var eventEmitter = function( tableId ) {
	return function ( eventName, eventData ) {
		io.sockets.in( 'table-' + tableId ).emit( eventName, eventData );
	}
}

/**
 * Changes certain characters in a string to html entities
 * @param string str
 */
function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Read configuration from the config file and create table appropriately
const fs = require('fs');
console.log ("reading file")
fs.readFile('./config/config.json', 'utf-8', (err, data) => {
    console.log ("File read")
    if (err) {
      console.error("please update config.json")
      return
    }
    console.log(data)
    config = JSON.parse(data);
    var tableCount = 0;
    for (table of config.tables) {
        tables[tableCount] = new Table( tableCount, table.name, eventEmitter(tableCount), 
            table.numPlayers, table.smallBlind,
            table.maxBuyIn, table.minBuyIn, table.isPrivate,
            table.defaultActionTimeout, table.minBet, table.recordReplayEnabled);
        tableCount++;
    }
})
