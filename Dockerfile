FROM oven/bun:latest

WORKDIR /app

COPY . .

RUN chmod +x start.sh

RUN bun install

EXPOSE 5173

CMD ["./start.sh"]
