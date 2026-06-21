FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV SQLITE_PATH=/data/envios.db
EXPOSE 3000
CMD ["node", "src/index.js"]
