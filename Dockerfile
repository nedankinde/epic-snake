FROM oven/bun:latest

# Set working directory
WORKDIR /app

# Copy project files
COPY . .

# Make your script executable
RUN chmod +x start.sh

# Install dependencies
RUN bun install

# Start both processes
CMD ["./start.sh"]
