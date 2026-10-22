/** The name a prompt line or tool enum shows for a preset: a preset named `user` is disambiguated. */
export function targetLabel(name: string): string {
  return name.toLowerCase() === "user" ? `${name} (character)` : name;
}
