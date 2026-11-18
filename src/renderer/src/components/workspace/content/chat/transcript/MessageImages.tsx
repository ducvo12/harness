import type { MessageImage } from '../../../../../../../shared/message-images'

export default function MessageImages({ images }: { images?: MessageImage[] }) {
  if (!images?.length) return null

  return (
    <div className="chat-message-images">
      {images.map((image, index) => (
        <img key={index} className="chat-message-image" src={image.dataUrl} alt={image.name} />
      ))}
    </div>
  )
}
