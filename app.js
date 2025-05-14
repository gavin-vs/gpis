// Image-Scaler - Self-hosted with Express web server
const https = require('https');
const sharp = require('sharp');

// Express settings, required for self-hosted or Amplify versions only
const express = require('express');
const app = express();
const LISTEN_PORT = process.env.PORT || 3000; // process.env.PORT is necessary for Amplify as it's dynamically allocated
const LISTEN_ADDR = `127.0.0.1`;

const baseURL = `https://www.visitscotland.com`;

const svgMethod = `css`;

// Size mapping
const sizeMap = {
  'xxs': 48,
  'xs': 300,
  'sm': 600,
  'md': 1200,
  'lg': 2048,
  'xl': 2048
};

// main method, uses "exports.handler" for Lambda requests and "app.get" for Express requests
// Lambda handler would normally use "event" but we're using "req" to align with non-Lambda version
app.get('*', async (req, res) => {
  const imagePath = req.path;
  const sizeKey = req.query.size;
  const width = sizeMap[sizeKey] || sizeMap['md']; // fallback to 'md' if invalid

  const imageUrl = `${baseURL}${imagePath}`;

  console.log(`Processing request for ${imageUrl} for resize to ${sizeKey}`);

  // Ignore /favicon.ico requests
  if (imagePath === '/favicon.ico') {
    console.log(`Rejected request for: ${imageUrl}`);
    res.status(204).send(); return;
  }

  try {
    // Use a promise-based approach to fetch the image and process it
    const result = await new Promise((resolve, reject) => {
      console.log(`Accepted request for ${imageUrl} for resize to ${sizeKey}`);
      https.get(imageUrl, (response) => {
        let chunks = [];

        // Check the content-type and status code early
        const contentType = response.headers['content-type'] || '';
        if (!contentType.startsWith('image/')) {
          console.log(`Invalid content-type: ${contentType}`);
          reject('URL did not return an image.');
          return;
        }

        // Collect data chunks
        response.on('data', (chunk) => {
          chunks.push(chunk);
        });

        // Handle the end of the response
        response.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks); // Combine the chunks into a buffer
            const image = sharp(buffer); // Pass the buffer to Sharp
            const metadata = await image.metadata();

            console.log(`Fetched ${imageUrl} - status ${response.statusCode}, content-type ${contentType}`);

            const currentRatio = metadata.width / metadata.height;
            const targetRatio = 3 / 2;
            const ratioDifference = Math.abs(currentRatio - targetRatio);

            let cropOptions = {};

            // gp: check this logic, doesn't this else ALWAYS apply the else, even if the ratio is bang on?
            if (ratioDifference > 0.01) {
              console.log(`Ratio difference > 0.01 at ${ratioDifference} - cropping required`);
              if (currentRatio > targetRatio) {
                console.log(`Source image ratio ${currentRatio} is greater than target image ratio ${targetRatio} so image is too wide - cropping`);
                const newWidth = Math.round(metadata.height * targetRatio);
                const xOffset = Math.floor((metadata.width - newWidth) / 2);
                cropOptions = { left: xOffset, top: 0, width: newWidth, height: metadata.height };
              } else {
                console.log(`Source image ratio ${currentRatio} is less than target image ratio ${targetRatio} so image is too tall - cropping`);
                const newHeight = Math.round(metadata.width / targetRatio);
                const yOffset = Math.floor((metadata.height - newHeight) / 2);
                cropOptions = { left: 0, top: yOffset, width: metadata.width, height: newHeight };
              }
            } else {
              console.log(`Ratio difference negligible at ${ratioDifference} no cropping required`);
            }

            let pipeline = image;

            if (Object.keys(cropOptions).length) {
              pipeline = pipeline.extract(cropOptions);
            }

            let body = '';
            let contentTypeResponse = '';

            if (sizeKey === 'xxs' && svgMethod === 'css') {
              // For 'xxs' size: Output as a low quality JPG, then embed in SVG. Allow CSS to perform the blur. Mimics the Java ISS functionality.
              console.log(`Sharp will not perform the blur operation because svgMethod=${svgMethod}`);
              const outputBuffer = await pipeline
                .resize({ width })
                .jpeg({ quality: 50, compressionLevel: 10, adaptiveFiltering: true, force: true }) // Compress original more aggressively
                .toBuffer();

              // Convert outputBuffer to base64
              const base64Image = outputBuffer.toString('base64');
              const svgWidth = `1200`;
              const svgHeight = Math.round(svgWidth / targetRatio);

              // Embedding the base64 JPEG image in an SVG
              const svgContent = `
                <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" version="1.1">
                  <filter id="blur" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
                    <feGaussianBlur stdDeviation="20 20" edgeMode="duplicate"/>
                  <feComponentTransfer>
                    <feFuncA type="discrete" tableValues="1 1"/>
                  </feComponentTransfer>
                  </filter>
                  <image filter="url(#blur)" xlink:href="data:image/jpeg;base64,${base64Image}" x="0" y="0" width="100%" height="100%" />
                </svg>
              `;
              body = svgContent;
              contentTypeResponse = 'image/svg+xml';
	    } else if (sizeKey === 'xxs' && svgMethod !== 'css') {
              // For 'xxs' size: Apply blur and output as JPG (not SVG)
      	      console.log(`Sharp will perform the blur operation because svgMethod=${svgMethod}`);
              const outputBuffer = await pipeline
                .resize({ width })
                .blur(25) // Apply blur
                .jpeg({ quality: 50, compressionLevel: 10, adaptiveFiltering: true, force: true }) // Compress original more aggressively
                .toBuffer();

              // Convert outputBuffer to base64
              const base64Image = outputBuffer.toString('base64');

              // Embedding the base64 JPEG image in an SVG
              const svgContent = `
                <svg width="${width}" height="${Math.round(width / targetRatio)}" xmlns="http://www.w3.org/2000/svg">
                  <image href="data:image/jpeg;base64,${base64Image}" width="100%" height="100%" />
                </svg>
              `;
              body = svgContent;
              contentTypeResponse = 'image/svg+xml';
            } else {
              // For other sizes: Resize to target width and send as WebP
              const outputBuffer = await pipeline
                .resize({ width })
                .webp({ quality: 60 })
                .toBuffer();

              // Convert outputBuffer to base64
              const base64Image = outputBuffer.toString('base64');

              // Send Base64 encoded output to API Gateway / Send Output Buffer to Express
              body = outputBuffer;
              contentTypeResponse = 'image/webp';
            }

            resolve({ body, contentTypeResponse });
          } catch (err) {
            console.error('Error during image processing:', err.message);
            reject('Image could not be processed.');
          }
        });
      }).on('error', (err) => {
        console.error('Image fetch error:', err.message);
        reject('Image could not be fetched.');
      });
    });

    // Return the processed image as the Express response
    console.log(`Serving the processed response`);
    res.set('Content-Type', result.contentTypeResponse);
    res.send(result.body);
  } catch (err) {
    console.error('Image processing error:', err.message);
    res.status(500).send('Image could not be processed.');
  } //end try-catch
}); // end main method

// enable Express web server to listen on defined port
app.listen(LISTEN_PORT, LISTEN_ADDR, () => {
  console.log(`Server running at http://${LISTEN_ADDR}:${LISTEN_PORT}/`);
});
