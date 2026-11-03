import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { PanelFrame } from "../../master-data/components/PanelFrame.jsx";
import { applicationLogosApi } from "../api/applicationLogosApi.js";
import { sniffImageType } from "../utils/imageSniff.js";
import { LOGOS_KEY, useApplicationLogos } from "../hooks/useApplicationLogos.js";
import { LogoImage } from "./LogoImage.jsx";

const ACCEPT = "image/png,image/jpeg,image/webp,image/avif,image/svg+xml,.svg";
const MAX_BYTES = 2 * 1024 * 1024;

// How the picture will sit in the saved logo: a square, the picture fitted inside with a little room around it.
function SavedLook({ address }) {
  return (
    <div
      className="flex size-32 items-center justify-center rounded-xl border border-(--mws-line) bg-[conic-gradient(#f3efef_25%,#fff_0_50%,#f3efef_0_75%,#fff_0)] bg-size-[16px_16px] p-[5%]"
      aria-label="How the logo will look"
    >
      {address ? <img src={address} alt="" className="size-full object-contain" /> : <ImagePlus size={24} className="text-(--mws-muted)" aria-hidden="true" />}
    </div>
  );
}

function UploadDialog({ onClose }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [problem, setProblem] = useState("");
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
    mutationFn: () => applicationLogosApi.upload({ name: name.trim(), file }),
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
    if (!picked) {
      setProblem("");
      return;
    }
    if (picked.size > MAX_BYTES) {
      setProblem("The picture is too large, 2 MB at most.");
      return;
    }
    const type = await sniffImageType(picked);
    if (!type) {
      setProblem("This file is not a picture the server can use. Use a PNG, JPG, WebP, AVIF or SVG.");
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
      description="Saved as a 256 x 256 picture with a transparent background. A wide or tall logo is fitted inside, never cropped."
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!file || !name.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Adding..." : "Add Logo"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <SavedLook address={address} />
        <div className="min-w-0 flex-1 space-y-4">
          <Field label="Name" required counter={{ value: name, max: 64, count: (value) => value.length }}>
            <TextInput value={name} maxLength={64} onChange={(event) => setName(event.target.value)} placeholder="e.g. Millennia" />
          </Field>
          <Field label="Picture" required hint="PNG, JPG, WebP, AVIF or SVG, 2 MB at most. A PNG or JPG needs at least 128 px on the longest side." error={problem}>
            <input
              type="file"
              accept={ACCEPT}
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

function RenameDialog({ logo, onClose }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(logo.name);
  const mutation = useMutation({
    mutationFn: () => applicationLogosApi.rename(logo.id, name.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOGOS_KEY });
      showSuccessToast("Logo renamed.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "The logo could not be renamed."),
  });
  return (
    <CrudDialog
      title="Rename Logo"
      onClose={onClose}
      panelClassName="max-w-md"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!name.trim() || name.trim() === logo.name || mutation.isPending} onClick={() => mutation.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Name" required>
        <TextInput value={name} maxLength={64} onChange={(event) => setName(event.target.value)} />
      </Field>
    </CrudDialog>
  );
}

// The pictures an application can use on its Hub card, kept in the master data so a new one needs no code change.
export function ApplicationLogosPanel() {
  const { logos, isLoading } = useApplicationLogos();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState(null);

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
    if (confirmed) removal.mutate(logo.id);
  }

  return (
    <PanelFrame
      title="Logos"
      description="The pictures an application can show on its Hub card. Each is saved square and the same size, so they sit alike."
      icon={ImagePlus}
      action={
        <Button type="button" onClick={() => setUploading(true)}>
          <ImagePlus size={16} aria-hidden="true" />
          Add Logo
        </Button>
      }
    >
      {isLoading ? (
        <p className="p-6 text-sm text-(--mws-muted)">Loading logos...</p>
      ) : logos.length === 0 ? (
        <p className="p-6 text-sm text-(--mws-muted)">No logos yet. Add the first one.</p>
      ) : (
        <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {logos.map((logo) => (
            <li key={logo.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-(--mws-line) p-3">
              <LogoImage id={logo.id} version={logo.version} alt={logo.name} size={56} className="bg-(--mws-soft)" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-bold text-(--mws-charcoal)" title={logo.name}>{logo.name}</p>
                <div className="mt-1">
                  {logo.used_by.length > 0 ? (
                    <StatusBadge tone="neutral" title={logo.used_by.map((item) => item.name).join(", ")}>
                      {`Used By ${logo.used_by.length}`}
                    </StatusBadge>
                  ) : (
                    <span className="text-xs text-(--mws-muted)">Not used</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label={`Rename ${logo.name}`} title="Rename" onClick={() => setRenaming(logo)}>
                  <Pencil size={16} aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${logo.name}`} title="Delete" onClick={() => remove(logo)}>
                  <Trash2 size={16} aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {uploading ? <UploadDialog onClose={() => setUploading(false)} /> : null}
      {renaming ? <RenameDialog logo={renaming} onClose={() => setRenaming(null)} /> : null}
    </PanelFrame>
  );
}
