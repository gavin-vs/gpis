const express = require('express');
const https = require('https');
const sharp = require('sharp');

const app = express();
const PORT = 3000;

// Size mapping
const sizeMap = {
  'xxs': 1200,
  'xs': 300,
  'sm': 600,
  'md': 1200,
  'lg': 2048,
  'xl': 2048
};

// Ignore favicon requests
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('*', async (req, res) => {
  const imagePath = req.path;
  const sizeKey = req.query.size;
  const width = sizeMap[sizeKey] || sizeMap['md']; // fallback to 'md' if invalid

  const imageUrl = `https://www.visitscotland.com${imagePath}`;

  try {
    // Fetch the image using https.get
    const response = await new Promise((resolve, reject) => {
      https.get(imageUrl, (res) => {
        let chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', (err) => reject(err));
      });
    });

    // Process the image
    const image = sharp(response);
    const metadata = await image.metadata();
    const contentType = req.headers['content-type'] || '';
    console.log(`Fetched ${imageUrl} - status ${response.statusCode}, content-type ${contentType}`);

    if (!contentType.startsWith('image/')) {
      throw new Error(`URL did not return an image. Content-Type: ${contentType}`);
    }

    const currentRatio = metadata.width / metadata.height;
    const targetRatio = 3 / 2;
    let cropOptions = {};

    if (Math.abs(currentRatio - targetRatio) > 0.01) {
      if (currentRatio > targetRatio) {
        const newWidth = Math.round(metadata.height * targetRatio);
        const xOffset = Math.floor((metadata.width - newWidth) / 2);
        cropOptions = { left: xOffset, top: 0, width: newWidth, height: metadata.height };
      } else {
        const newHeight = Math.round(metadata.width / targetRatio);
        const yOffset = Math.floor((metadata.height - newHeight) / 2);
        cropOptions = { left: 0, top: yOffset, width: metadata.width, height: newHeight };
      }
    }

    let pipeline = image;
    if (Object.keys(cropOptions).length) {
      pipeline = pipeline.extract(cropOptions);
    }

    let body = '';
    let contentTypeResponse = '';

    if (sizeKey === 'xxs') {
      // For 'xxs' size: Apply blur and output as PNG (not SVG)
      pipeline = pipeline
        .resize({ width })
        .blur(25) // Apply blur
        .jpeg({ quality: 50, compressionLevel: 10, adaptiveFiltering: true, force: true }); // Compress original more aggressively

      // Convert to buffer (JPEG format here)
      const outputBuffer = await pipeline.toFormat('jpeg').toBuffer();
      // Convert to SVG format by embedding the JPEG base64 image
      const base64Image = outputBuffer.toString('base64');
      const svgContent = `
        <svg width="${width}" height="${Math.round(width / targetRatio)}" xmlns="http://www.w3.org/2000/svg">
          <image href="data:image/jpeg;base64,${base64Image}" width="100%" height="100%" />
        </svg>
      `;
      body = svgContent;
      contentTypeResponse = 'image/svg+xml';
    } else {
      // For other sizes: Resize and send as WebP
      const outputBuffer = await pipeline
        .resize({ width })
        .webp({ quality: 60 })
        .toBuffer();

      body = outputBuffer.toString('base64'); // Base64 encoding for response
      contentTypeResponse = 'image/webp';
    }

    // Send the response
    res.set('Content-Type', contentTypeResponse);
    res.send(body);

  } catch (err) {
    console.error('Image processing error:', err.message);
    res.status(500).send('Image could not be processed.');
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://127.0.0.1:${PORT}/`);
});
