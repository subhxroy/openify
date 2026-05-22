# Use official lightweight Python image
FROM python:3.10-slim

# Install system dependencies and Node.js (needed by yt-dlp to decipher YouTube signatures)
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements and install Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create directory for data files and cache
RUN mkdir -p data song_cache

# Expose the port uvicorn runs on
EXPOSE 8000

# Start uvicorn server
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
