#!/bin/bash
bun run dev &   # start web app in background
bun run wsserver  # keep websocket server in foreground
