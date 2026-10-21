import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import dayjs from "dayjs";

const dateFieldTheme = createTheme({
  palette: {
    primary: {
      main: "#7e1518",
    },
  },
});

export function DateField({
  className,
  invalid,
  value,
  onChange,
  min,
  max,
  disabled,
  placeholder,
  id,
  name,
}) {
  const parsedValue = value ? dayjs(value, "YYYY-MM-DD", true) : null;
  const minDate = min ? dayjs(min, "YYYY-MM-DD", true) : undefined;
  const maxDate = max ? dayjs(max, "YYYY-MM-DD", true) : undefined;

  function handleChange(nextValue) {
    if (!onChange) return;
    const isBadInput = Boolean(nextValue) && !nextValue.isValid();
    const nextStringValue =
      nextValue && nextValue.isValid() ? nextValue.format("YYYY-MM-DD") : "";
    onChange({
      target: {
        value: nextStringValue,
        validity: { badInput: isBadInput },
      },
    });
  }

  return (
    <ThemeProvider theme={dateFieldTheme}>
      <DatePicker
        value={parsedValue}
        onChange={handleChange}
        minDate={minDate}
        maxDate={maxDate}
        disabled={disabled}
        format="DD/MM/YYYY"
        slotProps={{
          textField: {
            id,
            name,
            placeholder,
            size: "small",
            fullWidth: true,
            className,
            error: invalid,
            // Same look as the other inputs (inputClasses): font, text colour, padding, border and focus ring.
            sx: {
              "& .MuiPickersInputBase-root": {
                height: "2.75rem",
                borderRadius: "0.75rem",
                backgroundColor: "#fff",
                fontFamily: "inherit",
                fontSize: "0.875rem",
                color: "var(--mws-charcoal)",
                paddingLeft: "0.75rem",
                paddingRight: "0.75rem",
                transition: "box-shadow 150ms",
              },
              "& .MuiPickersSectionList-root, & .MuiPickersInputBase-sectionsContainer": {
                fontFamily: "inherit",
                fontSize: "0.875rem",
                padding: 0,
              },
              "& .MuiPickersOutlinedInput-notchedOutline": {
                borderWidth: "1px",
                borderColor: invalid ? "#c75f64" : "var(--mws-line)",
              },
              "&:hover .MuiPickersOutlinedInput-notchedOutline": {
                borderColor: invalid ? "#c75f64" : "var(--mws-line)",
              },
              "& .Mui-focused": {
                boxShadow: "0 0 0 2px #7E15181A",
              },
              "& .Mui-focused .MuiPickersOutlinedInput-notchedOutline": {
                borderColor: "var(--mws-burgundy)",
                borderWidth: "1px",
              },
              "& .Mui-disabled": {
                backgroundColor: "var(--mws-soft)",
                color: "#8d7b7d",
                WebkitTextFillColor: "#8d7b7d",
              },
            },
          },
        }}
      />
    </ThemeProvider>
  );
}
