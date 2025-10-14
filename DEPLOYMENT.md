# Deployment Guide

Complete guide for deploying the PDF Extraction Tool to production.

## Prerequisites

- Server with Python 3.9+ and Node.js 18+
- Mistral AI API key
- Groq API key
- Domain name (optional)
- SSL certificate (for HTTPS)

## Backend Deployment

### Option 1: Using Docker

1. **Create Dockerfile** in `backend/`:

```dockerfile
FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads outputs templates examples

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

2. **Build and run**:

```bash
docker build -t pdf-extraction-backend .
docker run -d -p 8000:8000 \
  -e MISTRAL_API_KEY=your_key \
  -e GROQ_API_KEY=your_key \
  -v ./uploads:/app/uploads \
  -v ./outputs:/app/outputs \
  --name pdf-extraction-backend \
  pdf-extraction-backend
```

### Option 2: Using Gunicorn

1. **Install Gunicorn**:

```bash
pip install gunicorn
```

2. **Run with Gunicorn**:

```bash
gunicorn main:app \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --timeout 300 \
  --access-logfile - \
  --error-logfile -
```

### Option 3: Using Systemd Service

1. **Create service file** `/etc/systemd/system/pdf-extraction.service`:

```ini
[Unit]
Description=PDF Extraction Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/pdf-extraction/backend
Environment="PATH=/var/www/pdf-extraction/backend/venv/bin"
EnvironmentFile