var Deck = require('./deck'),
	Pot = require('./pot');

// DEVELOPMENT PURPOSES
const fs = require('fs');
/**
 * The table "class"
 * @param string	id (the table id)
 * @param string	name (the name of the table)
 * @param object 	deck (the deck object that the table will use)
 * @param function 	eventEmitter (function that emits the events to the players of the room)
 * @param int 		seatsCount (the total number of players that can play on the table)
 * @param int 		bigBlind (the current big blind)
 * @param int 		smallBlind (the current smallBlind)
 * @param int 		maxBuyIn (the maximum amount of chips that one can bring to the table)
 * @param int 		minBuyIn (the minimum amount of chips that one can bring to the table)
 * @param bool 		privateTable (flag that shows whether the table will be shown in the lobby)
 */
var Table = function( id, name, eventEmitter, seatsCount, smallBlind, maxBuyIn, minBuyIn, privateTable,
					  defaultActionTimeout, minBet, recordReplayEnabled ) {
	// The table is not displayed in the lobby
	this.privateTable = privateTable;
	// The number of players who receive cards at the begining of each round
	//this.playersSittingInCount = 0;
	// The number of players that currently hold cards in their hands
	this.playersInHandCount = 0;
	// The number of players that went all-in
	this.playersAllIn = 0;
	// Reference to the last player that will act in the current phase (originally the dealer, unless there are bets in the pot)
	this.lastPlayerToAct = null;
    // The small blind amount
    this.smallBlind = smallBlind;
    // Current small blind
    this.currentSmall = 0;
	// Increase blinds when this player is dealer
    this.incBlindsSeat = null;
	// The game has only two players
	this.headsUp = false;
	// References to all the player objects in the table, indexed by seat number
	this.seats = [];
	// The deck of the table
	this.deck = new Deck;
	// The function that emits the events of the table
	this.eventEmitter = eventEmitter;
	// The pot with its methods
	this.pot = new Pot;
	this.recordReplayEnabled = recordReplayEnabled;
	// All the public table data
	this.public = {
		// The table id
		id: id,
		// The table name
		name: name,
		// The number of the seats of the table
		seatsCount: seatsCount,
		// The number of players that are currently seated
		playersSeatedCount: 0,
		// The minimum allowed buy in
		minBuyIn: minBuyIn,
		// The maximum allowed buy in
		maxBuyIn: maxBuyIn,
		// The timeout value for the defaul action when the player is afk
		defaultActionTimeout: defaultActionTimeout,
		// The minimum bet a player can raise by
		minBet: minBet,
		// The amount of chips that are in the pot
		pot: this.pot.pots,
		// The biggest bet of the table in the current phase
		biggestBet: 0,
		// The seat of the dealer
		dealerSeat: null,
		// The seat of the active player
		activeSeat: null,
		// The public data of the players, indexed by their seats
		seats: [],
		// The phase of the game ('smallBlind', 'bigBlind', 'preflop'... etc)
		phase: null,
		// The cards on the board
		board: ['', '', '', '', ''],
		// Log of an action, displayed in the chat
		log: {
			message: '',
			seat: '',
			action: ''
		},
		gameIsOn: false
	};
	// Initializing the empty seats
	for( var i=0 ; i<this.public.seatsCount ; i++ ) {
		this.seats[i] = null;
	}

	if (name === "REPLAY") this.recordReplayEnabled = false;
	if (this.recordReplayEnabled) {
		fn = "./rrevents/Table" + id + (new Date().toISOString().replace(/:/, '-').split(/:/)[0]) + "\.rr";
		console.log("rrevent:" + fn);
		this.ws = fs.createWriteStream(fn);
		this.ws.on('error', function(e) {
			console.error(e);
			this.recordReplayEnabled = false;
		});
	}
};

// The function that emits the events of the table
Table.prototype.emitEvent = function( eventName, eventData ){
	this.eventEmitter( eventName, eventData );
	this.public.log.message = '';
	this.public.log.action = '';
	this.public.log.seat = '';
	this.public.log.notification = null;
};

/**
 * Records the moves for development purposes
 * @param string rec
 */
Table.prototype.recordAndReplay = function(rec) {
	if (!this.recordReplayEnabled) return;
	rec.timeStamp = Date.now();
	this.ws.write(JSON.stringify(rec)+"\n");
}

/**
 * Finds the next player of a certain status on the table
 * @param  number offset (the seat where search begins)
 * @param  string|array status (the status of the player who should be found)
 * @return number|null
 */
Table.prototype.findNextPlayer = function( offset, checkHasChips ) {
	return this.findPlayer(1, offset, checkHasChips);
};


/**
 * Finds the previous player of a certain status on the table
 * @param  number offset (the seat where search begins)
 * @param  string|array status (the status of the player who should be found)
 * @return number|null
 */
Table.prototype.findPreviousPlayer = function( offset, checkHasChips ) {
	return this.findPlayer(-1, offset, checkHasChips);
};

/**
 * Worker function for findNextPlayer and findPreviousPlayer
 * @param  number direction (1: next player, -1: previous player)
 * @param  number offset (the seat where search begins)
 * @param  string|array status (the status of the player who should be found)
 * @return number|null
 */
Table.prototype.findPlayer = function(direction, offset, checkHasChips) {
	offset = offset !== undefined ? offset : this.public.activeSeat;
	checkHasChips = checkHasChips !== undefined ? checkHasChips : false;

	index = offset;
	for (var i = 0; i < this.public.seatsCount; i++) {
		//var index = (offset + direction * (i + 1) + this.public.seatsCount) % this.public.seatsCount;
		index = (index + direction + this.public.seatsCount) % this.public.seatsCount;
		if (this.seats[index] !== null && this.seats[index].inHand(checkHasChips)) {
			return(index);
		}
	}
	return (null);
};

/**
 * Start a game if there are more than 2 players
 */
Table.prototype.startGame = function() {
	if( !this.public.gameIsOn && this.public.playersSeatedCount > 1 ) {
		// Initialize the game
		this.public.gameIsOn = true;
		this.public.phase = ''
		this.emitEvent('gameStarted', this.public );
		this.initializeRound();
		return true;
	}
	return false;
}

Table.prototype.initializeRound = function() {
	for (var i = 0; i < this.public.board.length; i++) {
		this.public.board[i] = '';
	}
	this.deck.shuffle(this.public.name !== "REPLAY");

	this.headsUp = this.public.playersSeatedCount == 2;
	this.playersInHandCount = 0;

	for (var i = 0; i < this.public.seatsCount; i++) {
		player = this.seats[i];
		// If a player is sitting on the current seat
		if (player !== null && (pp = player.public) && pp.sittingIn) {
			if (player.prepareForNewRound()) {
				this.playersInHandCount++;
			}
		}
	}

	// Giving the dealer button to a random player
	while (this.public.dealerSeat === null) {
		var randomDealerSeat = Math.floor(Math.random() * this.public.playersSeatedCount);
		if (this.seats[randomDealerSeat] === null) continue;
		this.public.dealerSeat = randomDealerSeat;
	}
	if (!this.seats[this.public.dealerSeat]) {
		this.public.dealerSeat = this.findNextPlayer(this.public.dealerSeat);
	}
    if (this.incBlindsSeat == null) {
        this.incBlindsSeat = this.public.dealerSeat;
    } else if (!this.seats[this.incBlindsSeat]) {
        this.incBlindsSeat = this.findPreviousPlayer(this.incBlindsSeat);
    }


    if (this.incBlindsSeat == this.public.dealerSeat) {
        this.currentSmall += this.smallBlind;
    }

	this.public.biggestBet = 0;

	//Post small blind
	this.public.activeSeat = this.public.dealerSeat;
	if(!this.headsUp) {
		this.public.activeSeat = this.findNextPlayer();
	}
	this.seats[this.public.activeSeat].bet(this.currentSmall);
	this.log(this.seats[this.public.activeSeat].public.name + ' posted the small blind', 'smallBlind');

	//Post big blind
	this.public.activeSeat = this.findNextPlayer();
	this.lastPlayerToAct = this.public.activeSeat;
	this.seats[this.public.activeSeat].bet(this.currentSmall * 2);
	this.log(this.seats[this.public.activeSeat].public.name + ' posted the big blind', 'bigBlind');

	//this.public.activeSeat = this.findNextPlayer();

	this.recordAndReplay({
		action: 'gameStarted',
		dealerSeat: this.public.dealerSeat,
		cards: this.deck.cards,
		players: this.public.seats
	});

	var currentPlayer = this.public.dealerSeat;
	for( var i=0 ; i<this.playersInHandCount ; i++ ) {
		this.seats[currentPlayer].getCards();
		currentPlayer = this.findNextPlayer( currentPlayer );
	}
	this.public.phase = 'preflop';
	this.actionToNextPlayer(this.public.activeSeat);
}


/**
 * Making the next player the active one
 */
Table.prototype.actionToNextPlayer = function(seat) {
	let start = (seat !== undefined)  ? seat : this.public.activeSeat;
	let nextPlayer = this.findNextPlayer(start, true);
	let nplayer = (nextPlayer == null) ? null : this.seats[nextPlayer];

	if (seat === undefined) { // check only if not start of new phase
		//no player has money left or the next player has already bet more when all other players are already allin.
		let noMoreBets = nextPlayer == null || nextPlayer == start || ((this.public.biggestBet <= nplayer.public.bet) && this.public.playersSeatedCount - this.playersAllIn == 1)
		if (noMoreBets || (this.lastPlayerToAct === this.public.activeSeat)) {
			this.initializeNextPhase(noMoreBets);
			return;
		}
		// if (this.lastPlayerToAct === this.public.activeSeat) {
		// 	this.initializeNextPhase(false);
		// 	return;
		// }
	}

	this.public.activeSeat = nextPlayer;
	let str = (this.public.biggestBet > nplayer.public.bet) ? (this.public.playersSeatedCount - this.playersAllIn == 1) ? 'Fold:Call' : 'Fold:Call:Raise' : 'Check:Raise'
    if (nplayer.public.autoPlay) {
        if (str.includes('Fold')) {
            this.playerFolded();
        } else {
            this.playerChecked();
        }
    } else {
        nplayer.sendButtons(str);
    }
	this.emitEvent( 'table-data', this.public );
}

/**
 * Method that starts the next phase of the round
 */
Table.prototype.initializeNextPhase = function(noMoreBets) {
	this.lastPlayerToAct = (this.seats[this.public.dealerSeat].public.inHand) ? this.public.dealerSeat : this.findPreviousPlayer(this.public.dealerSeat);

	this.pot.addTableBets( this.seats );
	this.public.biggestBet = 0;

	do { //just deal the remaining cards on board and showdown.
		switch (this.public.phase) {
			case 'preflop':
				this.public.phase = 'flop';
				for (var i = 0; i < 3; i++) {
					this.public.board[i] = this.deck.getCard();
				}
				break;
			case 'flop':
				this.public.phase = 'turn';
				this.public.board[3] = this.deck.getCard();
				break;
			case 'turn':
				this.public.phase = 'river';
				this.public.board[4] = this.deck.getCard();
				break;
			case 'river':
				this.showdown();
				return;
		}
	} while (noMoreBets);

	this.actionToNextPlayer(this.public.dealerSeat);
}


/**
 * The phase when the players show their hands until a winner is found
 */
Table.prototype.showdown = function() {
	let messages = [];
	let currentPlayer = this.findNextPlayer(this.public.dealerSeat);


	if (this.playersInHandCount == 1) {
		let winner = this.seats[currentPlayer];
		winner.wins(winner.public.bet); // gets back the bet.
		winner.public.bet = 0;
		messages.push(this.pot.giveToWinner(winner));
		this.log(messages[0]);
	} else {
		let bestHandRating = 0;
		this.pot.addTableBets(this.seats);
		for (let i = 0; i < this.playersInHandCount; i++) {
			this.seats[currentPlayer].evaluateHand(this.public.board);
			// If the hand of the current player is the best one yet,
			// he has to show it to the others in order to prove it
			if (this.seats[currentPlayer].evaluatedHand.rating > bestHandRating) {
				this.seats[currentPlayer].public.cards = this.seats[currentPlayer].cards;
			}
			currentPlayer = this.findNextPlayer(currentPlayer);
		}

		messages = this.pot.distributeToWinners(this.seats);
		let messagesCount = messages.length;
		for (let i = 0; i < messagesCount; i++) {
			this.log(messages[i]);
		}
	}


	// if (this.public.name === "REPLAY") {
	// 	this.endRound();
	// } else {
	var that = this;
	setTimeout(function () {
		that.endRound();
	}, 10000);
	// }

	return (messages); // for unit tests
};

/**
 * Checks if the round should continue after a player has folded
 */
Table.prototype.playerFolded = function() {
	this.seats[this.public.activeSeat].fold();
	this.log(this.seats[this.public.activeSeat].public.name + ' folded',
		'fold', 'Fold');

	this.playersInHandCount--;
	this.pot.removePlayer(this.seats[this.public.activeSeat]);
	if (this.playersInHandCount == 1) {
		this.showdown();
	} else {
		this.actionToNextPlayer();
	}
};

/**
 * When a player checks
 */
Table.prototype.playerChecked = function() {
	this.log(this.seats[this.public.activeSeat].public.name + ' checked',
		'check', 'Check');
	this.actionToNextPlayer();
};

/**
 * When a player bets
 */
Table.prototype.playerBet = function(amount) {
	let player = this.seats[this.public.activeSeat];
	let pp = player.public;
	if (amount <= this.public.biggestBet) {
		var calledAmount = this.public.biggestBet;
		calledAmount = player.bet(calledAmount);
		this.log(pp.name + ' called', 'call', 'Call ' + calledAmount);
	} else {
		amount = player.bet(amount);
		this.log(pp.name + ' raised to ' + amount, 'bet', 'Raised to ' + amount);
		this.lastPlayerToAct = this.findPreviousPlayer();
	}
	this.actionToNextPlayer();
};

/**
 * Adds the player to the table
 * @param object 	player
 * @param int 		seat
 */
Table.prototype.playerSatOnTheTable = function( player, seat, chips ) {

	this.seats[seat] = player;
	this.public.seats[seat] = player.public;

	player.sitOnTable( this, seat, chips );

	// Increase the counters of the table
	this.public.playersSeatedCount++;

	// The player is sitting in

	this.log(this.seats[seat].public.name + ':sat in:' + seat + ':' + player.public.chipsInPlay, 'sat');
};

//TODO remove code
// Table.prototype.otherPlayersAreAllIn = function() {
// 	return this.playersAllIn >= this.public.playersSeatedCount-1;
// };

/**
 * Method that makes the doubly linked list of players
 */
Table.prototype.removeAllCardsFromPlay = function() {
	// For each seat
	for( var i=0 ; i<this.public.seatsCount ; i++ ) {
		// If a player is sitting on the current seat
		if( this.seats[i] !== null ) {
			this.seats[i].cards = [];
			this.seats[i].public.hasCards = false;
		}
	}
};

/**
 * Actions that should be taken when the round has ended
 */
Table.prototype.endRound = function() {
	// Sitting out the players who don't have chips
	for( i=0 ; i<this.public.seatsCount ; i++ ) {
		if( this.seats[i] !== null && this.seats[i].public.chipsInPlay <=0 && this.seats[i].public.sittingIn ) {
			this.seats[i].playerLeft(i);
			this.currentSmall += this.smallBlind;
		}
	}

	// If there are not enough players to continue the game, stop it
	if( this.public.playersSeatedCount < 2 ) {
		this.stopGame();
		return;
	} else {
		this.public.dealerSeat = this.findNextPlayer(this.public.dealerSeat);
		this.initializeRound();
	}
};

Table.prototype.removePlayer = function(player, seat) {
	//Call Table to clean up this seat
	this.public.seats[seat] = null;
	this.seats[seat] = null;
	this.public.playersSeatedCount--;
	this.log(player.public.name + ' left:' + seat, 'left');

	if (!this.public.gameIsOn) {
		return
	}

	// If there are not enough players to continue the game
	if( this.public.playersSeatedCount < 2 ) {
	    this.public.dealerSeat = null;
	    this.stopGame();
	    return;
	}
	this.actionToNextPlayer();
}
/**
 * Method that stops the game
 */
Table.prototype.stopGame = function() {
	this.public.phase = null;
	this.pot.reset();
	this.public.activeSeat = null;
	this.public.board = ['', '', '', '', ''];
	this.lastPlayerToAct = null;
	this.removeAllCardsFromPlay();
	this.public.gameIsOn = false;
	this.emitEvent( 'gameStopped', this.public );
};

/**
 * Logs the last event
 */
Table.prototype.log = function(message, action, notification, seat) {
	this.public.log.message = message;
	this.public.log.action = (action === undefined) ? '' : action;
	this.public.log.seat = (seat === undefined) ? this.public.activeSeat : seat;
	this.public.log.notification = (notification === undefined) ? null : notification;

	this.recordReplayEnabled && this.recordAndReplay(this.public.log);
	this.emitEvent( 'table-data', this.public );
}

module.exports = Table;