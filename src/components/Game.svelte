<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { wsServerUrl } from '$lib/config';

	// Canvas and display settings
	let canvasElement: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null;
	let canvasSize = 'default';
	let isFullscreenOpen = false;
	let canvasWidth = 720;
	let canvasHeight = 480;
	let isMobileDevice = false;
	let showTouchControls = false;
	let debugMode = false; // Set to true to see debug info
	let resizeObserver: ResizeObserver | null = null;
	
	// Camera and map settings
	let cameraX = 0;
	let cameraY = 0;
	const MAP_WIDTH = 2400;
	const MAP_HEIGHT = 1800;
	let miniMapEnabled = true;
	let miniMapSize = 180;

	// Game state
	let socket: WebSocket;
	let playerId: string;
	let players: any[] = [];
	let food: any[] = []; // Array of food items
	let roundInfo = { 
		roundNumber: 0, 
		winner: null, 
		serverTime: 0, 
		endTime: null,
		isActive: false,
		waitingForPlayers: true,
		playersNeeded: 0,
		gameOver: false
	};
	
	let lastAliveMessage = '';
	let showLastAliveMessage = false;
	let gameStatus = 'Connecting...';
	let isAlive = true;
	let deathReason = '';
	let killedBy = '';
	let kills = 0;
	let score = 0;
	let leaderboard: LeaderboardEntry[] = [];
	let showLeaderboard = false;
	let gameWinner: string | null = null;
	let timeRemaining = 0;
	let pulseEffect = false; // For growth animation
	
	// Game constants
	const FOOD_SCORE_VALUE = 1;
	
	// Announcement system
	type Announcement = {
		message: string;
		type: 'info' | 'warning' | 'success' | 'error';
		duration: number;
		id: number;
		startTime: number;
	};
	let announcements: Announcement[] = [];
	let nextAnnouncementId = 0;
	let maxDisplayedAnnouncements = 2; // Limit number of displayed announcements

	// Game colors
	const snakeColors: { [key: string]: string } = {};
	const colorPalette = [
		'#FF5733',
		'#33FF57',
		'#3357FF',
		'#F033FF',
		'#FF33F0',
		'#33FFF0',
		'#FFF033',
		'#FF3333',
		'#33FF33',
		'#3333FF',
		'#FFAA33',
		'#33FFAA',
		'#AA33FF',
		'#FF33AA'
	];

	// Input handling
	let keys = { 
		ArrowUp: false, 
		ArrowDown: false, 
		ArrowLeft: false, 
		ArrowRight: false,
		Space: false,
		KeyD: false,
		KeyF: false, // F key to force start game (for testing)
		KeyM: false  // M key to toggle minimap
	};

	let currentRotation = 0;
	let playerPosition = { x: 0, y: 0 };
	const MOVEMENT_SPEED = 5;

	// Touch controls
	let touchActive = false;
	let touchDirection = { x: 0, y: 0 };

	onMount(() => {
		// Only run on the client side
		if (!browser) return;

		// Detect mobile device
		if (typeof navigator !== 'undefined') {
			isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
				navigator.userAgent
			);
			showTouchControls = isMobileDevice;
		}

		// Setup canvas
		if (!canvasElement) return;

		ctx = canvasElement.getContext('2d');
		if (!ctx) return;

		// Set up resize observer to handle canvas resizing
		resizeObserver = new ResizeObserver(() => {
			updateCanvasSize();
		});
		resizeObserver.observe(canvasElement);
		
		// Add window resize listener for better fullscreen handling
		window.addEventListener('resize', () => {
			if (isFullscreenOpen) {
				// Update canvas to match window size
				canvasWidth = window.innerWidth;
				canvasHeight = window.innerHeight;
				
				if (canvasElement) {
					if (canvasElement) {
						canvasElement.width = canvasWidth;
						canvasElement.height = canvasHeight;
					}
					canvasElement.style.width = `${canvasWidth}px`;
					canvasElement.style.height = `${canvasHeight}px`;
				}
			}
		});

		// Update canvas size based on the initial setting
		updateCanvasSize();

		// Connect to WebSocket server
		connectWebSocket();

		// Start game loop
		let lastTime = performance.now();
		function gameLoop(timestamp: number) {
			const deltaTime = timestamp - lastTime;
			lastTime = timestamp;

			handleMovement(deltaTime);
			render();

			requestAnimationFrame(gameLoop);
		}

		requestAnimationFrame(gameLoop);

		// Set up keyboard listeners
		if (typeof window !== 'undefined') {
			window.addEventListener('keydown', handleKeyDown);
			window.addEventListener('keyup', handleKeyUp);

			// Set up touch listeners for mobile
			if (isMobileDevice) {
				canvasElement.addEventListener('touchstart', handleTouchStart, { passive: false });
				canvasElement.addEventListener('touchmove', handleTouchMove, { passive: false });
				canvasElement.addEventListener('touchend', handleTouchEnd, { passive: false });
			}
		}
	});

	onDestroy(() => {
		// Clean up event listeners and WebSocket connection
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
			window.removeEventListener('resize', () => {});

			if (isMobileDevice && canvasElement) {
				canvasElement.removeEventListener('touchstart', handleTouchStart);
				canvasElement.removeEventListener('touchmove', handleTouchMove);
				canvasElement.removeEventListener('touchend', handleTouchEnd);
			}
		}

		// Clean up resize observer
		if (resizeObserver) {
			resizeObserver.disconnect();
		}

		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.close();
		}
	});

	function connectWebSocket() {
		if (!browser) return;
		
		// Disconnect existing socket if it exists
		if (socket) {
			try {
				socket.close();
			} catch (e) {
				console.error("Error closing existing socket:", e);
			}
		}
		
		gameStatus = 'Connecting...';
		
		// Connect to WebSocket server
		socket = new WebSocket(wsServerUrl());
		
		socket.onopen = () => {
			gameStatus = 'Connected';
		};
		
		socket.onclose = () => {
			gameStatus = 'Disconnected';
			setTimeout(connectWebSocket, 3000); // Reconnect after 3 seconds
		};
		
		socket.onerror = (error) => {
			console.error('WebSocket error:', error);
			gameStatus = 'Connection error';
		};
		
		socket.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data);
				// console.log('Received message:', message.type);

				switch (message.type) {
					case 'connected':
						playerId = message.id;
						roundInfo.roundNumber = message.roundNumber;
						roundInfo.serverTime = message.serverTime;
						roundInfo.waitingForPlayers = message.waitingForPlayers;
						roundInfo.playersNeeded = message.playersNeeded;
						isAlive = true;
						showLastAliveMessage = false;
						gameStatus = message.waitingForPlayers ? 
							`Waiting for ${message.playersNeeded} more player${message.playersNeeded !== 1 ? 's' : ''}` : 
							'Connected';
						break;
						
					case 'waitingForPlayers':
							roundInfo.waitingForPlayers = true;
							roundInfo.playersNeeded = message.playersNeeded || 0;
							roundInfo.serverTime = message.serverTime;
							roundInfo.isActive = false;
							gameStatus = `Waiting for ${roundInfo.playersNeeded} more player${roundInfo.playersNeeded !== 1 ? 's' : ''}`;
							showLeaderboard = false;
							break;
							
					case 'announcement':
							if (message.announcement) {
								// Only add announcement if it's not very similar to a recent one
								const isDuplicate = announcements.some(a => 
									a.message === message.announcement.message || 
									(Date.now() - a.startTime < 2000 && a.type === message.announcement.type)
								);
								
								if (!isDuplicate) {
									const announcement = {
										...message.announcement,
										id: nextAnnouncementId++,
										startTime: Date.now()
									};
									announcements.push(announcement);
									
									// Remove announcement after its duration
									setTimeout(() => {
										announcements = announcements.filter(a => a.id !== announcement.id);
									}, announcement.duration);
								}
							}
							break;

					case 'playerStates':
						players = message.players;
						roundInfo = message.roundInfo || roundInfo;
						food = message.food || [];
						
						// Check for announcements in player states
						if (message.announcements && Array.isArray(message.announcements)) {
							message.announcements.forEach(announcement => {
								// Only add if we don't already have it and it's not a duplicate or too recent
								const isDuplicate = announcements.some(a => 
									a.message === announcement.message || 
									(Date.now() - a.startTime < 2000 && a.type === announcement.type)
								);
								
								if (!isDuplicate) {
									const newAnnouncement = {
										...announcement,
										id: nextAnnouncementId++,
										startTime: Date.now()
									};
									announcements.push(newAnnouncement);
									
									// Remove announcement after its duration
									setTimeout(() => {
										announcements = announcements.filter(a => a.id !== newAnnouncement.id);
									}, announcement.duration);
								}
							});
						}
						
						// Update game status based on waiting status
						if (roundInfo.waitingForPlayers) {
							const playersNeeded = roundInfo.playersNeeded || 0;
							gameStatus = `Waiting for ${playersNeeded} more player${playersNeeded !== 1 ? 's' : ''}`;
						} else if (!isAlive) {
							gameStatus = 'Died - waiting for new round';
						} else if (roundInfo.isActive && gameStatus.includes('Waiting')) {
							gameStatus = 'Connected';
						}

						// Assign colors to new players
						players.forEach((player) => {
							if (!snakeColors[player.id]) {
								snakeColors[player.id] =
									colorPalette[Object.keys(snakeColors).length % colorPalette.length];
							}

							// Update local player stats
							if (player.id === playerId) {
								kills = player.kills;
								score = player.score;
								isAlive = player.alive;
							}
						});
						break;

					case 'died':
						isAlive = false;
						deathReason = message.reason;
						killedBy = message.killedBy || '';
						gameStatus = 'Died - waiting for new round';
						showLeaderboard = false;
						
						// Show death message for 5 seconds, then show leaderboard
						setTimeout(() => {
							if (!isAlive) {
								showLeaderboard = true;
								deathReason = ''; // Clear death reason to hide death message
							}
						}, 5000);
						break;

					case 'kill':
						kills = message.kills;
						score = message.score;
						
						// Simple kill feedback
						if (browser) {
							try {
								let killText = document.createElement('div');
								killText.textContent = `KILL #${kills}`;
								killText.style.position = 'absolute';
								killText.style.left = '50%';
								killText.style.top = '30%';
								killText.style.transform = 'translate(-50%, -50%)';
								killText.style.fontSize = '24px';
								killText.style.fontWeight = 'bold';
								killText.style.color = '#EF4444';
								killText.style.zIndex = '9999';
								killText.style.textShadow = '0 0 5px #000';
								document.body.appendChild(killText);
									
								setTimeout(() => {
									killText.style.opacity = '0';
								}, 800);
									
								setTimeout(() => {
									if (document.body.contains(killText)) {
										document.body.removeChild(killText);
									}
								}, 1000);
							} catch (e) {
								console.error('Error showing kill notification', e);
							}
						}
						
						break;

					case 'newRound':
						roundInfo.roundNumber = message.roundNumber;
						roundInfo.serverTime = message.serverTime;
						roundInfo.endTime = null;
						roundInfo.winner = null;
						roundInfo.isActive = message.isActive || true;
						roundInfo.waitingForPlayers = false;
						gameWinner = null;
						isAlive = true;
						deathReason = '';
						killedBy = '';
						showLastAliveMessage = false;
						gameStatus = 'Respawning...';
						showLeaderboard = false;
						break;

					case 'lastAlive':
						lastAliveMessage = message.message;
						showLastAliveMessage = true;
						roundInfo.serverTime = message.serverTime;
						gameStatus = "You're the last snake alive!";
						break;
						
					case 'allDead':
						roundInfo.serverTime = message.serverTime;
						roundInfo.endTime = message.endTime;
						roundInfo.isActive = false;
						showLeaderboard = true;
						gameStatus = 'All snakes died! Respawning...';
						break;
						
					case 'gameOver':
						roundInfo.winner = message.winner;
						roundInfo.serverTime = message.serverTime;
						roundInfo.endTime = message.endTime;
						roundInfo.isActive = false;
						roundInfo.gameOver = true;
						gameWinner = message.winner;
						leaderboard = message.leaderboard;
						showLeaderboard = true;
						gameStatus = `Game Over! ${message.winner === playerId ? 'You won!' : message.winner.substring(0, 8) + ' won'} with 10 kills!`;
						break;
						
					case 'foodEaten':
						score = message.score;
						
						// Simple visual feedback for food collection
						if (browser) {
							let pointsText = document.createElement('div');
							pointsText.textContent = `+${FOOD_SCORE_VALUE}`;
							pointsText.style.position = 'absolute';
							pointsText.style.left = '50%';
							pointsText.style.top = '30%';
							pointsText.style.fontSize = '24px';
							pointsText.style.fontWeight = 'bold';
							pointsText.style.color = '#10B981';
							pointsText.style.textShadow = '0 0 5px #000';
							pointsText.style.zIndex = '9999';
							pointsText.style.opacity = '1';
							pointsText.style.transition = 'opacity 0.8s, top 0.8s';
							document.body.appendChild(pointsText);
							
							setTimeout(() => {
								pointsText.style.top = '10%';
								pointsText.style.opacity = '0';
							}, 100);
							
							setTimeout(() => {
								if (document.body.contains(pointsText)) {
									document.body.removeChild(pointsText);
								}
							}, 1000);
						}
						break;
				}
			} catch (error) {
				console.error('Error parsing message:', error);
			}
		};
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.code in keys) {
			event.preventDefault();
			keys[event.code as keyof typeof keys] = true;
		}
	}

	function handleKeyUp(event: KeyboardEvent) {
		if (event.code in keys) {
			event.preventDefault();
			keys[event.code as keyof typeof keys] = false;
		}
	}

	// Touch event handlers
	function handleTouchStart(event: TouchEvent) {
		event.preventDefault();
		touchActive = true;
	}

	function handleTouchMove(event: TouchEvent) {
		event.preventDefault();
		if (!touchActive) return;

		const touch = event.touches[0];

		// Get the position relative to the center of the joystick
		if (typeof document !== 'undefined') {
			const joystickEl = document.getElementById('joystick-outer');
			if (!joystickEl) return;

			const joystickRect = joystickEl.getBoundingClientRect();
			const centerX = joystickRect.left + joystickRect.width / 2;
			const centerY = joystickRect.top + joystickRect.height / 2;

			// Calculate direction vector
			let dx = touch.clientX - centerX;
			let dy = touch.clientY - centerY;

			// Normalize the vector
			const length = Math.sqrt(dx * dx + dy * dy);
			const maxRadius = joystickRect.width / 2 - 20; // 20px buffer

			if (length > maxRadius) {
				dx = (dx / length) * maxRadius;
				dy = (dy / length) * maxRadius;
			}

			// Update joystick visual position
			const joystickInner = document.getElementById('joystick-inner');
			if (joystickInner) {
				joystickInner.style.transform = `translate(${dx}px, ${dy}px)`;
			}

			// Set direction for movement processing
			touchDirection = {
				x: dx / maxRadius,
				y: dy / maxRadius
			};
		}
	}

	function handleTouchEnd(event: TouchEvent) {
		event.preventDefault();
		touchActive = false;
		touchDirection = { x: 0, y: 0 };

		// Reset joystick position
		if (typeof document !== 'undefined') {
			const joystickInner = document.getElementById('joystick-inner');
			if (joystickInner) {
				joystickInner.style.transform = 'translate(0px, 0px)';
			}
		}
	}

	function handleMovement(deltaTime: number) {
			// Update server time by the elapsed time
			if (roundInfo.serverTime) {
				roundInfo.serverTime += deltaTime;
			}
		
			// Check if we can move
			if (!socket || socket.readyState !== WebSocket.OPEN) return;
		
			// Process user input even if waiting for game to start (to see local movement)
			let dx = 0;
			let dy = 0;

			// Don't allow movement if we're not alive
			if (isAlive) {
				// Handle keyboard input
				if (keys.ArrowUp) dy -= MOVEMENT_SPEED;
				if (keys.ArrowDown) dy += MOVEMENT_SPEED;
				if (keys.ArrowLeft) dx -= MOVEMENT_SPEED;
				if (keys.ArrowRight) dx += MOVEMENT_SPEED;

				// Handle touch input
				if (touchActive) {
					dx += touchDirection.x * MOVEMENT_SPEED * 2; // Multiplier for smoother touch control
					dy += touchDirection.y * MOVEMENT_SPEED * 2;
				}
			}
		
			// Toggle debug mode with 'D' key
			if (keys.KeyD) {
				debugMode = !debugMode;
				keys.KeyD = false; // Reset to prevent toggling every frame
			}

			// Force start game with 'F' key (for testing)
			if (keys.KeyF) {
				keys.KeyF = false; // Reset to prevent toggling every frame
				if (socket && socket.readyState === WebSocket.OPEN) {
					socket.send(JSON.stringify({ type: 'forceStart' }));
					console.log('Sent force start command');
				}
			}
			
			// Toggle minimap with 'M' key
			if (keys.KeyM) {
				keys.KeyM = false; // Reset to prevent toggling every frame
				miniMapEnabled = !miniMapEnabled;
			}

			// Only send updates if the player is actually moving
			if (dx !== 0 || dy !== 0) {
				// Find player's current position
				const player = players.find((p) => p.id === playerId);
				if (player && player.segments.length > 0) {
					playerPosition = { ...player.segments[0].position };
				}
			
				// Calculate new position
				playerPosition.x += dx;
				playerPosition.y += dy;

				// Calculate rotation (in radians)
				currentRotation = Math.atan2(dy, dx);

				// Always send movement updates - the server will decide if the game is active
				// But don't send if we're in the death screen or leaderboard to avoid confusion
				if (isAlive || (roundInfo.waitingForPlayers && !showLeaderboard)) {
					// Ensure player stays within map boundaries
					playerPosition.x = Math.max(0, Math.min(MAP_WIDTH, playerPosition.x));
					playerPosition.y = Math.max(0, Math.min(MAP_HEIGHT, playerPosition.y));
				
					const message = {
						type: 'movement',
						position: playerPosition,
						rotation: currentRotation
					};

					socket.send(JSON.stringify(message));
				}
			}
		}

	function render() {
		if (!ctx || !canvasElement) return;
		
		// Update camera position to follow player
		updateCamera();
		
		// Clear canvas
		ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
		
		// Draw background
		ctx.fillStyle = '#111827';
		ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);
		
		// Save the context to restore after drawing the main view
		ctx.save();
		
		// Translate canvas to implement camera
		ctx.translate(-cameraX + canvasWidth / 2, -cameraY + canvasHeight / 2);
		
		// Draw grid
		ctx.strokeStyle = '#1F2937';
		ctx.lineWidth = 1;
		const gridSize = 40;
		
		// Calculate grid bounds based on camera view
		const startX = Math.floor(cameraX - canvasWidth / 2) - (Math.floor(cameraX - canvasWidth / 2) % gridSize);
		const endX = Math.ceil(cameraX + canvasWidth / 2);
		const startY = Math.floor(cameraY - canvasHeight / 2) - (Math.floor(cameraY - canvasHeight / 2) % gridSize);
		const endY = Math.ceil(cameraY + canvasHeight / 2);
		
		// Draw vertical grid lines
		for (let x = startX; x <= endX; x += gridSize) {
			ctx.beginPath();
			ctx.moveTo(x, startY);
			ctx.lineTo(x, endY);
			ctx.stroke();
		}
		
		// Draw horizontal grid lines
		for (let y = startY; y <= endY; y += gridSize) {
			ctx.beginPath();
			ctx.moveTo(startX, y);
			ctx.lineTo(endX, y);
			ctx.stroke();
		}
		
		// Draw map boundaries
		ctx.strokeStyle = '#FF3333';
		ctx.lineWidth = 3;
		ctx.strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
		
		food.forEach(foodItem => {
				if (isInView(foodItem.x, foodItem.y)) {
					const pulseSize = 5 + Math.sin(Date.now() / 500 + foodItem.x * 0.1) * 0.8;
				
					ctx.fillStyle = '#10B981';
					ctx.beginPath();
					ctx.arc(foodItem.x, foodItem.y, pulseSize, 0, Math.PI * 2);
					ctx.fill();
				
					ctx.shadowColor = '#10B981';
					ctx.shadowBlur = 8;
					ctx.fill();
					ctx.shadowBlur = 0;
				}
			});
		
		// Draw players
		players.forEach(player => {
			const color = snakeColors[player.id] || '#FFFFFF';
			
			for (let i = player.segments.length - 1; i >= 0; i--) {
				const segment = player.segments[i];
				
				if (isInView(segment.position.x, segment.position.y)) {
					if (player.alive) {
						const segmentPosition = i / Math.max(1, player.segments.length - 1);
						
						if (i === 0) {
							ctx.fillStyle = color;
						} else {
							const opacity = Math.max(0.3, 1 - segmentPosition * 0.7);
							ctx.fillStyle = `${color}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`;
						}
					} else {
						ctx.fillStyle = '#555555';
					}
					
					ctx.beginPath();
					ctx.arc(segment.position.x, segment.position.y, 10, 0, Math.PI * 2);
					ctx.fill();
					
					// Draw eyes on head segment
					if (i === 0 && player.alive) {
						// Calculate eye positions based on rotation
						const eyeRadius = 3;
						const eyeDistance = 5;
						const eyeAngle = Math.PI / 4;
						
						const leftEyeX = segment.position.x + Math.cos(player.rotation + eyeAngle) * eyeDistance;
						const leftEyeY = segment.position.y + Math.sin(player.rotation + eyeAngle) * eyeDistance;
						
						const rightEyeX = segment.position.x + Math.cos(player.rotation - eyeAngle) * eyeDistance;
						const rightEyeY = segment.position.y + Math.sin(player.rotation - eyeAngle) * eyeDistance;
						
						// Draw eyes
						ctx.fillStyle = '#000000';
						ctx.beginPath();
						ctx.arc(leftEyeX, leftEyeY, eyeRadius, 0, Math.PI * 2);
						ctx.arc(rightEyeX, rightEyeY, eyeRadius, 0, Math.PI * 2);
						ctx.fill();
					}
				}
			}
			
			// Draw player ID above the snake
			if (player.segments.length > 0) {
				const head = player.segments[0].position;
				
				// Only draw labels that are in view
								if (isInView(head.x, head.y)) {
									ctx.font = player.id === playerId ? 'bold 14px Arial' : '12px Arial';
									ctx.fillStyle = player.alive ? (player.id === playerId ? '#FFFF00' : '#FFFFFF') : '#888888';
									ctx.textAlign = 'center';
									let displayName = player.id.substring(0, 8);
									if (player.id === playerId) displayName += ' (You)';
									ctx.fillText(displayName, head.x, head.y - 20);
					
					// Draw score/kills under the name if player is alive
					if (player.alive) {
						ctx.fillStyle = '#AAAAAA';
						ctx.fillText(`Score: ${player.score} | Kills: ${player.kills}`, head.x, head.y - 5);
					}
				}
			}
		});
		
		// Restore the context to draw UI elements
		ctx.restore();

		// Draw UI elements in correct order
		drawGameInfo();
		drawAnnouncements();
		
		// Draw minimap if enabled
		if (miniMapEnabled) {
			drawMiniMap();
		}
		
		// Draw leaderboard if round ended
		if (showLeaderboard) {
			drawLeaderboard();
		}
		
		// Draw death message if player is dead
		if (!isAlive && deathReason) {
			drawDeathMessage();
		}
		
		// If waiting for players, show waiting message as overlay
		if (roundInfo.waitingForPlayers && (isAlive || !deathReason)) {
			drawWaitingForPlayers();
		}
		
		// Show the "last alive" message if applicable
		if (showLastAliveMessage && isAlive && !roundInfo.waitingForPlayers) {
			drawLastAliveMessage();
		}
	}
	
	// Helper functions for camera and viewport
	function updateCamera() {
		// Find the player's snake to follow
		const player = players.find(p => p.id === playerId);
		if (player && player.segments.length > 0) {
			const target = player.segments[0].position;
			
			// Smooth camera movement
			const ease = 0.1;
			cameraX += (target.x - cameraX) * ease;
			cameraY += (target.y - cameraY) * ease;
			
			// Keep camera within map bounds
			cameraX = Math.max(canvasWidth / 2, Math.min(MAP_WIDTH - canvasWidth / 2, cameraX));
			cameraY = Math.max(canvasHeight / 2, Math.min(MAP_HEIGHT - canvasHeight / 2, cameraY));
		}
	}
	
	function isInView(x: number, y: number): boolean {
		// Check if a point is within the current viewport
		return (
			x >= cameraX - canvasWidth / 2 - 50 &&
			x <= cameraX + canvasWidth / 2 + 50 &&
			y >= cameraY - canvasHeight / 2 - 50 &&
			y <= cameraY + canvasHeight / 2 + 50
		);
	}
	
	function drawMiniMap() {
		if (!ctx) return;
		
		// Position minimap in bottom right corner with padding
		const padding = 15;
		const miniMapHeight = miniMapSize * (MAP_HEIGHT / MAP_WIDTH);
		const miniMapX = canvasWidth - miniMapSize - padding;
		const miniMapY = canvasHeight - miniMapHeight - padding;
		
		// Draw minimap background with rounded corners
		// Draw semi-transparent background with rounded corners
		ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
		ctx.beginPath();
		
		// Use roundRect if supported, otherwise fall back to rect
		if (ctx.roundRect) {
			ctx.roundRect(miniMapX, miniMapY, miniMapSize, miniMapHeight, 8);
		} else {
			ctx.rect(miniMapX, miniMapY, miniMapSize, miniMapHeight);
		}
		ctx.fill();
		
		// Draw minimap border with glow effect
		ctx.strokeStyle = '#10B981';
		ctx.lineWidth = 2;
		ctx.shadowColor = '#10B981';
		ctx.shadowBlur = 5;
		ctx.beginPath();
		
		// Use roundRect if supported, otherwise fall back to rect
		if (ctx.roundRect) {
			ctx.roundRect(miniMapX, miniMapY, miniMapSize, miniMapHeight, 8);
		} else {
			ctx.rect(miniMapX, miniMapY, miniMapSize, miniMapHeight);
		}
		ctx.stroke();
		ctx.shadowBlur = 0;
		
		// Calculate scale factor
		const scaleX = miniMapSize / MAP_WIDTH;
		const scaleY = miniMapHeight / MAP_HEIGHT;
		
		// Draw title
		ctx.font = '10px Arial';
		ctx.fillStyle = '#FFFFFF';
		ctx.textAlign = 'center';
		ctx.fillText('MINIMAP', miniMapX + miniMapSize/2, miniMapY + 12);
		
		// Draw map boundary
		ctx.strokeStyle = '#555555';
		ctx.lineWidth = 1;
		ctx.strokeRect(
			miniMapX + 2, 
			miniMapY + 18, 
			miniMapSize - 4, 
			miniMapHeight - 20
		);
		
		// Draw food on minimap (limit to 100 for performance)
		ctx.fillStyle = 'rgba(245, 158, 11, 0.7)';
		food.slice(0, 100).forEach(foodItem => {
			ctx.beginPath();
			ctx.arc(
				miniMapX + foodItem.x * scaleX,
				miniMapY + 18 + foodItem.y * scaleY,
				1.5,
				0,
				Math.PI * 2
			);
			ctx.fill();
		});
		
		// Draw players on minimap
		players.forEach(player => {
			if (player.segments.length > 0) {
				const head = player.segments[0].position;
				const color = snakeColors[player.id] || '#FFFFFF';
				
				// Draw a glow for player's own snake
				if (player.id === playerId) {
					ctx.shadowColor = '#FFFFFF';
					ctx.shadowBlur = 5;
				}
				
				ctx.fillStyle = player.id === playerId ? '#FFFF00' : color;
				ctx.beginPath();
				ctx.arc(
					miniMapX + head.x * scaleX,
					miniMapY + 18 + head.y * scaleY,
					player.id === playerId ? 3 : 2,
					0,
					Math.PI * 2
				);
				ctx.fill();
				ctx.shadowBlur = 0;
			}
		});
		
		// Draw viewport rectangle with pulsing effect
		const pulseIntensity = 0.7 + 0.3 * Math.sin(roundInfo.serverTime / 300);
		ctx.strokeStyle = `rgba(16, 185, 129, ${pulseIntensity})`;
		ctx.lineWidth = 2;
		ctx.strokeRect(
			miniMapX + (cameraX - canvasWidth / 2) * scaleX,
			miniMapY + 18 + (cameraY - canvasHeight / 2) * scaleY,
			canvasWidth * scaleX,
			canvasHeight * scaleY
		);
		
		// Draw a "M" toggle hint
		ctx.font = '9px Arial';
		ctx.fillStyle = '#AAAAAA';
		ctx.textAlign = 'right';
		ctx.fillText('Press M to toggle', miniMapX + miniMapSize - 5, miniMapY + miniMapHeight - 5);
	}

	function drawWaitingForPlayers() {
			if (!ctx || !canvasElement) return;
		
			// Don't completely cover the game - use a more transparent overlay
			ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
			ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);
		
			// Create a background box for text
			ctx.fillStyle = 'rgba(16, 24, 39, 0.95)';
			const boxWidth = 400;
			const boxHeight = 250;
			const boxX = (canvasElement.width - boxWidth) / 2;
			const boxY = (canvasElement.height - boxHeight) / 2;
			ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
		
			// Add a border to the box
			ctx.strokeStyle = players.length < 2 ? '#FFaa33' : '#10B981';
			ctx.lineWidth = 3;
			ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
		
			// Draw message
			ctx.font = 'bold 24px Arial';
			ctx.fillStyle = '#FFFFFF';
			ctx.textAlign = 'center';
			ctx.fillText('Waiting for Players', canvasElement.width / 2, boxY + 40);
		
			ctx.font = '18px Arial';
			ctx.fillStyle = '#FFaa33';
			const playersNeeded = roundInfo.playersNeeded || 0;
			ctx.fillText(
				`Need ${playersNeeded} more player${playersNeeded !== 1 ? 's' : ''} to start`,
				canvasElement.width / 2,
				boxY + 80
			);
		
			// Draw players count
			ctx.font = '16px Arial';
			ctx.fillText(
				`${players.length} player${players.length !== 1 ? 's' : ''} connected`,
				canvasElement.width / 2,
				boxY + 120
			);
		
			// Draw a tip
			ctx.font = '14px Arial';
			ctx.fillStyle = '#FFAA33';
			ctx.fillText(
				'Invite a friend to play! They need to use the same URL.',
				canvasElement.width / 2,
				boxY + 160
			);
			
			// Add force start instruction for testing
			ctx.font = '12px Arial';
			ctx.fillStyle = '#AAAAAA';
			ctx.fillText(
				'Press F to force start the game (for testing)',
				canvasElement.width / 2,
				boxY + 185
			);
		
			// Draw snake animation to show the game is alive
			const time = roundInfo.serverTime / 1000;
			const x = canvasElement.width / 2 + Math.sin(time) * 50;
			const y = boxY + 220;
		
			ctx.fillStyle = '#10B981';  // Emerald color
			ctx.beginPath();
			ctx.arc(x, y, 10, 0, Math.PI * 2);
			ctx.fill();
		
			ctx.beginPath();
			ctx.arc(x - 25, y, 10, 0, Math.PI * 2);
			ctx.fill();
		
			ctx.beginPath();
			ctx.arc(x - 50, y, 10, 0, Math.PI * 2);
			ctx.fill();
		}

	function drawGameInfo() {
			if (!ctx) return;
		
			// Draw round info
			ctx.font = 'bold 16px Arial';
			ctx.fillStyle = '#FFFF00';
			ctx.textAlign = 'left';
			ctx.fillText(`Round: ${roundInfo.roundNumber}`, 20, 30);

			// Draw player count if waiting for players
			if (roundInfo.waitingForPlayers) {
				ctx.fillText(`Players: ${players.length}/2`, 20, 55);
			}

			// Draw player stats (top right)
			ctx.textAlign = 'right';
			ctx.fillStyle = '#FFFFFF';
			ctx.fillText(`Score: ${score}`, canvasElement.width - 20, 30);
			ctx.fillStyle = kills >= 8 ? '#FF5555' : kills >= 5 ? '#FFAA33' : '#FFFFFF';
			ctx.fillText(`Kills: ${kills}/10`, canvasElement.width - 20, 55);

			// Draw connection status
			ctx.textAlign = 'center';
			ctx.font = '14px Arial';
			ctx.fillStyle =
				gameStatus.includes('error') || gameStatus.includes('Disconnected') ? '#FF5555' : 
				gameStatus.includes('Waiting') ? '#FFAA33' : '#55FF55';
			ctx.fillText(gameStatus, canvasElement.width / 2, 20);
		
			// Debug info
			if (debugMode) {
				ctx.font = '12px Courier';
				ctx.fillStyle = '#FFFF00';
				ctx.textAlign = 'left';
				ctx.fillText(`Game Active: ${roundInfo.isActive}`, 10, canvasElement.height - 140);
				ctx.fillText(`Waiting: ${roundInfo.waitingForPlayers}`, 10, canvasElement.height - 125);
				ctx.fillText(`Players: ${players.length}`, 10, canvasElement.height - 110);
				ctx.fillText(`Players Needed: ${roundInfo.playersNeeded}`, 10, canvasElement.height - 95);
				ctx.fillText(`Camera: ${Math.round(cameraX)},${Math.round(cameraY)}`, 10, canvasElement.height - 80);
				ctx.fillText(`Map: ${MAP_WIDTH}x${MAP_HEIGHT}`, 10, canvasElement.height - 65);
				ctx.fillText(`Server Time: ${roundInfo.serverTime}`, 10, canvasElement.height - 50);
				ctx.fillText(`End Time: ${roundInfo.endTime}`, 10, canvasElement.height - 35);
				ctx.fillText(`Press D to toggle debug info`, 10, canvasElement.height - 20);
				ctx.fillText(`Press F to force start, M for minimap`, 10, canvasElement.height - 5);
			}
		}

	function drawLastAliveMessage() {
		if (!ctx || !canvasElement) return;
		
		// Draw semi-transparent overlay
		ctx.fillStyle = 'rgba(16, 185, 129, 0.1)'; // Light green
		ctx.fillRect(0, 0, canvasElement.width, canvasHeight);
		
		// Create a background box for text
		const boxWidth = 400;
		const boxHeight = 100;
		const boxX = (canvasElement.width - boxWidth) / 2;
		const boxY = 20;
		
		ctx.fillStyle = 'rgba(16, 24, 39, 0.8)';
		ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
		
		// Add a border to the box
		ctx.strokeStyle = '#10B981';
		ctx.lineWidth = 2;
		ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
		
		// Draw message
		ctx.font = 'bold 24px Arial';
		ctx.fillStyle = '#10B981';
		ctx.textAlign = 'center';
		ctx.fillText('Last Snake Standing!', canvasElement.width / 2, boxY + 40);
		
		ctx.font = '16px Arial';
		ctx.fillStyle = '#FFFFFF';
		ctx.fillText('Other snakes will respawn soon...', canvasElement.width / 2, boxY + 70);
	}

	// Function to draw announcements
	function drawAnnouncements() {
		if (!ctx || !canvasElement || announcements.length === 0) return;
		
		const spacing = 40; // Vertical spacing between announcements
		const maxWidth = 400; // Maximum width of announcement box
		const leftPadding = 20;
		const padding = 12;
		const cornerRadius = 8;
		
		let yPosition = 80; // Start position from top
		
		// Show only 2 announcements at a time, newest first
		const sortedAnnouncements = [...announcements]
			.sort((a, b) => b.startTime - a.startTime)
			.slice(0, 2);
		
		for (const announcement of sortedAnnouncements) {
			// Calculate elapsed time for fade effect
			const elapsed = Date.now() - announcement.startTime;
			const opacity = Math.min(1, Math.max(0, 1 - (elapsed / announcement.duration)));
			
			if (opacity <= 0) continue;
			
			// Set colors based on announcement type
			let bgColor, textColor, borderColor;
			switch (announcement.type) {
				case 'success':
					bgColor = `rgba(16, 185, 129, ${opacity * 0.3})`;
					borderColor = `rgba(16, 185, 129, ${opacity * 0.9})`;
					textColor = `rgba(16, 185, 129, ${opacity * 0.9})`;
					break;
				case 'warning':
					bgColor = `rgba(245, 158, 11, ${opacity * 0.3})`;
					borderColor = `rgba(245, 158, 11, ${opacity * 0.9})`;
					textColor = `rgba(245, 158, 11, ${opacity * 0.9})`;
					break;
				case 'error':
					bgColor = `rgba(239, 68, 68, ${opacity * 0.3})`;
					borderColor = `rgba(239, 68, 68, ${opacity * 0.9})`;
					textColor = `rgba(239, 68, 68, ${opacity * 0.9})`;
					break;
				default: // info
					bgColor = `rgba(59, 130, 246, ${opacity * 0.3})`;
					borderColor = `rgba(59, 130, 246, ${opacity * 0.9})`;
					textColor = `rgba(59, 130, 246, ${opacity * 0.9})`;
			}
			
			// Measure text to calculate box dimensions
			ctx.font = 'bold 16px Arial';
			const textWidth = Math.min(ctx.measureText(announcement.message).width, maxWidth - 2 * padding);
			const boxWidth = textWidth + 2 * padding;
			const boxHeight = 40;
			
			// Draw rectangle with background
			ctx.fillStyle = bgColor;
			ctx.strokeStyle = borderColor;
			ctx.lineWidth = 2;
			
			// Draw rounded rectangle
			ctx.beginPath();
			ctx.moveTo(leftPadding + cornerRadius, yPosition);
			ctx.lineTo(leftPadding + boxWidth - cornerRadius, yPosition);
			ctx.arcTo(leftPadding + boxWidth, yPosition, leftPadding + boxWidth, yPosition + cornerRadius, cornerRadius);
			ctx.lineTo(leftPadding + boxWidth, yPosition + boxHeight - cornerRadius);
			ctx.arcTo(leftPadding + boxWidth, yPosition + boxHeight, leftPadding + boxWidth - cornerRadius, yPosition + boxHeight, cornerRadius);
			ctx.lineTo(leftPadding + cornerRadius, yPosition + boxHeight);
			ctx.arcTo(leftPadding, yPosition + boxHeight, leftPadding, yPosition + boxHeight - cornerRadius, cornerRadius);
			ctx.lineTo(leftPadding, yPosition + cornerRadius);
			ctx.arcTo(leftPadding, yPosition, leftPadding + cornerRadius, yPosition, cornerRadius);
			ctx.closePath();
			
			ctx.fill();
			ctx.stroke();
			
			// Draw text
			ctx.fillStyle = textColor;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'middle';
			
			// Handle text wrapping if needed
			if (textWidth < ctx.measureText(announcement.message).width) {
				// Simple wrapping, just truncate with ellipsis
				const text = announcement.message;
				let truncatedText = text;
				while (ctx.measureText(truncatedText + '...').width > maxWidth - 2 * padding && truncatedText.length > 0) {
					truncatedText = truncatedText.slice(0, -1);
				}
				ctx.fillText(truncatedText + '...', leftPadding + padding, yPosition + boxHeight / 2);
			} else {
				ctx.fillText(announcement.message, leftPadding + padding, yPosition + boxHeight / 2);
			}
			
			yPosition += spacing;
		}
	}

	function drawLeaderboard() {
		if (!ctx || !canvasElement) return;
		
		// Return early if the game is waiting for players and the leaderboard isn't explicitly set to show
		if (roundInfo.waitingForPlayers && !showLeaderboard) return;
		
		// Calculate leaderboard dimensions - make it responsive
		const boxWidth = Math.min(500, canvasElement.width * 0.8);
		const boxHeight = Math.min(500, canvasElement.height * 0.8);
		const boxX = (canvasElement.width - boxWidth) / 2;
		const boxY = (canvasElement.height - boxHeight) / 2;
		
		// Draw semi-transparent background with blur effect
		ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
		ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
		
		// Draw border with glow
		ctx.strokeStyle = '#10B981'; // Emerald color
		ctx.lineWidth = 3;
		ctx.shadowColor = '#10B981';
		ctx.shadowBlur = 10;
		ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
		ctx.shadowBlur = 0;

		// Draw title with enhanced style
		ctx.font = 'bold 28px Arial';
		ctx.fillStyle = '#10B981';
		ctx.textAlign = 'center';
		let titleText = 'LEADERBOARD';
		if (gameWinner) {
			titleText = `GAME OVER!`;
		} else if (roundInfo.waitingForPlayers) {
			titleText = `WAITING FOR PLAYERS`;
		}
		
		// Draw title with shadow for better visibility
		ctx.shadowColor = '#10B981';
		ctx.shadowBlur = 15;
		ctx.fillText(titleText, canvasElement.width / 2, boxY + 40);
		ctx.shadowBlur = 0;
		
		// Draw subtitle if there's a game winner
		if (gameWinner) {
			ctx.font = 'bold 20px Arial';
			ctx.fillStyle = '#FFFFFF';
			ctx.fillText(
				`${gameWinner === playerId ? 'You won!' : gameWinner.substring(0, 8) + ' won'} with 10 kills!`,
				canvasElement.width / 2,
				boxY + 70
			);
		}

		// Draw leaderboard entries or current player rankings
		ctx.font = '16px Arial';
		let startY = gameWinner ? boxY + 100 : boxY + 70;
		let y = startY;

			// If we have a leaderboard use it, otherwise build from current players
			const displayLeaderboard = leaderboard.length > 0 ? 
				leaderboard : 
				players
					.map(p => ({id: p.id, kills: p.kills, score: p.score}))
					.sort((a, b) => b.kills - a.kills || b.score - a.score);
		
			displayLeaderboard.slice(0, 10).forEach((entry, index) => {
			const isPlayer = entry.id === playerId;

			// Highlight player's entry
			if (isPlayer) {
				ctx.fillStyle = 'rgba(16, 185, 129, 0.3)'; // Light emerald background
				ctx.fillRect(canvasElement.width / 4 + 10, y - 20, canvasElement.width / 2 - 20, 25);
			}

			// Draw rank with medal icons for top 3
			ctx.textAlign = 'center';
			if (index < 3) {
				const medals = ['🥇', '🥈', '🥉'];
				ctx.font = '20px Arial';
				ctx.fillText(medals[index], boxX + 30, y);
				ctx.font = '16px Arial';
			} else {
				ctx.fillStyle = '#AAAAAA';
				ctx.fillText(`${index + 1}`, boxX + 30, y);
			}
			
			// Draw name with background highlight for current player
			ctx.textAlign = 'left';
			if (isPlayer) {
				// Draw highlight background for player's own entry
				ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
				ctx.fillRect(boxX + 50, y - 18, boxWidth - 100, 25);
			}
			
			ctx.fillStyle = isPlayer ? '#10B981' : '#FFFFFF';
			ctx.fillText(
				entry.id.substring(0, 8) + (isPlayer ? ' (You)' : ''),
				boxX + 60,
				y
			);
			
			// Draw score and kills
			ctx.fillStyle = '#FFFFFF';
			ctx.textAlign = 'right';
			ctx.fillText(`Score: ${entry.score}`, boxX + boxWidth - 140, y);
			
			// Draw kills with color based on progress
			ctx.fillStyle = entry.kills >= 8 ? '#FF5555' : entry.kills >= 5 ? '#FFAA33' : '#FFFFFF';
			ctx.fillText(`Kills: ${entry.kills}/10`, boxX + boxWidth - 40, y);

			y += 30;
		});

		// Draw message at the bottom of the leaderboard
		ctx.font = '16px Arial';
		ctx.fillStyle = '#AAAAAA';
		ctx.textAlign = 'center';
		
		// Calculate time to next round
		let nextRoundMessage = 'Respawning soon...';
		if (roundInfo.gameOver && roundInfo.endTime) {
			const secondsLeft = Math.max(0, Math.ceil((roundInfo.endTime - roundInfo.serverTime) / 1000));
			nextRoundMessage = `New round in ${secondsLeft} second${secondsLeft !== 1 ? 's' : ''}...`;
		} else if (roundInfo.waitingForPlayers) {
			const playersNeeded = roundInfo.playersNeeded || 0;
			nextRoundMessage = `Waiting for ${playersNeeded} more player${playersNeeded !== 1 ? 's' : ''}`;
		} else if (!isAlive) {
			nextRoundMessage = 'You will respawn soon...';
		}
		
		// Draw message box
		const msgBoxY = boxY + boxHeight - 70;
		ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
		ctx.fillRect(boxX + 20, msgBoxY, boxWidth - 40, 40);
		ctx.strokeStyle = '#555555';
		ctx.lineWidth = 1;
		ctx.strokeRect(boxX + 20, msgBoxY, boxWidth - 40, 40);
		
		// Draw message
		ctx.fillStyle = '#FFFFFF';
		ctx.fillText(
			nextRoundMessage,
			canvasElement.width / 2,
			msgBoxY + 25
		);
		
		// Add game rules reminder
		ctx.font = '14px Arial';
		ctx.fillStyle = '#FFFF00';
		ctx.shadowColor = '#000000';
		ctx.shadowBlur = 5;
		ctx.fillText(
			'First player to reach 10 kills wins the game!',
			canvasElement.width / 2,
			boxY + boxHeight - 15
		);
		ctx.shadowBlur = 0;
	}

	function drawDeathMessage() {
			if (!ctx || !canvasElement || !browser) return;
		
		// Create a pulsing animation effect based on time
		const pulseIntensity = 0.2 + 0.1 * Math.sin(roundInfo.serverTime / 200);
		
		// Draw semi-transparent background with pulsing effect
		ctx.fillStyle = `rgba(255, 0, 0, ${pulseIntensity})`;
		ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);
		
		// Create a dark overlay in the center for text
		ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
		const boxWidth = canvasElement.width / 2;
		const boxHeight = 150;
		const boxX = (canvasElement.width - boxWidth) / 2;
		const boxY = (canvasElement.height - boxHeight) / 2;
		ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
		
		// Draw border with pulsing effect
		ctx.strokeStyle = `rgba(255, 85, 85, ${0.7 + 0.3 * Math.sin(roundInfo.serverTime / 300)})`;
		ctx.lineWidth = 3;
		ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
		
		// Draw death message
		ctx.font = 'bold 32px Arial';
		ctx.fillStyle = '#FF5555';
		ctx.textAlign = 'center';
		ctx.fillText('YOU DIED', canvasElement.width / 2, boxY + 40);
		
		// Draw reason
		ctx.font = '18px Arial';
		ctx.fillStyle = '#FFFFFF';
		ctx.fillText(deathReason, canvasElement.width / 2, boxY + 80);
		
		// Draw killer info if available
		if (killedBy) {
			ctx.fillStyle = '#FFAA33';
			ctx.fillText(
				`Killed by: ${killedBy.substring(0, 8)}`,
				canvasElement.width / 2,
				boxY + 110
			);
		}
		
		// Draw spectator message
		ctx.font = '14px Arial';
		ctx.fillStyle = '#AAAAAA';
		ctx.fillText('Waiting for next round to start...', canvasElement.width / 2, boxY + 140);
	}


	
	function drawPulsingBorder() {
	}
	
	function updateCanvasSize() {
		if (!browser || !canvasElement) return;
		
		// Get the current computed dimensions from CSS
		const computedStyle = window.getComputedStyle(canvasElement);
		const displayWidth = parseInt(computedStyle.width, 10);
		const displayHeight = parseInt(computedStyle.height, 10);
		
		// Set base dimensions first based on selected size
		if (canvasSize === 'default') {
			canvasWidth = 720;
			canvasHeight = 480;
		} else if (canvasSize === 'larger') {
			canvasWidth = 1024;
			canvasHeight = 680;
		} else if (canvasSize === 'fullscreen' && typeof window !== 'undefined') {
			// For fullscreen, use window dimensions directly
			canvasWidth = window.innerWidth;
			canvasHeight = window.innerHeight;
			
			// Update canvas dimensions immediately
			canvasElement.width = canvasWidth;
			canvasElement.height = canvasHeight;
			
			// Apply sizing directly via style for fullscreen
			if (canvasElement) {
				canvasElement.style.width = `${canvasWidth}px`;
				canvasElement.style.height = `${canvasHeight}px`;
			}
			
			// Re-initialize the context after fullscreen resize
			if (ctx) {
				ctx = canvasElement.getContext('2d');
			}
			
			return; // Skip the rest for fullscreen mode
		}
		
		// Only update if dimensions have changed to avoid resetting the canvas (for non-fullscreen)
		if (canvasElement.width !== displayWidth || canvasElement.height !== displayHeight) {
			// If computed dimensions are different, use those instead
			if (displayWidth > 0 && displayHeight > 0) {
				canvasWidth = displayWidth;
				canvasHeight = displayHeight;
			}
			
			// Set the actual canvas dimensions (important for correct rendering)
			canvasElement.width = canvasWidth;
			canvasElement.height = canvasHeight;
			
			// Re-initialize the context after resize
			if (ctx) {
				ctx = canvasElement.getContext('2d');
			}
		}
	}

	function setCanvasSize(size: string) {
		canvasSize = size;
		if (size === 'fullscreen' && typeof document !== 'undefined') {
			isFullscreenOpen = true;
			document.body.style.overflow = 'hidden';
			
			// When switching to fullscreen, immediately resize the canvas
			if (canvasElement) {
				canvasWidth = window.innerWidth;
				canvasHeight = window.innerHeight;
				canvasElement.width = canvasWidth;
				canvasElement.height = canvasHeight;
				
				// Explicitly set the style dimensions
				canvasElement.style.width = `${canvasWidth}px`;
				canvasElement.style.height = `${canvasHeight}px`;
			}
		}
		updateCanvasSize();
		
		// Auto switch to fullscreen on mobile
		if (isMobileDevice && !isFullscreenOpen) {
			setTimeout(() => {
				setCanvasSize('fullscreen');
				showTouchControls = true;
				updateCanvasSize(); // Ensure proper sizing after change
			}, 1000);
		}
	}

	function closeFullscreen() {
		if (typeof document !== 'undefined') {
			isFullscreenOpen = false;
			canvasSize = 'default';
			document.body.style.overflow = 'auto';
			
			// Reset any explicitly set style dimensions
			if (canvasElement) {
				canvasElement.style.width = '';
				canvasElement.style.height = '';
			}
			
			// Allow a moment for CSS to update before resizing
			setTimeout(() => {
				updateCanvasSize();
			}, 50);
		}
	}

	function toggleTouchControls() {
		showTouchControls = !showTouchControls;
	}
</script>

<style>
  /* Animation for kill effect */
  @keyframes killFlash {
    0% { opacity: 0.7; }
    50% { opacity: 0.4; }
    100% { opacity: 0; }
  }
  
  /* Animation for food collection */
  @keyframes pulseGrow {
    0% { transform: scale(1); }
    50% { transform: scale(1.1); }
    100% { transform: scale(1); }
  }
  
  .kill-flash {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(239, 68, 68, 0.3);
    pointer-events: none;
    z-index: 9999;
    animation: killFlash 0.5s ease-out forwards;
  }
</style>

{#if browser}
	<div class="flex flex-col items-center">
		<div class="mb-4">
			<div class="flex items-center flex-col gap-2">
				<canvas
					bind:this={canvasElement}
					class="{canvasSize === 'default'
						? 'w-[720px] h-[480px]'
						: canvasSize === 'larger'
							? 'w-[1024px] h-[680px]'
							: 'w-full h-screen'} bg-gray-900 rounded-lg shadow-md border border-emerald-500 transition-all duration-300"
					style="{canvasSize === 'fullscreen' ? `width: ${canvasWidth}px; height: ${canvasHeight}px;` : ''}"
				>
				</canvas>

				{#if isMobileDevice}
					<button
						class="mt-3 bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium border border-emerald-500 hover:bg-emerald-600 transition-all duration-200 focus:outline-none"
						onclick={() => setCanvasSize('fullscreen')}
					>
						Play Fullscreen
					</button>
				{:else}
					<div class="inline-flex rounded-lg shadow-sm mt-3">
						<button
							class="{canvasSize === 'default'
								? 'bg-emerald-500 text-white'
								: 'bg-white text-gray-700'} px-4 py-2 rounded-l-lg font-medium border border-emerald-500 hover:bg-emerald-100 transition-all duration-200 focus:outline-none text-xs"
							onclick={() => setCanvasSize('default')}>Default</button
						>
						<button
							class="{canvasSize === 'larger'
								? 'bg-emerald-500 text-white'
								: 'bg-white text-gray-700'} px-4 py-2 font-medium border-t border-b border-emerald-500 hover:bg-emerald-100 transition-all duration-200 focus:outline-none text-xs"
							onclick={() => setCanvasSize('larger')}>Larger</button
						>
						<button
							class="{canvasSize === 'fullscreen'
								? 'bg-emerald-500 text-white'
								: 'bg-white text-gray-700'} px-4 py-2 rounded-r-lg font-medium border border-emerald-500 hover:bg-emerald-100 transition-all duration-200 focus:outline-none text-xs"
							onclick={() => setCanvasSize('fullscreen')}>Full Screen</button
						>
					</div>
				{/if}
			</div>
		</div>

		{#if isFullscreenOpen}
			<div class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
				<div class="relative w-full h-full p-4">
					<button
						class="absolute top-6 right-6 bg-emerald-300 rounded-full p-2 hover:bg-gray-200 z-10"
						onclick={closeFullscreen}
						aria-label="Close fullscreen"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-6 w-6"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>

					<canvas 
						bind:this={canvasElement} 
						class="w-full h-full bg-gray-900 rounded-xl transition-all duration-300"
						style="width: 100%; height: 100%;"
					> </canvas>

					{#if isMobileDevice && showTouchControls}
						<div class="absolute bottom-20 left-1/2 transform -translate-x-1/2 z-10">
							<button
								class="bg-emerald-500 bg-opacity-50 text-white p-2 rounded-full mb-4 w-12 h-12 flex items-center justify-center"
								onclick={toggleTouchControls}
								aria-label="Toggle touch controls"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-6 w-6"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
									/>
								</svg>
							</button>

							<div
								id="joystick-outer"
								class="w-32 h-32 bg-gray-700 bg-opacity-50 rounded-full border-2 border-emerald-500 flex items-center justify-center"
							>
								<div
									id="joystick-inner"
									class="w-16 h-16 bg-emerald-500 rounded-full transition-transform duration-75"
								></div>
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
