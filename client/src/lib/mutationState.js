// Is this mutation running right now for this row?
//
// A mutation keeps its last `variables` after it finished, so comparing `variables` alone stays true
// forever and leaves a button disabled or a spinner turning until the page is reloaded. This checks
// `isPending` too. `matches` is the id to compare with (===), or a function that gets the variables.
export function isPendingFor(mutation, matches) {
  if (!mutation?.isPending) return false;
  return typeof matches === "function" ? Boolean(matches(mutation.variables)) : mutation.variables === matches;
}
