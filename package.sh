#!/bin/bash

# Create a clean directory
rm -rf image-resizer
mkdir image-resizer

# Copy the app-lambda.js into the directory
cp app.js image-resizer
# Create a package.json in the directory
cat <<EOL > image-resizer/package.json
{
  "name": "app",
  "version": "1.0.0",
  "main": "app.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1",
    "start": "node app.js"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "axios": "^1.8.4",
    "express": "^4.21.2",
    "sharp": "^0.34.1"
  },
  "description": ""
}
EOL

# Navigate to the folder
cd image-resizer

# Install dependencies with the necessary flags for AWS compatibility
npm install
echo installing Linux dependencies
npm install --os=linux --cpu=x64 sharp
echo installing Optional dependencies
npm install --include=optional sharp

# Create the ZIP file
/c/Program\ Files/7-Zip/7z.exe a -r ../image-resizer.zip *

# Create the Tarball
tar -czvf ../image-resizer.tar.gz *

# Go back to the root directory
cd ..

echo "Packages prepared: image-resizer.zip image-resizer.tar.gz"
