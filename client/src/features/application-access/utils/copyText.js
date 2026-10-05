import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showSuccessToast("Copied.");
  } catch (error) {
    showErrorToast(error, "Could not copy this value.");
  }
}
