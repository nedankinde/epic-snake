# Epic Snake Game

A multiplayer snake game built with Svelte and Bun WebSockets.

## Game Rules

**First to 10 kills wins the game!**

**Requires at least 2 players to start a game.**

## Game Features

- Real-time multiplayer gameplay
- Eat food to grow your snake
- Battle other players - first to reach 10 kills wins!
- Collect points by eating food and eliminating other players
- Round-based gameplay with leaderboards
- Auto-waiting mode when fewer than 2 players are connected
- Customizable canvas size including fullscreen mode

## Controls

- Arrow keys to move your snake
- Try to eat food (yellow dots) to grow longer
- Avoid colliding with other snakes' tails
- Eliminate opponents by making them collide with your tail
- Get 10 kills before anyone else to win the game!

## Setup and Running

1. Install dependencies:

```bash
# Make sure you have Bun installed (https://bun.sh/)
bun install
```

2. Start the WebSocket server:

```bash
bun run wsserver
```

3. In a separate terminal, start the Svelte frontend:

```bash
bun run dev

# or start the server and open the app in a new browser tab
bun run dev -- --open
```

## Building for Production

To create a production version of the game:

```bash
bun run build
```

You can preview the production build with `bun run preview`.

## Technology Stack

- Frontend: Svelte, Canvas API
- Backend: Bun WebSockets
- Styling: TailwindCSS
- Server time synchronization for fair gameplay
- Smart game state management based on player count


> Note: To play with friends, make sure they connect to your local IP address or deploy the game to a server. Remember, you need at least 2 players for the game to start!
