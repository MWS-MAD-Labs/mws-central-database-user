import { useState } from 'react'
import { cn } from '../../lib/cn.js'

// The photo of the signed-in person, or their initials when there is none or the link no longer works.
export function UserAvatar({ src, initials, className }) {
  const [failedSrc, setFailedSrc] = useState(null)
  const showPhoto = Boolean(src) && failedSrc !== src

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#fff4d8] font-display font-bold text-[#8a6419]',
        className,
      )}
    >
      {showPhoto ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        initials
      )}
    </div>
  )
}
