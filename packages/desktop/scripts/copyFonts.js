const fs = require('fs')
const path = require('path')

// Copy Roboto fonts to dist
const srcDir = path.resolve('node_modules', 'typeface-roboto')
const destDir = path.resolve('dist', 'main', 'fonts')

try {
  // Ensure output directory exists
  fs.mkdirSync(destDir, { recursive: true })

  // Copy font files
  const files = fs.readdirSync(path.join(srcDir, 'files'))
  for (const file of files) {
    if (file.endsWith('.woff') || file.endsWith('.woff2')) {
      const srcPath = path.join(srcDir, 'files', file)
      const destPath = path.join(destDir, file)
      fs.copyFileSync(srcPath, destPath)
      console.log(`Copied font: ${file}`)
    }
  }

  console.log('Fonts copied successfully')
} catch (err) {
  console.error('Failed to copy fonts:', err.message)
  process.exitCode = 1
}
