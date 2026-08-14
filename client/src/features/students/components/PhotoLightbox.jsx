import { Camera, Trash2, X } from "lucide-react";

export function PhotoLightbox({
  photoUrl,
  fullName,
  canManage,
  onClose,
  onRequestReplace,
  onRemove,
  isReplacing,
  isRemoving,
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#24171899] px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={fullName}
    >
      <div className="relative w-full max-w-sm">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-11 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X size={18} />
        </button>

        <div className="group relative mx-auto aspect-square w-full overflow-hidden rounded-full border-4 border-white shadow-2xl">
          <img
            src={photoUrl}
            alt={fullName}
            className="h-full w-full object-cover"
          />

          {canManage ? (
            <button
              type="button"
              onClick={onRequestReplace}
              disabled={isReplacing}
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/0 text-transparent transition group-hover:bg-black/55 group-hover:text-white focus-visible:bg-black/55 focus-visible:text-white disabled:cursor-wait"
            >
              <Camera size={22} />
              <span className="text-xs font-semibold">
                {isReplacing ? "Uploading..." : "Change Photo"}
              </span>
            </button>
          ) : null}
        </div>

        {canManage ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={onRemove}
              disabled={isRemoving}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-60"
            >
              <Trash2 size={14} />
              Remove photo
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
