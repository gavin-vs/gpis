#!/bin/bash

# Create a clean directory
rm -rf image-resizer-lambda
mkdir image-resizer-lambda

# Copy the app-lambda.js into the directory
cp app-lambda.js image-resizer-lambda/

# Create a package.json in the directory
cat <<EOL > image-resizer-lambda/package.json
{
  "name": "app",
  "version": "1.0.0",
  "main": "app.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "sharp": "^0.34.1"
  },
  "description": ""
}
EOL

# Navigate to the folder
cd image-resizer-lambda
echo in $(pwd)
ls -alh

# Install dependencies with the necessary flags for AWS compatibility
echo about to run npm install
npm install
echo about to run npm install --os=linux --cpu=x64 sharp
npm install --os=linux --cpu=x64 sharp
echo about to run npm install --include=optional sharp
npm install --include=optional sharp

# Create the ZIP file
/c/Program\ Files/7-Zip/7z.exe a -r ../image-resizer-lambda.zip *

# Go back to the root directory
cd ..

echo "Lambda package prepared: image-resizer-lambda.zip"
