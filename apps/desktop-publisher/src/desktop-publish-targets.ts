/** Approved packaging workflows and machine publication targets. */
import { z } from 'zod'

/** Each target is produced by its own manually dispatched workflow. */
export const desktopPackageWorkflows = {
  'mac-arm64': '.github/workflows/macos-package.yml',
  'mac-x64': '.github/workflows/macos-intel-package.yml',
  'win-x64': '.github/workflows/windows-package.yml',
} as const

// linux-x64 is produced by this fork's .github/workflows/linux-sync-build.yml, which packages and
// publishes in one run instead of staging for the mac/win retention + publish-route pair. It is a
// valid publish target (so a runner route may name it) but deliberately absent from
// desktopPackageWorkflows, which drives the workflow_dispatch-only publish resolver.
const targetSchema = z.enum(['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64'])

/** Machine labels are unique; a scalar target is shorthand for a one-element target list. */
export const desktopPublishRunnersSchema = z.record(z.string(), z.object({
  label: z.string().regex(/^dsh-[a-z0-9-]+$/u),
  target: z.union([targetSchema, z.array(targetSchema).min(1)])
    .transform(value => typeof value === 'string' ? [value] : value),
}))
