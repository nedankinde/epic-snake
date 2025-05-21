#!/bin/bash
bun run start &   # start web app in background
bun run wsserver  # keep websocket server in foreground
