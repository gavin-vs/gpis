// Image-Scaler - Hosted version - using Express web server
const https = require('https');
const http = require('http');
const sharp = require('sharp');
const { URL } = require('url');

const express = require('express');
const app = express();
const LISTEN_PORT = process.env.PORT || 3000;
const LISTEN_ADDR = `0.0.0.0`;

const appName = 'VS-Image-Scaler';
const appVersion = '0.0.1';

// Maximum size of the image to be processed (in MB)
const maximumSizeMB = 10;

// Enable with: VS_LOGGING=true node app.js
const vsLogging = process.env.VS_LOGGING === 'true';

// Extract VS_AUTH from environment variables
const vsAuth = process.env.VS_AUTH || 'vsAuth';


const baseURL = process.env.VS_BASE_URL || `https://www.visitscotland.com`;

const svgMethod = `css`;

const quality = 60;

const sizeMap = {
  'xxs': 48,
  'xs': 300,
  'sm': 600,
  'md': 1200,
  'lg': 2048,
  'xl': 2048
};

// define vs as an object to them allow vs.[function] functions
const vs = {};
vs.log = (...args) => {
    if (vsLogging) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}]`, ...args);
    } else {
      // do nothing, don't log unless the environment variable is set
    }
};

vs.err = (...args) => {
    if (vsLogging) {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}]`, ...args);
    } else {
        console.error(...args);
    }
};

function logConversionStats(originalBytes, outputBuffer, metadata, label = '') {
    const outputBytes = outputBuffer.length;
    const percentageReduction = ((originalBytes - outputBytes) / originalBytes * 100).toFixed(2);
    vs.log(`Processed size: ${metadata.width}x${metadata.height}, bytes: ${outputBytes} (${percentageReduction}% reduction)`);
}

// main method, uses "exports.handler" for Lambda requests and "app.get" for Express requests
// Lambda handler would normally use "event" but we're using "req" to align with non-Lambda version
app.get('*assetPath', async (req, res) => {
    vs.log('Starting timer');
    console.time('resize');

    const imagePath = req.path || req.rawPath || '';
    const sizeKey = req.query?.size || req.queryStringParameters?.size || 'md';
    const qualityValue = req.query?.quality || req.queryStringParameters?.quality ? parseInt(req.query?.quality || req.queryStringParameters?.quality) : quality;
    const svgMethodValue = req.query?.svgMethod || req.queryStringParameters?.svgMethod || svgMethod;
    const width = sizeMap[sizeKey] || sizeMap['md']; // fallback to 'md' if invalid

    const imageUrl = `${baseURL}${imagePath}`;

    const startTime = Date.now();

    try {
        // Use a promise-based approach to fetch the image and process it
        const result = await new Promise((resolve, reject) => {

            console.timeLog('resize', 'Requesting image');

            // dynmically set the preferred client based on the "protocol" part of imageUrl (default to https)
            const client = new URL(imageUrl).protocol === 'http:' ? http : https;
            const sourceHost = new URL(imageUrl).hostname;
            const options = {
                headers: {
                    'User-Agent': `${appName}/${appVersion}`,
                    'VS-Auth': `${vsAuth}`
                },
                timeout: 5000 // 5 seconds timeout
            };

            // uncomment the line below for DNS debugging
            //require('dns').lookup(sourceHost, (err, address, family) => { vs.log(`Resolved ${sourceHost} to ${address} on IPv${family}`); });

            client.get(imageUrl, options, (response) => {
                let chunks = [];
                let originalSizeBytes = 0;

                // Check the content-type and status code early
                const contentType = response.headers['content-type'] || '';

                // Ignore /favicon.ico requests
                if (imagePath === '/favicon.ico') {
                    reject({message: `Rejected request for: ${imageUrl}`, status: 204});
                    return;
                }

                if (response.statusCode !== 200) {
                    const status = response.statusCode;
                    reject({message: `Remote server returned status ${status} for ${imageUrl}`, status});
                    return;
                }
                
                if (!contentType.startsWith('image/')) {
                    const status = response.statusCode;
                    reject({message: `Remote server returned status ${status} for ${imageUrl} but the content-type: ${contentType} was invalid`, status});
                    return;
                }

                vs.log(`Processing request for ${imageUrl} for resize to ${sizeKey}`);

                // Collect data chunks
                response.on('data', (chunk) => {
                    originalSizeBytes += chunk.length; // Track the size of the original image
                    if (originalSizeBytes > maximumSizeMB * 1024 * 1024) { // 10 MB limit
                        vs.log(`Image too large: ${originalSizeBytes} bytes`);
                        reject({message: `Image too large: ${originalSizeBytes} bytes`, status: 413});
                        return;
                    }
                    chunks.push(chunk);
                });

                // Handle the end of the response
                response.on('end', async () => {

                    console.timeLog('resize', 'Image loaded');

                    try {
                        const buffer = Buffer.concat(chunks); // Combine the chunks into a buffer
                        const image = sharp(buffer); // Pass the buffer to Sharp
                        const metadata = await image.metadata();

                        vs.log(`Fetched ${imageUrl} - status ${response.statusCode}, content-type ${contentType}`);
                        //vs.log(`Image metadata: ${JSON.stringify(metadata)}`);
                        vs.log(`Original size: ${metadata.width}x${metadata.height}, bytes: ${originalSizeBytes} `);

                        const currentRatio = metadata.width / metadata.height;
                        const targetRatio = 3 / 2;
                        const ratioDifference = Math.abs(currentRatio - targetRatio);

                        let cropOptions = {};

                        // gp: check this logic, doesn't this else ALWAYS apply the else, even if the ratio is bang on?
                        if (ratioDifference > 0.01) {
                            vs.log(`Ratio difference > 0.01 at ${ratioDifference} - cropping required`);
                            if (currentRatio > targetRatio) {
                                vs.log(`Source image ratio ${currentRatio} is greater than target image ratio ${targetRatio} so image is too wide - cropping`);
                                const newWidth = Math.round(metadata.height * targetRatio);
                                const xOffset = Math.floor((metadata.width - newWidth) / 2);
                                cropOptions = { left: xOffset, top: 0, width: newWidth, height: metadata.height };
                            } else {
                                vs.log(`Source image ratio ${currentRatio} is less than target image ratio ${targetRatio} so image is too tall - cropping`);
                                const newHeight = Math.round(metadata.width / targetRatio);
                                const yOffset = Math.floor((metadata.height - newHeight) / 2);
                                cropOptions = { left: 0, top: yOffset, width: metadata.width, height: newHeight };
                            }
                        } else {
                            vs.log(`Ratio difference negligible at ${ratioDifference} no cropping required`);
                        }

                        let pipeline = image;

                        if (Object.keys(cropOptions).length) {
                            pipeline = pipeline.extract(cropOptions);
                        }

                        let body = '';
                        let contentTypeResponse = '';

                        if (sizeKey === 'xxs' && svgMethodValue === 'css') {
                            // For 'xxs' size: Output as a low quality JPG, then embed in SVG. Allow CSS to perform the blur. Mimics the Java ISS functionality.
                            vs.log(`Sharp will not perform the blur operation because svgMethod=${svgMethod}`);
                            const outputBuffer = await pipeline
                                .resize({ width })
                                .jpeg({ quality: 50, compressionLevel: 10, adaptiveFiltering: true, force: true }) // Compress original more aggressively
                                .toBuffer();

                            // Log the conversion stats
                            const outputMetadata = await sharp(outputBuffer).metadata();
                            logConversionStats(originalSizeBytes, outputBuffer, outputMetadata, `${imageUrl}`);

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
                        } else if (sizeKey === 'xxs' && svgMethodValue !== 'css') {
                            // For 'xxs' size: Apply blur and output as JPG (not SVG)
                            vs.log(`Sharp will perform the blur operation because svgMethod=${svgMethod}`);
                            const outputBuffer = await pipeline
                                .resize({ width })
                                .blur(25) // Apply blur
                                .jpeg({ quality: 50, compressionLevel: 10, adaptiveFiltering: true, force: true }) // Compress original more aggressively
                                .toBuffer();

                            // Log the conversion stats
                            const outputMetadata = await sharp(outputBuffer).metadata();
                            logConversionStats(originalSizeBytes, outputBuffer, outputMetadata`, ${imageUrl}`);

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
                                .webp({ quality: qualityValue })
                                .toBuffer();

                            // Log the conversion stats
                            const outputMetadata = await sharp(outputBuffer).metadata();
                            logConversionStats(originalSizeBytes, outputBuffer, outputMetadata, `${imageUrl}`);

                            // Convert outputBuffer to base64
                            const base64Image = outputBuffer.toString('base64');

                            // Send Base64 encoded output to API Gateway / Send Output Buffer to Express
                            body = outputBuffer;
                            contentTypeResponse = 'image/webp';
                        }
                        console.timeLog('resize', 'Image resized');

                        resolve({ body, contentTypeResponse });
                    } catch (err) {
                        vs.err('Error during image processing:', err.message);
                        reject('Image could not be processed.');
                    }
                });
            }).on('error', (err) => {
                vs.err('Image fetch error:', err.message);
                reject('Image could not be fetched.');
            });
        });

        console.timeEnd('resize', 'Image processing complete');

        // Return the processed image as the Express response
        vs.log(`Serving ${imageUrl}?size=${sizeKey}`);
        res.set('Content-Type', result.contentTypeResponse);
        res.send(result.body);
        const elapsedTime = Date.now() - startTime;
        vs.log(` - done - (${elapsedTime}ms)`);
    } catch (err) {
        vs.err('Image processing error:', err.message);
        res.status(err.status || 500).send(err.message || 'Internal Server Error');
    } //end try-catch
}); // end main method

app.listen(LISTEN_PORT, LISTEN_ADDR, () => {
    vs.log(`Server running at http://${LISTEN_ADDR}:${LISTEN_PORT}/ - scaling images from ${baseURL}`);
});