#!/bin/bash

START_DIR=$(pwd)

# Specify output directory
TARGET_BASE_DIR="target"
TARGET_APP_NAME="image-resizer"
TARGET_DIR="$TARGET_BASE_DIR/$TARGET_APP_NAME"

echo "Starting from $START_DIR, creating $TARGET_APP_NAME in $TARGET_DIR"

# Create a clean directory
rm -rf $TARGET_DIR
rm -f $TARGET_DIR.zip
rm -f $TARGET_DIR.tar.gz
mkdir -p $TARGET_DIR

# Copy the app-lambda.js into the directory
cp app.js $TARGET_DIR/

# Create a package.json in the directory
cat <<EOL > $TARGET_DIR/package.json
{
  "name": "image-scaler-node",
  "version": "0.0.1",
  "main": "app.js",
  "scripts": {
    "start": "node app.js"
  },
  "license": "MIT",
  "dependencies": {
    "express": "^5.1.0",
    "sharp": "^0.34.1"
  }
}
EOL

# Navigate to the folder
cd $TARGET_DIR
echo in $(pwd)

# Install dependencies with the necessary flags for AWS compatibility
echo installing Linux dependencies
echo  - about to run npm install
npm install
echo  - about to run npm install --os=linux --cpu=x64 sharp
npm install --os=linux --cpu=x64 sharp
echo  - about to run npm install --include=optional sharp
npm install --include=optional sharp

# Create the ZIP file
if [ -f /c/Program\ Files/7-Zip/7z.exe ]; then
    echo "7-Zip found, creating ZIP file"
    /c/Program\ Files/7-Zip/7z.exe a -r $START_DIR/$TARGET_DIR.zip *
else
    echo "7-Zip not found, please install it to create the ZIP file"
fi

# Create the Tarball
if [ -f $(which tar) ]; then
    echo "Tar found, creating Tarball"
    tar -czvf $START_DIR/$TARGET_DIR.tar.gz *
else
    echo "Tar not found, please install it to create the Tarball"
fi

# Go back to the start directory
cd $START_DIR

if [ -f $START_DIR/$TARGET_DIR.zip ]; then echo "Node package prepared: $TARGET_DIR.zip"; fi
if [ -f $START_DIR/$TARGET_DIR.tar.gz ]; then echo "Node package prepared: $TARGET_DIR.tar.gz"; fi