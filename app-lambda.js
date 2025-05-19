// Image-Scaler - Lambda handler - no separate web server required
const https = require('https');
const http = require('http');
const sharp = require('sharp');
const { URL } = require('url');

// Enable with: VS_LOGGING=true node app.js
const vsLogging = process.env.VS_LOGGING === 'true';

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

// main method, uses "exports.handler" for Lambda requests and "app.get" for Express requests
// Lambda handler would normally use "event" but we're using "req" to align with non-Lambda version
exports.handler = (async (req) => {
    vs.log('Starting timer');
    console.time('resize');

    const imagePath = req.rawPath || req.path || '';
    const sizeKey = req.queryStringParameters?.size;
    const qualityValue = req.queryStringParameters?.quality ? parseInt(req.queryStringParameters?.quality) : quality;
    const svgMethodValue = req.queryStringParameters?.svgMethod || svgMethod;
    const sizeKey = req.queryStringParameters?.size;
    const width = sizeMap[sizeKey] || sizeMap['md']; // fallback to 'md' if invalid

    const imageUrl = `${baseURL}${imagePath}`;

    vs.log(`Processing request for ${imageUrl} for resize to ${sizeKey}`);

    // Ignore /favicon.ico requests
    if (imagePath === '/favicon.ico') {
        vs.log(`Rejected request for: ${imageUrl}`);
        return { statusCode: 204, body: '', };
    }

    try {
        // Use a promise-based approach to fetch the image and process it
        const result = await new Promise((resolve, reject) => {

            vs.log(`Accepted request for ${imageUrl} for resize to ${sizeKey}`);
            console.timeLog('resize', 'Requesting image');

            // dynmically set the preferred client based on the "protocol" part of imageUrl (default to https)
            const client = new URL(imageUrl).protocol === 'http:' ? http : https;
            const sourceHost = new URL(imageUrl).hostname;

            // uncomment the line below for DNS debugging
            require('dns').lookup(sourceHost, (err, address, family) => { vs.log(`Resolved ${sourceHost} to ${address} on IPv${family}`); });

            client.get(imageUrl, (response) => {
                let chunks = [];

                // Check the content-type and status code early
                const contentType = response.headers['content-type'] || '';

                if (!contentType.startsWith('image/')) {
                    vs.log(`Invalid content-type: ${contentType}`);
                    reject('URL did not return an image.');
                    return;
                }

                // Collect data chunks
                response.on('data', (chunk) => {
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
                            isBase64Encoded = false; // this is key for proper a response in Lambda
                        } else if (sizeKey === 'xxs' && svgMethodValue !== 'css') {
                            // For 'xxs' size: Apply blur and output as JPG (not SVG)
                            vs.log(`Sharp will perform the blur operation because svgMethod=${svgMethod}`);
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
                            isBase64Encoded = false; // this is key for proper a response in Lambda
                        } else {
                            // For other sizes: Resize to target width and send as WebP
                            const outputBuffer = await pipeline
                                .resize({ width })
                                .webp({ quality: qualityValue })
                                .toBuffer();

                            // Convert outputBuffer to base64
                            const base64Image = outputBuffer.toString('base64');

                            // Send Base64 encoded output to API Gateway / Send Output Buffer to Express
                            body = base64Image;
                            contentTypeResponse = 'image/webp';
                            isBase64Encoded = true; // this is key for proper a response in Lambda
                        }
                        console.timeLog('resize', 'Image resized');

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

        console.timeEnd('resize', 'Image processing complete');

        // Return the processed image as an API Gateway (Lambda) compatible response
        vs.log(`Serving the processed response`);
        return { statusCode: 200, headers: { 'Content-Type': result.contentTypeResponse }, body: result.body, isBase64Encoded, };
    } catch (err) {
        console.error('Image processing error:', err.message);
        return { statusCode: 500, body: 'Image could not be processed.' };
    } //end try-catch
}); // end main method
