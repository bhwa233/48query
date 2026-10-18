import { headers } from "next/headers";
import LocaleLayout from "./[locale]/layout";
import NotFound from "./[locale]/not-found";

export default async function GlobalNotFound() {
  const locale =
    (await headers()).get("x-next-intl-locale") === "zh" ? "zh" : "en";
  return (
    <LocaleLayout params={Promise.resolve({ locale })}>
      <NotFound />
    </LocaleLayout>
  );
}
