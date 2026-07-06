FROM node:24-slim

ENV NODE_ENV=production
# node-cron usa o TZ do sistema; sem isso o disparo das 08h sai em UTC.
ENV TZ=America/Sao_Paulo

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY views ./views

# Persistência do SQLite: monte um volume do EasyPanel em /data.
ENV SQLITE_PATH=/data/envios.db
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "src/index.js"]
