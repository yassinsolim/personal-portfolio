# ---------- build + runtime ----------
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Build the static assets
RUN npm run build

# Install a simple static file server
RUN npm install -g serve

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
