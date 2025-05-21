<script>
	import Game from '../components/Game.svelte';
	import { browser } from '$app/environment';
	
	// Detect mobile device
	let isMobile = false;
	
	if (browser) {
		isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
	}
</script>

<div class="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
	<h1 class="text-4xl font-bold text-emerald-400 mb-2 tracking-wider">EPIC SNAKE GAME</h1>
	<h2 class="text-xl text-yellow-300 mb-6">First to 10 Kills Wins!</h2>

	<div class="relative bg-gray-800 p-4 rounded-lg shadow-2xl border-2 border-emerald-500">
		<Game />
	</div>

	<div class="mt-6 text-gray-300 text-center">
		{#if isMobile}
			<p class="text-sm">Use the joystick to control your snake</p>
			<p class="text-xs mt-1 text-emerald-300">Tap the screen to switch to fullscreen mode</p>
		{:else}
			<p class="text-sm">Use arrow keys to control the snake</p>
			<p class="text-xs mt-1 text-emerald-300">Move around to collect food and grow</p>
		{/if}
		<div class="bg-gray-800 p-3 rounded-lg mt-4 max-w-md mx-auto">
			<p class="text-yellow-300 font-bold">First to 10 kills wins!</p>
			<p class="text-xs mt-1 text-gray-300">Eliminate other players by making them crash into your snake's body</p>
			<p class="text-xs mt-1 text-emerald-300">Minimum 2 players required to start a game</p>
		</div>
	</div>

	{#if !browser}
		<div class="mt-4 p-4 bg-gray-800 text-gray-300 rounded-lg border border-emerald-500">
			<p>Loading game client...</p>
		</div>
	{/if}
</div>
