FROM node:18-alpine
RUN apk add --no-cache ffmpeg graphicsmagick
WORKDIR /app
RUN adduser -D app
COPY --chown=app:app . .
RUN npm install --production
RUN mkdir -p ./tmp ./static/stems
RUN chown -R app:app ./tmp ./static
USER app
ENTRYPOINT ["node", "index.js"]