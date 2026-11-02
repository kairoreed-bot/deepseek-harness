/**
 * Linux packaging settings.
 *
 * LINUX-PATCH: new file, so the linux target never has to route through the macOS or Windows
 * settings modules. Values mirror the Windows defaults because electron-builder's pack concurrency
 * and compression knobs behave the same way on a Linux host.
 */

/**
 * Read Linux pack concurrency and electron-builder compression level.
 * @param {NodeJS.ProcessEnv} environment Packaging environment.
 * @returns {{ packConcurrency: number, compressionLevel: number }} Linux packaging settings.
 */
export function resolveLinuxPackageSettings(environment = process.env) {
  const pack = environment.DSH_DESKTOP_LINUX_PACK_CONCURRENCY ?? '4'
  if (!/^[1-9]\d*$/u.test(pack) || !Number.isSafeInteger(Number(pack))) {
    throw new Error('desktop package: DSH_DESKTOP_LINUX_PACK_CONCURRENCY must be a positive integer')
  }
  const compression = environment.DSH_DESKTOP_LINUX_COMPRESSION_LEVEL ?? environment.ELECTRON_BUILDER_COMPRESSION_LEVEL ?? '9'
  if (!/^[0-9]$/u.test(compression)) {
    throw new Error('desktop package: DSH_DESKTOP_LINUX_COMPRESSION_LEVEL must be an integer from 0 to 9')
  }
  return { packConcurrency: Number(pack), compressionLevel: Number(compression) }
}
