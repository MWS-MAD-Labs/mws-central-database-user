import { phoneDigitsOnly, textLength } from "../../../lib/form.js";
import { enumOptions } from "../../../lib/format.js";
import { Field, LengthHint } from "./Field.jsx";
import { SearchableSelect } from "./SearchableSelect.jsx";
import { TextAreaInput, TextInput } from "./TextControls.jsx";

export function LimitedField({
  label,
  field,
  max,
  values,
  errors,
  updateValue,
  required = false,
  as = "input",
  transform,
  placeholder,
  className,
  rows,
  type,
  inputMode,
  name,
}) {
  const value = values[field];
  const error = errors?.[field];
  const Input = as === "textarea" ? TextAreaInput : TextInput;
  return (
    <Field
      label={label}
      name={name || field}
      error={error}
      className={className}
      hint={
        <LengthHint
          value={value}
          max={max}
          label="characters"
          count={textLength}
          prefix={required ? `Required, up to ${max} characters` : undefined}
        />
      }
    >
      <Input
        invalid={Boolean(error)}
        value={value || ""}
        maxLength={max}
        rows={rows}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(event) =>
          updateValue(
            field,
            transform ? transform(event.target.value) : event.target.value,
          )
        }
      />
    </Field>
  );
}

export function PhoneField({
  label = "Mobile Phone",
  field = "mobile_phone",
  values,
  errors,
  updateValue,
}) {
  return (
    <Field
      label={label}
      name={field}
      error={errors?.[field]}
      hint={
        <LengthHint
          value={values[field]}
          max={16}
          label="characters"
          count={textLength}
        />
      }
    >
      <TextInput
        inputMode="tel"
        placeholder="08xx, +628xx, or 628xx"
        invalid={Boolean(errors?.[field])}
        value={values[field] || ""}
        maxLength={16}
        onChange={(event) =>
          updateValue(field, phoneDigitsOnly(event.target.value))
        }
      />
    </Field>
  );
}

export function EmailField({
  domain,
  max,
  values,
  errors,
  updateValue,
  sanitize,
  field = "email_local",
  required = true,
}) {
  const value = values[field];
  const error = errors?.[field];
  return (
    <Field
      label="Email"
      name={field}
      error={error}
      hint={
        <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
          <span>{`Format: name@${domain}`}</span>
          <LengthHint
            value={value}
            max={max}
            label="characters"
            count={textLength}
            prefix={required ? "Required" : "Optional"}
          />
        </span>
      }
    >
      <div className="flex min-w-0 items-stretch">
        <TextInput
          invalid={Boolean(error)}
          className="rounded-r-none"
          value={value || ""}
          maxLength={max}
          onChange={(event) =>
            updateValue(
              field,
              sanitize ? sanitize(event.target.value) : event.target.value,
            )
          }
        />
        <span className="flex shrink-0 items-center whitespace-nowrap rounded-r-xl border border-l-0 border-(--mws-line) bg-(--mws-soft) px-3 text-sm text-(--mws-muted)">
          @{domain}
        </span>
      </div>
    </Field>
  );
}

export function ReligionFields({
  values,
  errors,
  setValues,
  religionOptions,
  required = false,
}) {
  return (
    <>
      <Field label="Religion" name="religion" error={errors?.religion}>
        <SearchableSelect
          required={required}
          value={values.religion}
          onChange={(value) =>
            setValues((current) => ({
              ...current,
              religion: value,
              religion_other: value === "OTHER" ? current.religion_other : "",
            }))
          }
          options={enumOptions(religionOptions)}
          placeholder="Select Religion"
          searchPlaceholder="Search Religion"
        />
      </Field>
      {values.religion === "OTHER" ? (
        <LimitedField
          label="Religion (Please Specify)"
          field="religion_other"
          max={50}
          placeholder="e.g. Sikh"
          values={values}
          errors={errors}
          updateValue={(field, value) =>
            setValues((current) => ({ ...current, [field]: value }))
          }
        />
      ) : null}
    </>
  );
}
