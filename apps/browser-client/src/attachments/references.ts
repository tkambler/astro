const sourcePattern = /^attachment:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

export function embeddedImageSource(id: string) { return `attachment:${id}` }
export function embeddedImageId(source: string) { return source.match(sourcePattern)?.[1]?.toLowerCase() ?? null }
