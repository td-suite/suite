# Suite TD · build del front-end e runtime Node con LibreOffice (moduli Business, Finance, Contracts generano PDF dai DOCX);
# poppler-utils (pdftotext/pdftoppm), tesseract (OCR italiano) e il font Lato servono a Referti esterni
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer fonts-liberation fonts-dejavu-core fonts-lato poppler-utils tesseract-ocr tesseract-ocr-ita wget ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ .
COPY --from=web /web/dist ./public
RUN addgroup --system td && adduser --system --ingroup td td && chown -R td:td /app && mkdir -p /tmp/tdf-lo-profile && chown td:td /tmp/tdf-lo-profile
USER td
ENV HOME=/tmp
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "src/index.js"]
