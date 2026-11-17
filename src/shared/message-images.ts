export interface MessageImage {
  name: string
  dataUrl: string
}

export const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const imageDataLimit = 2 * 1024 * 1024

export function validMessageImages(value: unknown): value is MessageImage[] | undefined {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.length > 5) return false

  let length = 0
  for (const image of value) {
    if (!image || typeof image.name !== 'string' || !image.name || image.name.length > 255 || typeof image.dataUrl !== 'string') return false
    length += image.dataUrl.length
    if (length > imageDataLimit || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)) return false
  }
  return true
}
