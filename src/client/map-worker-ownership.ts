// Private to this bundled engine: an arbitrary Blob URL is not an owned worker.
let ownedUrl: string | undefined

export function setOwnedMapWorkerUrl(url: string | undefined): void { ownedUrl = url }
export function isOwnedMapWorkerUrl(url: string): boolean { return ownedUrl !== undefined && url === ownedUrl }
