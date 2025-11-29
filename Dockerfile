# ---------- build stage ----------
FROM node:20-alpine AS build

WORKDIR /app

# Install project deps
COPY package*.json ./
RUN npm install

# Copy the rest of the source and build
COPY . .
RUN npm run build

# ---------- runtime stage ----------
FROM node:20-alpine AS runner

WORKDIR /app

# Install static file server
RUN npm install -g serve

# Copy built assets from build stage
COPY --from=build /app/dist ./dist

EXPOSE 3000

# Serve the built site
CMD ["serve", "-s", "dist", "-l", "3000"]
