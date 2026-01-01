# ---------- build + runtime ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source
COPY . .

# Build the static assets
RUN npm run build

FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install a simple static file server and drop privileges
RUN npm install -g serve \
  && addgroup -S app \
  && adduser -S app -G app

COPY --from=builder --chown=app:app /app/build ./build

USER app

EXPOSE 3000

# Try dist, then public, then build
CMD ["sh", "-c", "\
  ROOT_DIR=dist; \
  if [ ! -d dist ]; then \
    if [ -d public ]; then ROOT_DIR=public; \
    elif [ -d build ]; then ROOT_DIR=build; \
    else echo 'No dist/public/build directory after build; contents:'; ls -R .; exit 1; \
    fi; \
  fi; \
  echo \"Serving $ROOT_DIR on :3000\"; \
  exec serve -s \"$ROOT_DIR\" -l 3000 \
"]
