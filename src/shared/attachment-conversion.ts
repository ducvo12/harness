export type AttachmentFormat = 'pdf' | 'heic'

export type ConvertedAttachment = { content: string } | { dataUrl: string }

export const attachmentSourceLimit = 20 * 1024 * 1024
