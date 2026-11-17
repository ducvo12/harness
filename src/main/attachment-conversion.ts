import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { attachmentSourceLimit, type ConvertedAttachment } from '../shared/attachment-conversion'
import { attachmentTextLimit } from '../shared/chat-limits'
import { imageDataLimit } from '../shared/message-images'

const execute = promisify(execFile)
const jpegPrefix = 'data:image/jpeg;base64,'
const pdfTextLimitError = `The PDF text exceeds ${attachmentTextLimit / 1000} KB. Attach a shorter excerpt.`
const pdfTextScript = `
ObjC.import('PDFKit')

function run(args) {
  const pdf = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(args[0]))
  if (pdf.isNil()) return JSON.stringify({ error: 'Could not open this PDF.' })
  if (pdf.isLocked) return JSON.stringify({ error: 'Unlock this PDF before attaching it.' })

  const limit = Number(args[1])
  let content = ''
  for (let index = 0; index < pdf.pageCount; index++) {
    const page = (ObjC.unwrap(pdf.pageAtIndex(index).string) || '').trim()
    if (!page) continue

    if (content) content += '\\n\\n'
    content += page
    if (content.length > limit) return JSON.stringify({ error: args[2] })
  }

  return JSON.stringify({ content })
}
`

async function readPdf(path: string): Promise<ConvertedAttachment> {
  let stdout: string
  try {
    const result = await execute('/usr/bin/osascript', [
      '-l', 'JavaScript', '-e', pdfTextScript, path, String(attachmentTextLimit), pdfTextLimitError
    ], { timeout: 15_000, maxBuffer: attachmentTextLimit * 6 + 1024 })
    stdout = result.stdout
  } catch {
    throw new Error('Could not read this PDF.')
  }

  const { content, error } = JSON.parse(stdout) as { content?: string; error?: string }
  if (error) throw new Error(error)
  if (!content) throw new Error('This PDF has no extractable text. Attach an image of the page instead.')
  if (Buffer.byteLength(content) > attachmentTextLimit) throw new Error(pdfTextLimitError)

  return { content }
}

async function convertHeic(input: string, output: string): Promise<ConvertedAttachment> {
  try {
    const options = { timeout: 15_000, maxBuffer: 16_384 }
    const { stdout } = await execute('/usr/bin/sips', ['-g', 'format', '-g', 'pixelWidth', '-g', 'pixelHeight', input], options)
    if (!/^\s*format: hei[cf]\s*$/m.test(stdout)) throw new Error('Unexpected image format')

    const dimensions = [...stdout.matchAll(/^\s*pixel(?:Width|Height): (\d+)\s*$/gm)].map(match => Number(match[1]))
    if (dimensions.length !== 2) throw new Error('Could not read image dimensions')
    const resize = Math.max(...dimensions) > 1600 ? ['-Z', '1600'] : []
    await execute('/usr/bin/sips', [...resize, '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', input, '--out', output], options)
  } catch {
    throw new Error('Could not convert this HEIC image.')
  }

  const { size } = await stat(output)
  if (Math.ceil(size / 3) * 4 + jpegPrefix.length > imageDataLimit) {
    throw new Error('The converted image is too large. Try a smaller image.')
  }
  return { dataUrl: jpegPrefix + (await readFile(output)).toString('base64') }
}

export async function convertAttachment(format: unknown, bytes: unknown): Promise<ConvertedAttachment> {
  if (format !== 'pdf' && format !== 'heic') throw new Error('Unsupported attachment format.')
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > attachmentSourceLimit) {
    throw new Error('Choose a PDF or HEIC file up to 20 MiB.')
  }
  if (process.platform !== 'darwin') throw new Error('PDF and HEIC conversion is available on macOS.')
  if (format === 'pdf' && !Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-')) {
    throw new Error('Could not open this PDF.')
  }

  const directory = await mkdtemp(join(tmpdir(), 'granite-attachment-'))
  try {
    const input = join(directory, `input.${format}`)
    await writeFile(input, bytes)
    return await (format === 'pdf' ? readPdf(input) : convertHeic(input, join(directory, 'output.jpg')))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
