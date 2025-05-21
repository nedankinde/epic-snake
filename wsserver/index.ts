import type { ServerWebSocket } from 'bun';

const players = new Map<ServerWebSocket<unknown>, PlayerState>();

interface Position {
	x: number;
	y: number;
}

interface SnakeSegment {
	position: Position;
}

interface PlayerState {
	id: string;
	segments: SnakeSegment[];
	rotation: number;
	alive: boolean;
	lastUpdate: number;
	kills: number;
	score: number;
	growth: number;
}

interface GameState {
	roundNumber: number;
	food: Position[];
	winner: string | null;
	serverTime: number;
	roundEndTime: number | null;
	isActive: boolean;
	waitingForPlayers: boolean;
	gameOver: boolean;
	lastAnnouncementTime?: number;
}

interface MovementMessage {
	type: 'movement' | 'forceStart';
	position?: Position;
	rotation?: number;
}

interface Announcement {
	message: string;
	type: 'info' | 'warning' | 'success' | 'error';
	duration: number; // milliseconds
}

interface Announcement {
	message: string;
	type: 'info' | 'warning' | 'success' | 'error';
	duration: number; // milliseconds
}

interface LeaderboardEntry {
	id: string;
	kills: number;
	score: number;
}

const SEGMENT_RADIUS = 10;
const COLLISION_DISTANCE = SEGMENT_RADIUS * 2;
const SEGMENT_DISTANCE = SEGMENT_RADIUS * 2;
const FOOD_COUNT = 100;
const FOOD_RADIUS = 5;
const FOOD_SCORE_VALUE = 1;
const FOOD_SEGMENTS_GROWTH = 2;
const KILL_SEGMENTS_GROWTH = 5;
const WINNING_KILLS = 10;
const MIN_PLAYERS_TO_START = 2;
const MAP_WIDTH = 2400;
const MAP_HEIGHT = 1800;
const INITIAL_SPAWN_AREA_WIDTH = 800;
const INITIAL_SPAWN_AREA_HEIGHT = 600;
const INACTIVE_TIMEOUT_MS = 30000;

// Initialize game state
const gameState: GameState = {
	roundNumber: 1,
	food: [],
	winner: null,
	serverTime: Date.now(),
	roundEndTime: null,
	isActive: false,
	waitingForPlayers: true,
	gameOver: false,
	lastAnnouncementTime: Date.now()
};

// Store for recent announcements
const recentAnnouncements: Announcement[] = [];

// Function to send announcements to all players
function broadcastAnnouncement(
	message: string,
	type: 'info' | 'warning' | 'success' | 'error',
	duration: number = 2000 // Set default to 2 seconds
): void {
	const announcement: Announcement = {
		message,
		type,
		duration
	};

	recentAnnouncements.push(announcement);
	// Only keep last 1 announcement to avoid cluttering the UI
		if (recentAnnouncements.length > 1) {
			recentAnnouncements.shift();
		}

	gameState.lastAnnouncementTime = Date.now();

	players.forEach((_, ws) => {
		ws.send(
			JSON.stringify({
				type: 'announcement',
				announcement
			})
		);
	});
}

// Update server time and check for inactive players
setInterval(() => {
	gameState.serverTime = Date.now();

	// Check if we need to start a game (when enough players connect)
	if (gameState.waitingForPlayers && !gameState.isActive && players.size >= MIN_PLAYERS_TO_START) {
		gameState.waitingForPlayers = false;
		startNewRound();
	}

	// Clean up inactive players
	const now = Date.now();
	let inactivePlayers = 0;
	for (const [ws, player] of players.entries()) {
		if (now - player.lastUpdate > INACTIVE_TIMEOUT_MS) {
			console.log(`Removing inactive player: ${player.id}`);
			players.delete(ws);
			inactivePlayers++;
			try {
				ws.close();
			} catch (e) {
				console.error('Error closing connection:', e);
			}
		}
	}

	if (inactivePlayers > 0) {
		console.log(`Removed ${inactivePlayers} inactive players. Players remaining: ${players.size}`);
		broadcastPlayerStates();
		checkGameStatus();
	}
}, 1000);

// Generate food items across the larger map
function generateFood(count: number): Position[] {
	const food: Position[] = [];
	for (let i = 0; i < count; i++) {
		food.push({
			x: Math.random() * MAP_WIDTH,
			y: Math.random() * MAP_HEIGHT
		});
	}
	return food;
}

// Initialize food
gameState.food = generateFood(FOOD_COUNT);

// Start a new round
function startNewRound(): void {
	console.log(`Starting new round with ${players.size} players`);

	if (players.size < MIN_PLAYERS_TO_START) {
		gameState.waitingForPlayers = true;
		gameState.isActive = false;
		gameState.roundEndTime = null;

		players.forEach((_, ws) => {
			ws.send(
				JSON.stringify({
					type: 'waitingForPlayers',
					playersNeeded: Math.max(0, MIN_PLAYERS_TO_START - players.size),
					serverTime: gameState.serverTime
				})
			);
		});

		broadcastAnnouncement(
			`Waiting for players...`,
			'info',
			2000
		);
		return;
	}

	gameState.isActive = true;
	gameState.winner = null;
	gameState.roundEndTime = null;

	// Only increment round number after a game over (someone reached 10 kills)
	if (gameState.gameOver) {
		gameState.roundNumber++;
		gameState.gameOver = false;

		// Generate new food for the round
		gameState.food = generateFood(FOOD_COUNT);

		// Reset all players for the new round
		players.forEach((player, ws) => {
			// Place players in the central area initially
			const initialPosition: Position = {
				x: (MAP_WIDTH - INITIAL_SPAWN_AREA_WIDTH) / 2 + Math.random() * INITIAL_SPAWN_AREA_WIDTH,
				y: (MAP_HEIGHT - INITIAL_SPAWN_AREA_HEIGHT) / 2 + Math.random() * INITIAL_SPAWN_AREA_HEIGHT
			};

			player.segments = [{ position: initialPosition }];
			player.rotation = 0;
			player.alive = true;
			player.lastUpdate = Date.now();
			player.growth = 0;
			// Keep kills and score across rounds
		});
	} else {
		// Just respawn dead players without resetting positions of alive ones
		players.forEach((player, ws) => {
			// Only give new positions to dead players
			if (!player.alive) {
				const initialPosition: Position = {
					x: (MAP_WIDTH - INITIAL_SPAWN_AREA_WIDTH) / 2 + Math.random() * INITIAL_SPAWN_AREA_WIDTH,
					y:
						(MAP_HEIGHT - INITIAL_SPAWN_AREA_HEIGHT) / 2 + Math.random() * INITIAL_SPAWN_AREA_HEIGHT
				};

				player.segments = [{ position: initialPosition }];
				player.rotation = 0;
				player.alive = true;
				player.lastUpdate = Date.now();
				// Keep growth, kills, and score
			}
		});
	}

	// Notify all players about the new round
	players.forEach((_, ws) => {
		ws.send(
			JSON.stringify({
				type: 'newRound',
				roundNumber: gameState.roundNumber,
				serverTime: gameState.serverTime,
				isActive: true,
				announcements: recentAnnouncements // Send recent announcements to newly joined players
			})
		);
	});

	broadcastAnnouncement(
		`Round ${gameState.roundNumber} started!`,
		'success',
		2000
	);

	broadcastPlayerStates();
}

// Check if any player has reached 10 kills or if round should end
function checkGameStatus(): void {
	// If we're in a forced active state, skip the player count check
	if (gameState.isActive && !gameState.waitingForPlayers) {
		// Continue with game status checks
	}
	// If there's only 1 player left in the game, put the game in waiting mode
	else if (players.size < MIN_PLAYERS_TO_START) {
		gameState.waitingForPlayers = true;
		gameState.isActive = false;
		const playersNeeded = Math.max(0, MIN_PLAYERS_TO_START - players.size);

		// Broadcast waiting state to all players
		players.forEach((_, ws) => {
			ws.send(
				JSON.stringify({
					type: 'waitingForPlayers',
					playersNeeded: playersNeeded,
					serverTime: gameState.serverTime
				})
			);
		});
		return;
	}

	// If we're waiting for players but now have enough, start a new round
	if (gameState.waitingForPlayers && players.size >= MIN_PLAYERS_TO_START) {
		startNewRound();
		return;
	}

	// If we're not in an active game state, don't proceed with other checks
	if (!gameState.isActive) {
		return;
	}

	// First, check if anyone has reached the winning kill count
	const playerWithWinningKills = Array.from(players.entries()).find(
		([_, player]) => player.kills >= WINNING_KILLS
	);

	if (playerWithWinningKills) {
		const winner = playerWithWinningKills[1];
		gameState.winner = winner.id;
		gameState.roundEndTime = gameState.serverTime + 5000; // End in 5 seconds
		gameState.isActive = false;

		// Game is over, winner has reached 10 kills
		const leaderboard = Array.from(players.entries())
			.map(([_, player]) => ({
				id: player.id,
				kills: player.kills,
				score: player.score
			}))
			.sort((a, b) => b.kills - a.kills);

		players.forEach((_, ws) => {
			ws.send(
				JSON.stringify({
					type: 'gameOver',
					winner: winner.id,
					roundNumber: gameState.roundNumber,
					leaderboard,
					serverTime: gameState.serverTime,
					endTime: gameState.roundEndTime
				})
			);
		});

		// Announce the winner
				const winnerName = winner.id.substring(0, 8);
				// Clear existing announcements before adding game over announcement
				recentAnnouncements.length = 0;
				broadcastAnnouncement(
					`${winnerName} wins!`,
					'success',
					2000
				);

		// Reset kills and scores after the game over
		setTimeout(() => {
			players.forEach((player) => {
				player.kills = 0;
				player.score = 0;
			});
			gameState.waitingForPlayers = true;
			gameState.gameOver = true;
			startNewRound();
		}, 5000);

		return;
	}

	// If no one has winning kills, check if there's only one player alive
	const alivePlayers = Array.from(players.entries()).filter(([_, player]) => player.alive);

	// If only one player is alive and there are at least 2 players total, we notify them they're the last alive
	if (alivePlayers.length === 1 && players.size > 1) {
		const winner = alivePlayers[0][1];

		// Only send a message to the last remaining player - don't end the round
		const winnerWs = alivePlayers[0][0];
		winnerWs.send(
			JSON.stringify({
				type: 'lastAlive',
				message: 'You are the last snake alive! You win this round!',
				serverTime: gameState.serverTime
			})
		);

		// Announce the last snake standing
		const lastSnakeName = winner.id.substring(0, 8);
		broadcastAnnouncement(
			`${lastSnakeName} is last alive!`,
			'warning',
			2000
		);

		// Respawn dead players after a delay
		if (players.size - alivePlayers.length > 0) {
			setTimeout(startNewRound, 3000);
		}
	} else if (alivePlayers.length === 0 && players.size > 0) {
		// Everyone died, respawn all players
		gameState.roundEndTime = gameState.serverTime + 3000; // End in 3 seconds
		gameState.isActive = false;

		// Notify all players about the respawn with no winner
		players.forEach((_, ws) => {
			ws.send(
				JSON.stringify({
					type: 'allDead',
					message: 'All players died! Respawning...',
					serverTime: gameState.serverTime,
					endTime: gameState.roundEndTime
				})
			);
		});

		// Announce all snakes died
		broadcastAnnouncement('All snakes died!', 'error', 2000);

		setTimeout(startNewRound, 3000);
	}
}

Bun.serve({
	port: 3000,
	fetch(req, server) {
		// Add CORS headers for browser compatibility
		if (req.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type'
				}
			});
		}

		if (server.upgrade(req)) {
			return;
		}

		return new Response('Upgrade failed', {
			status: 500,
			headers: {
				'Access-Control-Allow-Origin': '*'
			}
		});
	},
	websocket: {
		open(ws) {
			const playerId = crypto.randomUUID();

			// Place new players in the central area initially
			const initialPosition: Position = {
				x: (MAP_WIDTH - INITIAL_SPAWN_AREA_WIDTH) / 2 + Math.random() * INITIAL_SPAWN_AREA_WIDTH,
				y: (MAP_HEIGHT - INITIAL_SPAWN_AREA_HEIGHT) / 2 + Math.random() * INITIAL_SPAWN_AREA_HEIGHT
			};

			// Check for existing inactive players (more than 30 seconds without update)
			const now = Date.now();
			for (const [existingWs, player] of players.entries()) {
				if (now - player.lastUpdate > 30000) {
					console.log(`Removing inactive player: ${player.id}`);
					players.delete(existingWs);
					try {
						existingWs.close();
					} catch (e) {}
				}
			}

			players.set(ws, {
				id: playerId,
				segments: [{ position: initialPosition }],
				rotation: 0,
				alive: true,
				lastUpdate: Date.now(),
				kills: 0,
				score: 0,
				growth: 0
			});

			ws.send(
				JSON.stringify({
					type: 'connected',
					id: playerId,
					roundNumber: gameState.roundNumber,
					serverTime: gameState.serverTime,
					waitingForPlayers: gameState.waitingForPlayers,
					playersNeeded: gameState.waitingForPlayers
						? Math.max(0, MIN_PLAYERS_TO_START - players.size)
						: 0
				})
			);

			broadcastPlayerStates();

			// If we now have enough players to start and were waiting, start the game
			if (gameState.waitingForPlayers && players.size >= MIN_PLAYERS_TO_START) {
				gameState.waitingForPlayers = false;
				startNewRound();
			}
		},
		message(ws, message) {
			try {
				const data = JSON.parse(message.toString()) as MovementMessage;
				const player = players.get(ws);

				// If there's a new movement but the game is inactive, check if we can start
				if (!gameState.isActive && player && players.size >= MIN_PLAYERS_TO_START) {
					gameState.waitingForPlayers = false;
					gameState.isActive = true;
					broadcastAnnouncement('Game starting!', 'success', 2000);
					startNewRound();
					return;
				}

				// If we don't have a player with this connection, return
				if (!player) return;

				// If game isn't active, ignore movement data
				if (!gameState.isActive) {
					// Check if we should start a game
					if (players.size >= MIN_PLAYERS_TO_START) {
						broadcastAnnouncement('Starting game!', 'success', 2000);
						startNewRound();
					}
					return;
				}

				// If player is dead, ignore movement
				if (!player.alive) return;

				// Handle force start command (for testing)
				if (data.type === 'forceStart') {
					console.log('Force start requested');
					gameState.waitingForPlayers = false;
					gameState.isActive = true;
					broadcastAnnouncement('Game force-started!', 'warning', 2000);
					startNewRound();
					return;
				}

				if (data.type === 'movement' && data.position) {
					// Record last activity time to detect inactive players
					player.lastUpdate = Date.now();

					if (player.segments.length > 0) {
						player.segments[0].position = data.position;
					}

					if (data.rotation !== undefined) {
						player.rotation = data.rotation;
					}

					updateSnakeSegments(player);

					// Check collisions before game status updates
					checkFoodCollisions(player);
					checkCollisions(ws, player);

					// Check if the round should end after updating
					checkGameStatus();

					// Broadcast updated states to all players
					broadcastPlayerStates();
				}
			} catch (error) {
				console.error('Error processing message:', error);
				ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
			}
		},
		close(ws) {
			players.delete(ws);
			broadcastPlayerStates();

			// Force check game status when a player disconnects
			setTimeout(() => {
				checkGameStatus();
			}, 100);
		}
	}
});

function updateSnakeSegments(player: PlayerState): void {
	// Add new segments if player has growth pending
	if (player.growth > 0 && player.segments.length > 0) {
		const lastSegment = player.segments[player.segments.length - 1];
		player.segments.push({
			position: { ...lastSegment.position }
		});
		player.growth--;
	}

	// Update segment positions
	for (let i = 1; i < player.segments.length; i++) {
		const currentSegment = player.segments[i];
		const prevSegment = player.segments[i - 1];

		const dx = prevSegment.position.x - currentSegment.position.x;
		const dy = prevSegment.position.y - currentSegment.position.y;

		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance > SEGMENT_DISTANCE * 1.2) {
			const targetDistance = SEGMENT_DISTANCE;
			const ratio = targetDistance / distance;
			
			const newX = prevSegment.position.x - dx * ratio;
			const newY = prevSegment.position.y - dy * ratio;

			currentSegment.position.x = currentSegment.position.x * 0.5 + newX * 0.5;
			currentSegment.position.y = currentSegment.position.y * 0.5 + newY * 0.5;
		}
	}
}

function checkCollisions(currentWs: ServerWebSocket<unknown>, currentPlayer: PlayerState): void {
	const playerEntries = Array.from(players.entries());

	for (const [wsA, playerA] of playerEntries) {
		if (wsA !== currentWs && playerA.alive && playerA.segments.length > 0) {
			// Ensure head segments exist
			if (currentPlayer.segments.length === 0) continue;

			const headA = playerA.segments[0].position;
			const headCurrent = currentPlayer.segments[0].position;

			// Check for head-to-head collision
			const headDistance = Math.sqrt(
				Math.pow(headCurrent.x - headA.x, 2) + Math.pow(headCurrent.y - headA.y, 2)
			);

			if (headDistance < COLLISION_DISTANCE) {
				currentPlayer.alive = false;
				playerA.alive = false;

				currentWs.send(JSON.stringify({ type: 'died', reason: 'Head collision' }));
				wsA.send(JSON.stringify({ type: 'died', reason: 'Head collision' }));

				const player1Name = playerA.id.substring(0, 8);
				const player2Name = currentPlayer.id.substring(0, 8);
				broadcastAnnouncement(
					`${player1Name} & ${player2Name} collided!`,
					'error',
					2000
				);
				continue;
			}

			// Check if current player's head hits another player's tail
			for (let k = 1; k < playerA.segments.length; k++) {
				const segmentA = playerA.segments[k].position;
				const distance = Math.sqrt(
					Math.pow(headCurrent.x - segmentA.x, 2) + Math.pow(headCurrent.y - segmentA.y, 2)
				);

				if (distance < COLLISION_DISTANCE) {
					currentPlayer.alive = false;
					playerA.kills++;
					playerA.score += 5; // Higher score reward for kills
					playerA.growth += KILL_SEGMENTS_GROWTH; // Add growth for killing opponents


					const killerName = playerA.id.substring(0, 8);
					const killedName = currentPlayer.id.substring(0, 8);
					broadcastAnnouncement(`${killerName} killed ${killedName}!`, 'warning', 2000);


					if (playerA.kills === 5) {
						broadcastAnnouncement(
							`${killerName}: 5 kills!`,
							'warning',
							2000
						);
					} else if (playerA.kills === WINNING_KILLS - 1) {
						broadcastAnnouncement(
							`${killerName} needs 1 more kill!`,
							'error',
							2000
						);
					}

					currentWs.send(
						JSON.stringify({
							type: 'died',
							reason: "Collided with another snake's tail",
							killedBy: playerA.id
						})
					);
					wsA.send(
						JSON.stringify({
							type: 'kill',
							kills: playerA.kills,
							score: playerA.score,
							growth: KILL_SEGMENTS_GROWTH,
							victim: currentPlayer.id
						})
					);
					break;
				}
			}

			// Check if other player's head hits current player's tail
			for (let k = 1; k < currentPlayer.segments.length; k++) {
				const segmentCurrent = currentPlayer.segments[k].position;
				const distance = Math.sqrt(
					Math.pow(headA.x - segmentCurrent.x, 2) + Math.pow(headA.y - segmentCurrent.y, 2)
				);

				if (distance < COLLISION_DISTANCE) {
					playerA.alive = false;
					currentPlayer.kills++;
					currentPlayer.score += 1; // Add one point for a kill
					currentPlayer.growth += KILL_SEGMENTS_GROWTH;

					wsA.send(
						JSON.stringify({
							type: 'died',
							reason: "Collided with another snake's tail",
							killedBy: currentPlayer.id
						})
					);
					currentWs.send(
						JSON.stringify({
							type: 'kill',
							victim: playerA.id,
							kills: currentPlayer.kills,
							score: currentPlayer.score
						})
					);
					break;
				}
			}
		}
	}
}

function checkFoodCollisions(player: PlayerState): void {
	if (!player.alive || player.segments.length === 0) return;

	const head = player.segments[0].position;

	// Check for collisions with food
	for (let i = gameState.food.length - 1; i >= 0; i--) {
		const food = gameState.food[i];
		const distance = Math.sqrt(Math.pow(head.x - food.x, 2) + Math.pow(head.y - food.y, 2));

		if (distance < SEGMENT_RADIUS + FOOD_RADIUS) {
			// Remove the food
			gameState.food.splice(i, 1);

			// Add score and growth to player
			player.score += FOOD_SCORE_VALUE;
			player.growth += FOOD_SEGMENTS_GROWTH;

			// Generate a new food item to replace the eaten one across the larger map
			gameState.food.push({
				x: Math.random() * MAP_WIDTH,
				y: Math.random() * MAP_HEIGHT
			});

			// Check for milestones and send announcements
			const totalLength = player.segments.length + player.growth;
			const playerName = player.id.substring(0, 8);


			if (player.score % 50 === 0 && player.score > 0 && player.score >= 50) {
				broadcastAnnouncement(`${playerName}: ${player.score} points!`, 'success', 2000);
			}


			if (totalLength === 50) {
				broadcastAnnouncement(`${playerName}: 50 segments!`, 'success', 2000);
			} else if (totalLength === 100) {
				broadcastAnnouncement(`${playerName}: 100 segments!`, 'success', 2000);
			}

			// Notify the player about their growth
			for (const [ws, p] of players.entries()) {
				if (p.id === player.id) {
					ws.send(
						JSON.stringify({
							type: 'foodEaten',
							score: player.score,
							growth: player.segments.length + player.growth,
							effect: 'grow'
						})
					);
					break;
				}
			}
		}
	}
}

function broadcastPlayerStates(): void {
	// If there are no players, no need to broadcast
	if (players.size === 0) return;

	// Update server time
	gameState.serverTime = Date.now();
	

	if (gameState.lastAnnouncementTime && Date.now() - gameState.lastAnnouncementTime > 3000) {
		recentAnnouncements.length = 0;
	}

	const playerStates = Array.from(players.entries()).map(([, player]) => ({
		id: player.id,
		segments: player.segments,
		rotation: player.rotation,
		alive: player.alive,
		kills: player.kills,
		score: player.score
	}));

	// Count alive players
	const aliveCount = playerStates.filter((p) => p.alive).length;

	// If no one is alive and game is active, check game status
	if (aliveCount === 0 && gameState.isActive && playerStates.length > 0) {
		setTimeout(() => {
			checkGameStatus();
		}, 100);
	}

	players.forEach((_, ws) => {
		ws.send(
			JSON.stringify({
				type: 'playerStates',
				players: playerStates,
				food: gameState.food,
				roundInfo: {
					roundNumber: gameState.roundNumber,
					winner: gameState.winner,
					serverTime: gameState.serverTime,
					endTime: gameState.roundEndTime,
					isActive: gameState.isActive,
					waitingForPlayers: gameState.waitingForPlayers,
					playersNeeded: gameState.waitingForPlayers
						? Math.max(0, MIN_PLAYERS_TO_START - players.size)
						: 0
				},
				announcements: recentAnnouncements
			})
		);
	});
}
