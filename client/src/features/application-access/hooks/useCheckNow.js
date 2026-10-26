import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showErrorToast, showInfoToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

const ANSWERS = {
  unreachable: "Nothing answers at the sign-in address. Is the application running?",
  wrong_path: "Something answers, but the sign-in page does not exist. Check the end of the address.",
};

// Asks the sign-in address of an application right now and tells the answer in a toast.
export function useCheckNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (applicationId) => applicationAccessApi.checkApplicationNow(applicationId),
    onSuccess: ({ verdict }) => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      if (verdict === "ok") showSuccessToast("The application answers at its sign-in address.");
      else showInfoToast(ANSWERS[verdict] ?? "This address cannot be checked.");
    },
    onError: (error) => showErrorToast(error, "Could not check this application."),
  });
}
