import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { cn } from "../../../lib/cn.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { PanelFrame } from "../../master-data/components/PanelFrame.jsx";
import { applicationLogosApi } from "../api/applicationLogosApi.js";
import { checkLogoFile, LOGO_ACCEPT, LOGO_HINT } from "../utils/imageSniff.js";
import { LOGOS_KEY, useApplicationLogos } from "../hooks/useApplicationLogos.js";
import { clamp, isUntouched, placement, renderLogoPng, ZOOM_MAX, ZOOM_MIN } from "../utils/logoCrop.js";
import { LogoImage } from "./LogoImage.jsx";

const STAGE_SIZE = 128;

// How the picture will sit in the saved logo: a square, drag to move the picture, zoom below.
function LogoStage({ address, view, onMove }) {
  const drag = useRef(null);
  // Natural size of the picture, so the preview lands where the saved PNG will.
  const [natural, setNatural] = useState({ width: 1, height: 1 });
  const box = placement({ ...natural, ...view, size: 100 });

  function down(event) {
    if (!address) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, view };
  }
  function move(event) {
    if (!drag.current) return;
    const { x, y, view: start } = drag.current;
    onMove({
      offsetX: clamp(start.offsetX + (event.clientX - x) / STAGE_SIZE, -1, 1),
      offsetY: clamp(start.offsetY + (event.clientY - y) / STAGE_SIZE, -1, 1),
    });
  }

  return (
    <div
      className={cn(
        "relative flex touch-none items-center justify-center overflow-hidden rounded-xl border border-(--mws-line) bg-[conic-gradient(#f3efef_25%,#fff_0_50%,#f3efef_0_75%,#fff_0)] bg-size-[16px_16px]",
        address ? "cursor-grab active:cursor-grabbing" : "",
      )}
      style={{ width: STAGE_SIZE, height: STAGE_SIZE }}
      aria-label="How the logo will look"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      {address ? (
        <img
          src={address}
          alt=""
          draggable={false}
          onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth || 1, height: event.currentTarget.naturalHeight || 1 })}
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}
        />
      ) : (
        <ImagePlus size={24} className="text-(--mws-muted)" aria-hidden="true" />
      )}
    </div>
  );
}

function ZoomControl({ zoom, disabled, onChange }) {
  const step = (delta) => onChange(clamp(Math.round((zoom + delta) * 100) / 100, ZOOM_MIN, ZOOM_MAX));
  const round = "inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border border-(--mws-line) bg-white text-(--mws-muted) transition-colors hover:bg-(--mws-soft) disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className="flex items-center gap-1.5" style={{ width: STAGE_SIZE + 64 }}>
      <button type="button" aria-label="Zoom out" disabled={disabled} onClick={() => step(-0.1)} className={round}><Minus size={14} /></button>
      <input
        type="range"
        aria-label="Zoom"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={0.05}
        value={zoom}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 flex-1 accent-(--mws-burgundy)"
      />
      <button type="button" aria-label="Zoom in" disabled={disabled} onClick={() => step(0.1)} className={round}><Plus size={14} /></button>
    </div>
  );
}

function UploadDialog({ onClose }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [problem, setProblem] = useState("");
  const [view, setView] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  // The preview address is made when a file is picked and let go when it is replaced or the dialog closes.
  const [address, setAddress] = useState(null);
  const addressRef = useRef(null);
  useEffect(() => () => {
    if (addressRef.current) URL.revokeObjectURL(addressRef.current);
  }, []);

  function showPreview(picked, type) {
    if (addressRef.current) URL.revokeObjectURL(addressRef.current);
    // The type is what the file is, not what its name says, or the browser would not draw it.
    addressRef.current = picked ? URL.createObjectURL(new Blob([picked], { type })) : null;
    setAddress(addressRef.current);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      // Untouched keeps the original file. Otherwise the zoomed picture is saved as a PNG.
      const upload = isUntouched(view)
        ? file
        : await renderLogoPng({ src: addressRef.current, name: name.trim(), ...view });
      return applicationLogosApi.upload({ name: name.trim(), file: upload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOGOS_KEY });
      showSuccessToast("Logo added.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "The logo could not be added."),
  });

  async function choose(event) {
    const picked = event.target.files?.[0] ?? null;
    setFile(null);
    showPreview(null);
    setView({ zoom: 1, offsetX: 0, offsetY: 0 });
    if (!picked) {
      setProblem("");
      return;
    }
    const { type, problem: reason } = await checkLogoFile(picked);
    if (reason) {
      setProblem(reason);
      event.target.value = "";
      return;
    }
    setProblem("");
    setFile(picked);
    showPreview(picked, type);
    if (!name.trim()) setName(picked.name.replace(/\.[^.]+$/, "").slice(0, 64));
  }

  return (
    <CrudDialog
      title="Add Logo"
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <>
          <Button type="button" variant="ghost" className="h-8 rounded-lg text-xs" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            className="h-8 rounded-lg px-4 text-xs"
            disabled={!file || !name.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <Plus size={14} aria-hidden="true" />
            {mutation.isPending ? "Adding..." : "Add Logo"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <LogoStage address={address} view={view} onMove={(move) => setView((current) => ({ ...current, ...move }))} />
          <ZoomControl zoom={view.zoom} disabled={!address} onChange={(zoom) => setView((current) => ({ ...current, zoom }))} />
          {address && !isUntouched(view) ? (
            <button
              type="button"
              onClick={() => setView({ zoom: 1, offsetX: 0, offsetY: 0 })}
              className="cursor-pointer text-xs font-semibold text-(--mws-muted) hover:text-(--mws-burgundy)"
            >
              Reset
            </button>
          ) : null}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <Field label="Name" required counter={{ value: name, max: 64, count: (value) => value.length }}>
            <TextInput value={name} maxLength={64} onChange={(event) => setName(event.target.value)} placeholder="e.g. Millennia" />
          </Field>
          <Field label="Picture" required hint={LOGO_HINT} error={problem}>
            <input
              type="file"
              accept={LOGO_ACCEPT}
              aria-label="Picture"
              onChange={choose}
              className="block w-full text-sm text-(--mws-charcoal) file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-(--mws-line) file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold"
            />
          </Field>
        </div>
      </div>
    </CrudDialog>
  );
}

function LogoDialog({ logo, onClose, onDelete }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(logo.name);
  const mutation = useMutation({
    mutationFn: () => applicationLogosApi.rename(logo.id, name.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOGOS_KEY });
      showSuccessToast("Logo saved.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "The logo could not be saved."),
  });
  return (
    <CrudDialog
      title={logo.name}
      onClose={onClose}
      panelClassName="max-w-md"
      footer={
        <>
          <Button type="button" variant="danger" className="mr-auto" onClick={() => onDelete(logo)}>Delete</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!name.trim() || name.trim() === logo.name || mutation.isPending} onClick={() => mutation.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        <LogoImage id={logo.id} version={logo.version} alt={logo.name} size={96} className="bg-(--mws-soft)" />
        <div className="min-w-0 flex-1 space-y-3">
          <Field label="Name" required>
            <TextInput value={name} maxLength={64} onChange={(event) => setName(event.target.value)} />
          </Field>
          <p className="text-sm text-(--mws-muted)">
            {logo.used_by.length > 0 ? `Used by ${logo.used_by.map((item) => item.name).join(", ")}` : "Not used by any application"}
          </p>
        </div>
      </div>
    </CrudDialog>
  );
}

// The pictures an application can use on its Hub card, kept in the master data so a new one needs no code change.
export function ApplicationLogosPanel() {
  const { logos, isLoading } = useApplicationLogos();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState(null);

  const removal = useMutation({
    mutationFn: (id) => applicationLogosApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOGOS_KEY });
      showSuccessToast("Logo deleted.");
    },
    onError: (error) => showErrorToast(error, "The logo could not be deleted."),
  });

  async function remove(logo) {
    const confirmed = await confirm({
      title: "Delete Logo",
      description: `${logo.name} is deleted for good.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (confirmed) {
      setSelected(null);
      removal.mutate(logo.id);
    }
  }

  return (
    <PanelFrame
      title="Logos"
      icon={ImagePlus}
      action={
        <Button type="button" size="icon" aria-label="New Logo" title="New Logo" onClick={() => setUploading(true)}>
          <Plus size={16} />
        </Button>
      }
    >
      {isLoading ? (
        <p className="p-6 text-sm text-(--mws-muted)">Loading logos...</p>
      ) : logos.length === 0 ? (
        <p className="p-6 text-sm text-(--mws-muted)">No logos yet. Add the first one.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-3 p-4 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {logos.map((logo) => (
            <li key={logo.id} className="min-w-0">
              <button
                type="button"
                onClick={() => setSelected(logo)}
                className="flex w-full min-w-0 flex-col items-center gap-2 rounded-xl border border-(--mws-line) p-3 transition hover:border-(--mws-burgundy) hover:bg-(--mws-soft) focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <LogoImage id={logo.id} version={logo.version} alt="" size={64} />
                <span className="w-full truncate text-center text-xs font-semibold text-(--mws-charcoal)" title={logo.name}>{logo.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploading ? <UploadDialog onClose={() => setUploading(false)} /> : null}
      {selected ? <LogoDialog logo={selected} onClose={() => setSelected(null)} onDelete={remove} /> : null}
    </PanelFrame>
  );
}
