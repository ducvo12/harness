import { imageDataLimit, imageTypes, type MessageImage } from '../../../../shared/message-images.ts'
import { attachmentSourceLimit, type AttachmentFormat } from '../../../../shared/attachment-conversion.ts'
import { attachmentTextLimit, messageTextLimit } from '../../../../shared/chat-limits.ts'

export interface ChatAttachment {
  id: string
  name: string
  size: number
  content: string
  dataUrl?: string
}

const textLimitError = `Attached text must total ${attachmentTextLimit / 1000} KB or less.`

const directAttachmentFormats = [
  ...imageTypes, 'text/*', 'application/json', 'application/xml', 'application/yaml',
  '.md', '.mdx', '.txt', '.csv', '.tsv', '.log', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.ini',
  '.html', '.css', '.scss', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs',
  '.sh', '.zsh', '.bash', '.sql', '.env', '.gitignore', '.dockerfile', '.makefile'
]

export function attachmentAccept(platform: string) {
  const nativeFormats = platform === 'darwin' ? ['application/pdf', '.pdf', 'image/heic', 'image/heif', '.heic', '.heif'] : []
  return [...directAttachmentFormats, ...nativeFormats].join(',')
}

function conversionFormat(file: File): AttachmentFormat | undefined {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  if (['image/heic', 'image/heif'].includes(file.type) || /\.hei[cf]$/i.test(file.name)) return 'heic'
}

const unsupportedExtension = /\.(?:zip|7z|rar|tar|tgz|gz|bz2|xz|dmg|iso|img)$/i
const unsupportedTypes = new Set([
  'application/zip', 'application/x-zip-compressed', 'application/x-7z-compressed',
  'application/vnd.rar', 'application/x-rar-compressed', 'application/x-tar',
  'application/gzip', 'application/x-bzip2', 'application/x-xz',
  'application/x-apple-diskimage', 'application/x-iso9660-image'
])

export async function readAttachments(files: File[], existing: ChatAttachment[]): Promise<ChatAttachment[]> {
  if (files.length + existing.length > 5) throw new Error('Attach up to 5 files per message.')

  const unsupported = files.find(file => unsupportedExtension.test(file.name) || unsupportedTypes.has(file.type))
  if (unsupported) {
    throw new Error(`${unsupported.name}: archives and disk images can’t be attached. Choose an image or a text or code file.`)
  }

  const encoder = new TextEncoder()
  const textSize = existing.reduce((size, file) => size + (file.dataUrl ? 0 : encoder.encode(file.content).length), 0)
  const incoming = files.map(file => ({ file, format: conversionFormat(file) }))
  const direct = incoming.filter(({ format }) => !format).map(({ file }) => file)
  const incomingTextSize = direct.reduce((size, file) => size + (file.type.startsWith('image/') ? 0 : file.size), 0)
  if (textSize + incomingTextSize > attachmentTextLimit) {
    throw new Error(textLimitError)
  }
  const imageSize = existing.reduce((size, file) => size + (file.dataUrl?.length ?? 0), 0)
  const incomingImageSize = direct.filter(file => file.type.startsWith('image/'))
    .reduce((size, file) => size + Math.ceil(file.size / 3) * 4 + `data:${file.type};base64,`.length, 0)
  if (imageSize + incomingImageSize > imageDataLimit) {
    throw new Error('The attached images are too large. Try a smaller image.')
  }
  const added = await Promise.all(incoming.map(async ({ file, format }): Promise<ChatAttachment> => {
    const id = crypto.randomUUID()
    const name = file.name || 'Pasted image'
    if (format) {
      if (file.size > attachmentSourceLimit) throw new Error(`${name}: choose a file up to 20 MiB.`)
      const result = await window.granite.attachments.convert(format, new Uint8Array(await file.arrayBuffer()))
      if (!result.ok) throw new Error(`${name}: ${result.error}`)
      if ('content' in result.value) return { id, name, size: file.size, content: result.value.content }
      return { id, name, size: file.size, content: '', dataUrl: result.value.dataUrl }
    }

    if (file.type.startsWith('image/')) {
      if (!imageTypes.includes(file.type)) throw new Error(`${name}: choose a PNG, JPEG, WebP, or GIF image.`)
      if (!file.size) throw new Error(`${name}: the image is empty.`)
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error(`Could not read ${name}.`))
        reader.readAsDataURL(file)
      })

      const image = new Image()
      image.src = dataUrl
      try {
        await image.decode()
      } catch {
        throw new Error(`${name}: could not read this image. Choose a valid PNG, JPEG, WebP, or GIF file.`)
      }

      return { id, name, size: file.size, content: '', dataUrl }
    }

    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (/[\u0000-\u0008\u000e-\u001f]/.test(content)) throw new Error('Binary file')
    } catch { throw new Error(`${file.name}: choose a UTF-8 text or code file.`) }
    return { id, name, size: file.size, content }
  }))

  if (textSize + added.reduce((size, file) => size + encoder.encode(file.content).length, 0) > attachmentTextLimit) {
    throw new Error(textLimitError)
  }
  if (imageSize + added.reduce((size, file) => size + (file.dataUrl?.length ?? 0), 0) > imageDataLimit) {
    throw new Error('The attached images are too large. Try a smaller image.')
  }
  return [...existing, ...added]
}

export function messageWithAttachments(draft: string, attachments: ChatAttachment[]): string {
  const text = [draft.trim(), ...attachments.filter(file => !file.dataUrl).map(file => {
    const longest = Math.max(2, ...(file.content.match(/`+/g) ?? []).map(run => run.length))
    const fence = '`'.repeat(longest + 1)
    return `### Attached file: ${JSON.stringify(file.name)} (${file.size} bytes)\n${fence}text\n${file.content}\n${fence}`
  })].filter(Boolean).join('\n\n')
  if (text.length > messageTextLimit) throw new Error('The message and attached files are too long. Shorten the message or remove a file.')
  return text
}

export function imagesFromAttachments(attachments: ChatAttachment[]): MessageImage[] | undefined {
  const images = attachments.flatMap(file => file.dataUrl ? [{ name: file.name, dataUrl: file.dataUrl }] : [])
  return images.length ? images : undefined
}

export function sentAttachments(content: string): { name: string; size: number; content: string }[] {
  const pattern = /^### Attached file: ("(?:[^"\\]|\\.)*") \((\d+) bytes\)\n(`{3,})text\n([\s\S]*?)\n\3(?=\n|$)/gm
  return [...content.matchAll(pattern)].flatMap(match => {
    try { return [{ name: JSON.parse(match[1]) as string, size: Number(match[2]), content: match[4] }] }
    catch { return [] }
  })
}
