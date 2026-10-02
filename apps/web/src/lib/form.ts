/** Reads a text field from FormData, trimmed. File entries yield an empty string. */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
