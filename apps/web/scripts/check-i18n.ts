import { messages } from "../src/i18n/messages.ts";

const [english, chinese] = [messages.en, messages.zh];
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, shape(child)]),
    );
  return typeof value;
}
if (JSON.stringify(shape(english)) !== JSON.stringify(shape(chinese)))
  throw new Error("English and Chinese message shapes differ.");
console.log("i18n message shapes are aligned.");
