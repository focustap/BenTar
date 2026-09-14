FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV PORT=22000
EXPOSE 22000
CMD ["sh", "-c", "gunicorn -b 0.0.0.0:${PORT} app:app"]
