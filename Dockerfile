FROM oven/bun:latest

WORKDIR /app

COPY . .

RUN chmod +x start.sh

RUN bun install

EXPOSE 3000
EXPOSE 4000

CMD ["./start.sh"]
