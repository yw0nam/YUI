import { setLocale } from "../../../src/ui/i18n";

const dark = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => {
  document.documentElement.dataset.theme = dark.matches ? "hearth" : "dawn";
};
applyTheme();
dark.addEventListener("change", applyTheme);
setLocale("en");
