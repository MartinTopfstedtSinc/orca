// Why: imported first by the web entry, so every module that touches localStorage while
// loading already sees the namespace the page names.
import { installWebStorageNamespace } from './web-storage-namespace'

installWebStorageNamespace()
