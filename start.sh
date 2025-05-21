#!/bin/bash
bun run dev --host 0.0.0.0 --port 3000 &   # start web app in background
bun run wsserver  # keep websocket server in foreground
