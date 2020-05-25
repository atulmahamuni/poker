
/**
 * The table controller. It keeps track of the data on the interface,
 * depending on the replies from the server.
 */
app.controller( 'TableController', ['$scope', '$rootScope', '$http', '$routeParams', '$timeout', 'sounds',
function( $scope, $rootScope, $http, $routeParams, $timeout, sounds ) {
	var seat = null;
	$scope.table = {};
	$scope.notifications = [{},{},{},{},{},{},{},{},{},{}];
	$scope.showingChipsModal = false;
	$scope.actionState = '';
	$scope.table.dealerSeat = null;
	$scope.myCards = ['', ''];
	$scope.mySeat = null;
	$rootScope.sittingOnTable = false;
	$scope.gameIsOn = false;
	$scope.minBet = 0;
    $scope.playerCount = 0;
    $scope.defaultActionTimer = null;
    $scope.autoPlay = "Turn  ON Auto Play"
	var showingNotification = false;

	// Existing listeners should be removed
	socket.removeAllListeners();

	// Getting the table data
	$http({
		url: '/table-data/' + $routeParams.tableId,
		method: 'GET'
	}).then(function( data, status, headers, config ) {
		$scope.table = data.data.table;
		$scope.buyInAmount = data.data.table.maxBuyIn;
        $scope.defaultActionTimeout = data.data.table.defaultActionTimeout;
        $scope.minBet = data.data.table.minBet;
        $scope.gameIsOn = data.data.table.gameIsOn;
	});

	// Joining the socket room.
	socket.emit( 'enterRoom', $routeParams.tableId, function( response ) {
		//When user leaves and joins back get back to the same state.
		if( response.success ) {
			$scope.table = response.table;
			$scope.setButtons(response.buttons);
			$scope.gameIsOn = response.table.gameIsOn;
			$scope.playerCount = response.table.playersSeatedCount;
			$scope.mySeat = response.seat;
			$rootScope.sittingOnTable = true;
			$rootScope.$digest();
			$scope.$digest();
		}
	});

	$scope.isURLBlank = function() {
		return ($scope.url === "");
	}

	$scope.showBuyInModal = function( seat ) {
		$scope.buyInModalVisible = true;
		selectedSeat = seat;
	}

	$scope.potText = function() {
		if( typeof $scope.table.pot !== 'undefined' && $scope.table.pot[0].amount ) {
			var potText = 'Pot: ' + $scope.table.pot[0].amount;

			var potCount = $scope.table.pot.length;
			if( potCount > 1 ) {
				for( var i=1 ; i<potCount ; i++ ) {
					potText += ' - Sidepot: ' + $scope.table.pot[i].amount;
				}
			}
			return potText;
		}
	}

	// TODO remove this code seems redundant
	// $scope.getCardClass = function( seat, card ) {
	// 	if( $scope.mySeat === seat ) {
	// 		return $scope.myCards[card];
	// 	}
	// 	else if ( typeof $scope.table.seats !== 'undefined' && typeof $scope.table.seats[seat] !== 'undefined' && $scope.table.seats[seat] && typeof $scope.table.seats[seat].cards !== 'undefined' && typeof $scope.table.seats[seat].cards[card] !== 'undefined' ) {
	// 		return 'pokercard-' + $scope.table.seats[seat].cards[card];
	// 	}
	// 	else {
	// 		return 'pokercard-back';
	// 	}
	// }
	//
	// $scope.seatOccupied = function( seat ) {
	// 	return !$rootScope.sittingOnTable || ( $scope.table.seats !== 'undefined' && typeof $scope.table.seats[seat] !== 'undefined' && $scope.table.seats[seat] && $scope.table.seats[seat].name && $scope.table.seats[seat].sittingIn);
	// }

	// Leaving the socket room
	$scope.leaveRoom = function() {
        $scope.clearDefaultActionTimer();
		socket.emit( 'leaveRoom' );
	};

	// A request to sit on a specific seat on the table
	$scope.sitOnTheTable = function() {
        $scope.clearDefaultActionTimer();
		socket.emit( 'sitOnTheTable', { 'seat': selectedSeat, 'tableId': $routeParams.tableId, 'chips': $scope.buyInAmount }, function( response ) {
			if( response.success ){
				$scope.buyInModalVisible = false;
				$rootScope.sittingOnTable = true;
				$rootScope.sittingIn = true;
				$scope.buyInError = null;
				$scope.mySeat = selectedSeat;
				$scope.actionState = 'waiting';
				$scope.$digest();
			} else {
				if( response.error ) {
					$scope.buyInError = response.error;
					$scope.$digest();
				}
			}
		});
	}

	// Player has stepped out and requested auto play.
	$scope.setAutoPlay = function() {
        $scope.clearDefaultActionTimer();
		socket.emit( 'autoPlay', function( response ) {
			if( response.success ) {
			    $scope.autoPlay = (response.autoPlay) ? "Turn OFF Auto Play" : "Turn  ON Auto Play";
				$rootScope.$digest();
				$scope.$digest();
			}
		});
	}

	$scope.check = function() {
        $scope.clearDefaultActionTimer();
		socket.emit( 'check', function( response ) {
			if( response.success ) {
				sounds.playCheckSound();
				$scope.setButtons('');
				$scope.$digest();
			}
		});
	}

	$scope.fold = function() {
        $scope.clearDefaultActionTimer();
		socket.emit( 'fold', function( response ) {
			if( response.success ) {
				sounds.playFoldSound();
				$scope.setButtons('');
				$scope.$digest();
			}
		});
	}

	$scope.call = function() {
        $scope.clearDefaultActionTimer();
		socket.emit( 'call', function( response ) {
			if( response.success ) {
				sounds.playCallSound();
				$scope.setButtons('');
				$scope.$digest();
			}
		});
	}

	$scope.raise = function() {
        $scope.clearDefaultActionTimer();
		socket.emit( 'bet', $scope.raiseAmount, true, function( response ) {
			if( response.success ) {
				sounds.playRaiseSound();
				$scope.setButtons('');
				$scope.$digest();
			}
		});
	}
	
	// Start game
	$scope.startGame = function() {
		socket.emit( 'startGame', {'tableId': $routeParams.tableId}, function( response ) {
			if(response.success) {
				// $scope.gameStarted = true;
				$scope.$digest();
			}
			else if( response.error ) {
				console.log(response.error)
				$scope.$digest();
			}
		})
    }

	$scope.setButtons = function( buttons ) {
		$scope.showFold = buttons.includes('Fold');
		$scope.showCheck = buttons.includes('Check');
		$scope.showCall = buttons.includes('Call');
		$scope.showRaise = buttons.includes('Raise');
	}

    /*
     * Default action timer - if a player does not respond for a whiile, take 
     * the default action on their behalf
     */

    // set the defaul action timer
    $scope.startDefaultActionTimer = function() {
        $scope.clearDefaultActionTimer();
        $scope.defaultActionTimer = setTimeout($scope.triggerDefaultAction, $scope.defaultActionTimeout);
    }

    // clear the default action timer
    $scope.clearDefaultActionTimer = function() {
        if ($scope.defaultActionTimer !== null) {
            clearTimeout($scope.defaultActionTimer);
        }
        $scope.defaultActionTimer = null;
    }

    // handler for when the default action timer expires
    $scope.triggerDefaultAction = function() {
        $scope.clearDefaultActionTimer();
        if ($scope.table.biggestBet > $scope.table.seats[$scope.mySeat].bet) {
            $scope.fold();
        } else {
			$scope.check();
		}
    }


	// When the table data have changed
	socket.on( 'table-data', function( data ) {
		$scope.table = data;
		$scope.playerCount = data.playersSeatedCount;
		switch ( data.log.action ) {
			case 'fold':
				sounds.playFoldSound();
				break;
			case 'check':
				sounds.playCheckSound();
				break;
			case 'call':
				sounds.playCallSound();
				break;
			case 'bet':
			case 'smallBet':
			case 'bigBet':
				sounds.playBetSound();
				break;
			case 'raise':
				sounds.playRaiseSound();
				break;
			case 'left':
				$scope.player = null;
		}
		if( data.log.message ) {
			var messageBox = document.querySelector('#messages');
			var messageElement = angular.element( '<p class="log-message">' + data.log.message + '</p>' );
			angular.element( messageBox ).append( messageElement );
			messageBox.scrollTop = messageBox.scrollHeight;
			if(data.log.notification && data.log.seat !== '') {
				if(!$scope.notifications[data.log.seat].message) {
					$scope.notifications[data.log.seat].message = data.log.notification;
					$scope.notifications[data.log.seat].timeout = $timeout(function() {
						$scope.notifications[data.log.seat].message = '';
					}, 1000);
				} else {
					$timeout.cancel($scope.notifications[data.log.seat].timeout);
					$scope.notifications[data.log.seat].message = data.log.notification;
					$scope.notifications[data.log.seat].timeout = $timeout(function() {
						$scope.notifications[data.log.seat].message = '';
					}, 1000);
				}
			}
		}
		$scope.$digest();
	});

	// When the game has stopped
	socket.on( 'gameStopped', function( data ) {
		$scope.table = data;
		$scope.gameIsOn = false;
		$scope.setButtons('');
		$scope.$digest();
	});

	// When the player is dealt cards
	socket.on( 'dealingCards', function( cards ) {
		$scope.myCards[0] = 'pokercard-'+cards[0];
		$scope.myCards[1] = 'pokercard-'+cards[1];
		$scope.$digest();
	});

	// When the user is asked to act and the pot was not betted
	socket.on( 'showButtons', function(buttons, callAmount, minRaise, maxRaise ) {

		console.log(buttons);
		$scope.callAmount = callAmount;
		$scope.raiseAmount = minRaise;
		$scope.raiseIncrement = $scope.table.minBet;
        $scope.minRaise = minRaise;
        $scope.maxRaise = maxRaise;
		$scope.setButtons(buttons);
		$rootScope.$digest();
		$scope.$digest();

        $scope.startDefaultActionTimer();


	});

	//When game has started
	socket.on('gameStarted', function() {
		$scope.gameIsOn = true;
		$scope.$digest();
	})
}]);