import { useEffect, useState } from "react";
import Cropper from "react-easy-crop";
import { Button } from "../ui/Button.jsx";
import { CrudDialog } from "../ui/CrudDialog.jsx";
import { getCroppedImageBlob } from "../../lib/cropImage.js";

export function PhotoCropDialog({ file, onCancel, onCropped, isSaving }) {
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

  useEffect(() => {
    if (!file) return;

    let isMounted = true;
    const objectUrl = URL.createObjectURL(file);

    Promise.resolve().then(() => {
      if (isMounted) setImageSrc(objectUrl);
    });

    return () => {
      isMounted = false;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  async function handleConfirm() {
    if (!croppedAreaPixels || !imageSrc) return;
    const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels);
    onCropped(blob);
  }

  return (
    <CrudDialog
      isOpen={true}
      title="Crop photo"
      description="Drag to reposition, scroll or pinch to zoom."
      onClose={onCancel}
      panelClassName="max-w-lg"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isSaving || !croppedAreaPixels}
          >
            {isSaving ? "Uploading..." : "Save photo"}
          </Button>
        </>
      }
    >
      <div className="relative h-80 w-full overflow-hidden rounded-xl bg-[var(--mws-burgundy-dark)]">
        {imageSrc && (
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
          />
        )}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="text-xs text-[var(--mws-muted)]">Zoom</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="w-full accent-[var(--mws-burgundy)]"
        />
      </div>
    </CrudDialog>
  );
}
