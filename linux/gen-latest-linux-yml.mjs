#!/usr/bin/env node
/**
 * Write the electron-updater feed file for a Linux AppImage release.
 *
 * electron-updater on Linux reads `latest-linux.yml` next to the artifacts. The upstream packaging
 * scripts publish their own COS feed, so this fork generates the GitHub-Releases feed itself.
 *
 * Usage: node linux/gen-latest-linux-yml.mjs <artifacts-dir> <version> <appimage-filename>
 */
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const [, , dir, version, appimageName] = process.argv
if (!dir || !version) {
  console.error('usage: gen-latest-linux-yml.mjs <artifacts-dir> <version> [appimage-filename]')
  process.exit(2)
}

const name = appimageName
  ?? readdirSync(dir).find(file => file.endsWith('.AppImage'))
if (!name) {
  console.error(`no .AppImage found in ${dir}`)
  process.exit(1)
}

const path = join(dir, name)
const bytes = readFileSync(path)
const sha512 = createHash('sha512').update(bytes).digest('base64')
const size = statSync(path).size
const releaseDate = new Date().toISOString()

const yml = [
  `version: ${version}`,
  'files:',
  `  - url: ${name}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${name}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  '',
].join('\n')

writeFileSync(join(dir, 'latest-linux.yml'), yml)
console.log(`wrote ${join(dir, 'latest-linux.yml')} for ${name} (${size} bytes)`)
