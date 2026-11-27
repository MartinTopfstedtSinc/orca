import * as z from 'zod'
import { lazyZodSchema } from '../../schema/lazy-zod-schema'

export const AzureDevOpsTaskProviderIdentityParam = lazyZodSchema(() =>
  z
    .object({
      provider: z.literal('azure-devops'),
      organization: z.string().nullable().optional(),
      project: z.string().nullable().optional(),
      teamId: z.string().nullable().optional(),
      teamName: z.string().nullable().optional()
    })
    .passthrough()
)
