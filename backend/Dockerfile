FROM node:20-alpine

RUN apk add --no-cache vips-dev fftw-dev gcc g++ make python3 py3-setuptools

WORKDIR /app

RUN npm init -y && \
    npm install node-addon-api node-gyp && \
    npm install express xlsx multer pdfkit pdf-parse speakeasy qrcode && \
    npm install --build-from-source sharp

COPY server.js .

CMD ["node", "server.js"]